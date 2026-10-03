/**
 * Promotion sweep — full reconcile lifecycle, cron-dispatched via
 * `runPromotionSweepTick` (see `trigger_cron.ts`) on the
 * `PROMOTION_SWEEP_INTERVAL_CYCLES` cadence.
 *
 * Lists tracked `features/per-issue/feature-{N}.feature` files from a dedicated
 * worktree synced to fresh `origin/<default>` (never the cron host's own,
 * possibly stale, checkout), scores each with the retained deterministic scorer
 * + auto-ramping threshold (no LLM), reconciles against ALL-STATE
 * `regression-promotion` issues, and asks the pure `promotionSweepDecider` for a
 * single action:
 *
 *  - `originate` — a fresh, qualifying candidate: stamps
 *    `@promotion-suggested-<date>` and, once that marker is on the default
 *    branch, files one promotion issue carrying a `Promotes: feature-{N}`
 *    back-link.
 *  - `decline` — an in-flight candidate whose tracker closed unmerged or
 *    carries `adw:blocked`: writes the terminal `@promotion-declined` marker
 *    and files no issue; a blocked tracker is left as-is.
 *  - `redrive` — an in-flight candidate whose tracker is missing (crash-
 *    stranded) but still qualifying: re-files one issue; its marker is already
 *    on the default branch.
 *  - `withdraw` — the same stranded state but no longer qualifying: strips
 *    the tag back to `none` and files no issue.
 *
 * A run is three phases. PLAN is pure: each file's action plus the marker write
 * it needs. LAND commits the writes in the sweep worktree (one commit scoped to
 * each path, never `git add -A`), pushes one sweep branch and merges one pull
 * request immediately — no direct push, host checkout untouched. SETTLE files
 * issues and reports outcomes for the markers that landed; a failed landing
 * files nothing and the next sweep retries it.
 *
 * Mirrors `docsIndexSweep.ts`: injectable deps with production defaults
 * (`promotionSweepDefaults.ts`) over one lazily created sweep worktree, torn
 * down on every exit path. No repo-identity resolution happens here.
 *
 * Invoke by hand: `bunx tsx adws/triggers/promotionSweep.ts [--target-repo owner/repo]`.
 */

import * as path from 'path';
import { log, buildLaunchBoundary, parseTargetRepoArgs, type LaunchBoundary, type LogLevel } from '../core';
import { parsePromotionTagState, serializePromotionTagState } from '../core/promotionTagState';
import { parseVocabulary, parseScenarios, score, computeThreshold } from '../promotion';
import type { PromotionStats, Scenario, VocabularyRegistry } from '../promotion';
import { decidePromotionAction } from '../core/promotionSweepDecider';
import { reconcileFactFor } from '../core/promotionReconcileLink';
import type { PromotionIssueRef } from '../core/promotionReconcileLink';
import { buildPromotionIssue } from '../core/promotionIssueBody';
import type { PromotionIssueSpec } from '../core/promotionIssueBody';
import { FEATURE_FILENAME_RE, PROMOTION_SWEEP_SPEC, makeDefaultDeps } from './promotionSweepDefaults';
import type { MarkerWrite, ScenariosPaths } from './promotionSweepDefaults';
import { prepareSweepBase, cleanupSweepBase } from './perIssueSweepPersist';
import type { SweepBase } from './perIssueSweepPersist';

type SweepLogger = (msg: string, level?: LogLevel) => void;
type PersistMarkers = (writes: readonly MarkerWrite[]) => Promise<boolean>;

export interface PromotionSweepDeps {
  boundary: LaunchBoundary;
  now?: () => Date;
  listPerIssueFeatures?: () => string[];
  readFeatureContent?: (path: string) => string | null;
  listStepDefSiblings?: (featureNumber: number) => string[];
  loadVocabulary?: () => string;
  loadStats?: () => PromotionStats;
  listPromotionIssues?: () => PromotionIssueRef[];
  scenariosConfig?: ScenariosPaths;
  persistMarkers?: PersistMarkers;
  fileIssue?: (spec: PromotionIssueSpec) => void;
  log?: (msg: string, level?: string) => void;
}

export interface PromotionSweepReport {
  originated: number[];
  redriven: number[];
  declined: string[];
  withdrawn: string[];
  left: string[];
  threshold: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function bestScore(scenarios: readonly Scenario[], registry: VocabularyRegistry): number {
  if (scenarios.length === 0) return 0;
  return Math.max(...scenarios.map(s => score(s, registry, registry.surfaceExamples).total));
}

function dedupedPhrases(scenarios: readonly Scenario[]): string[] {
  return [...new Set(scenarios.flatMap(s => s.steps.map(step => step.text)))];
}

interface SweepContext {
  now: () => Date;
  registry: VocabularyRegistry;
  threshold: number;
  promotionIssues: readonly PromotionIssueRef[];
  scenariosConfig: ScenariosPaths;
  listStepDefSiblings: (featureNumber: number) => string[];
  fileIssue: (spec: PromotionIssueSpec) => void;
  logger: SweepLogger;
}

interface FilePlan {
  filePath: string;
  featureNumber: number;
  scenarios: readonly Scenario[];
}

type MarkerAction = 'originate' | 'decline' | 'withdraw';

type CandidatePlan =
  | { kind: 'skip' }
  | { kind: 'left'; filePath: string }
  | ({ kind: 'redrive' } & FilePlan)
  | ({ kind: MarkerAction } & FilePlan & { write: MarkerWrite });

type CandidateOutcome =
  | { kind: 'skip' }
  | { kind: 'left'; filePath: string }
  | { kind: 'originated'; featureNumber: number }
  | { kind: 'redriven'; featureNumber: number }
  | { kind: 'declined'; filePath: string }
  | { kind: 'withdrawn'; filePath: string }
  | { kind: 'action-failed' };

const MARKER_EDITS: Record<MarkerAction, (content: string, feature: string, date: string) => Pick<MarkerWrite, 'content' | 'message'>> = {
  originate: (content, feature, date) => ({
    content: serializePromotionTagState(content, 'suggested', { date }),
    message: `chore: mark ${feature} promotion-suggested`,
  }),
  decline: (content, feature) => ({
    content: serializePromotionTagState(content, 'declined'),
    message: `chore: mark ${feature} promotion-declined`,
  }),
  withdraw: (content, feature) => ({
    content: serializePromotionTagState(content, 'none'),
    message: `chore: withdraw ${feature} promotion suggestion`,
  }),
};

function planCandidate(filePath: string, readFeatureContent: (path: string) => string | null, ctx: SweepContext): CandidatePlan {
  const match = FEATURE_FILENAME_RE.exec(path.basename(filePath));
  if (!match) {
    ctx.logger(`promotionSweep: skipping unrecognised filename ${path.basename(filePath)}`, 'warn');
    return { kind: 'skip' };
  }
  const featureNumber = parseInt(match[1], 10);

  const content = readFeatureContent(filePath);
  if (content === null) {
    ctx.logger(`promotionSweep: could not read ${filePath} — skipping`, 'warn');
    return { kind: 'skip' };
  }

  let scenarios: Scenario[];
  try {
    scenarios = parseScenarios(content, filePath);
  } catch (err) {
    ctx.logger(`promotionSweep: failed to parse ${filePath}: ${err} — skipping`, 'warn');
    return { kind: 'skip' };
  }

  const feature = `feature-${featureNumber}`;
  const action = decidePromotionAction({
    tagState: parsePromotionTagState(content),
    meetsThreshold: scenarios.length > 0 && bestScore(scenarios, ctx.registry) >= ctx.threshold,
    reconcile: reconcileFactFor(feature, ctx.promotionIssues),
  });
  const plan: FilePlan = { filePath, featureNumber, scenarios };

  if (action === 'redrive') return { kind: 'redrive', ...plan };
  if (action === 'originate' || action === 'decline' || action === 'withdraw') {
    const edit = MARKER_EDITS[action](content, feature, isoDate(ctx.now()));
    return { kind: action, ...plan, write: { filePath, ...edit } };
  }

  ctx.logger(`promotionSweep: ${filePath} → ${action}`, 'info');
  return { kind: 'left', filePath };
}

/** Never throws — a failed or rejected landing is logged and treated as not landed. */
async function landMarkers(plans: readonly CandidatePlan[], persistMarkers: PersistMarkers, logger: SweepLogger): Promise<boolean> {
  const writes = plans.flatMap(plan => ('write' in plan ? [plan.write] : []));
  if (writes.length === 0) return false;
  try {
    return await persistMarkers(writes);
  } catch (err) {
    logger(`promotionSweep: landing ${writes.length} marker change(s) failed: ${err} — leaving for next sweep`, 'warn');
    return false;
  }
}

/** Never throws — swallows and logs. */
function attemptFileIssue(plan: FilePlan, kind: 'originated' | 'redriven', ctx: SweepContext): boolean {
  try {
    ctx.fileIssue(buildPromotionIssue({
      featureNumber: plan.featureNumber,
      sourceFeaturePath: plan.filePath,
      sourceStepDefPaths: ctx.listStepDefSiblings(plan.featureNumber),
      destinationRegressionDir: ctx.scenariosConfig.regressionDir,
      vocabularyRegistryPath: ctx.scenariosConfig.vocabPath,
      phrases: dedupedPhrases(plan.scenarios),
      score: bestScore(plan.scenarios, ctx.registry),
    }));
    ctx.logger(`promotionSweep: ${kind === 'originated' ? 'originated promotion for' : 'redrove stranded promotion for'} feature-${plan.featureNumber}`, 'info');
    return true;
  } catch (err) {
    ctx.logger(`promotionSweep: filing the promotion issue for ${plan.filePath} failed: ${err} — leaving for next sweep`, 'warn');
    return false;
  }
}

function filedOutcome(plan: FilePlan, kind: 'originated' | 'redriven', ctx: SweepContext): CandidateOutcome {
  return attemptFileIssue(plan, kind, ctx) ? { kind, featureNumber: plan.featureNumber } : { kind: 'action-failed' };
}

function settleCandidate(plan: CandidatePlan, landed: boolean, ctx: SweepContext): CandidateOutcome {
  if (plan.kind === 'skip' || plan.kind === 'left') return plan;
  if (plan.kind === 'redrive') return filedOutcome(plan, 'redriven', ctx);

  // An originated issue must never exist without its marker on the default branch:
  // without the marker the 14-day per-issue sweep is free to delete the candidate.
  if (!landed) {
    ctx.logger(`promotionSweep: ${plan.kind} marker for ${plan.filePath} did not reach the default branch — leaving for next sweep`, 'warn');
    return { kind: 'action-failed' };
  }
  if (plan.kind === 'originate') return filedOutcome(plan, 'originated', ctx);
  return { kind: plan.kind === 'decline' ? 'declined' : 'withdrawn', filePath: plan.filePath };
}

function buildReport(outcomes: readonly CandidateOutcome[], threshold: number): PromotionSweepReport {
  return {
    originated: outcomes.flatMap(o => (o.kind === 'originated' ? [o.featureNumber] : [])),
    redriven: outcomes.flatMap(o => (o.kind === 'redriven' ? [o.featureNumber] : [])),
    declined: outcomes.flatMap(o => (o.kind === 'declined' ? [o.filePath] : [])),
    withdrawn: outcomes.flatMap(o => (o.kind === 'withdrawn' ? [o.filePath] : [])),
    left: outcomes.flatMap(o => (o.kind === 'left' ? [o.filePath] : [])),
    threshold,
  };
}

export async function runPromotionSweep(deps: PromotionSweepDeps): Promise<PromotionSweepReport> {
  const now = deps.now ?? (() => new Date());
  const logger = deps.log ?? log;

  let cachedBase: SweepBase | null | undefined;
  const getBase = (): SweepBase | null => {
    if (cachedBase === undefined) cachedBase = prepareSweepBase(deps.boundary, PROMOTION_SWEEP_SPEC);
    return cachedBase;
  };

  try {
    const defaults = makeDefaultDeps(deps.boundary, getBase);
    const scenariosConfig = deps.scenariosConfig ?? defaults.scenariosConfig();
    const listPerIssueFeatures = deps.listPerIssueFeatures ?? defaults.listPerIssueFeatures;
    const readFeatureContent = deps.readFeatureContent ?? defaults.readFeatureContent;
    const loadVocabulary = deps.loadVocabulary ?? (() => defaults.loadVocabulary(scenariosConfig.vocabPath));
    const loadStats = deps.loadStats ?? defaults.loadStats;
    const listPromotionIssues = deps.listPromotionIssues ?? defaults.listPromotionIssues;
    const persistMarkers = deps.persistMarkers ?? defaults.persistMarkers;

    const threshold = computeThreshold(loadStats());
    const ctx: SweepContext = {
      now,
      registry: parseVocabulary(loadVocabulary()),
      threshold,
      promotionIssues: listPromotionIssues(),
      scenariosConfig,
      listStepDefSiblings: deps.listStepDefSiblings ?? defaults.listStepDefSiblings,
      fileIssue: deps.fileIssue ?? defaults.fileIssue,
      logger,
    };

    const plans = listPerIssueFeatures().map(filePath => planCandidate(filePath, readFeatureContent, ctx));
    const landed = await landMarkers(plans, persistMarkers, logger);
    return buildReport(plans.map(plan => settleCandidate(plan, landed, ctx)), threshold);
  } finally {
    if (cachedBase) cleanupSweepBase(cachedBase);
  }
}

// Guard mirrors trigger_cron.ts: `import.meta.main` is Bun-only and does not fire
// under this repo's documented `bunx tsx <script>` invocation (verified: tsx runs
// under Node, where import.meta.main is undefined), so this checks argv instead.
if (process.argv[1]?.replace(/\\/g, '/').includes('promotionSweep')) {
  const targetRepo = parseTargetRepoArgs(process.argv.slice(2));
  runPromotionSweep({ boundary: buildLaunchBoundary(targetRepo) })
    .then(r => log(
      `promotionSweep: threshold ${r.threshold}, originated ${r.originated.length}, redrove ${r.redriven.length}, declined ${r.declined.length}, withdrew ${r.withdrawn.length}, left ${r.left.length} file(s) untouched`,
      'info',
    ))
    .catch(e => {
      log(`promotionSweep: fatal ${e}`, 'error');
      process.exit(1);
    });
}
