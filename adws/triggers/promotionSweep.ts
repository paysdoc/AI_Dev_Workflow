/**
 * Promotion sweep — full reconcile lifecycle, cron-dispatched via
 * `runPromotionSweepTick` (see `trigger_cron.ts`) on the
 * `PROMOTION_SWEEP_INTERVAL_CYCLES` cadence.
 *
 * Lists tracked `features/per-issue/feature-{N}.feature` files on the default
 * branch, scores each with the retained deterministic scorer + auto-ramping
 * threshold (no LLM), reconciles against ALL-STATE `regression-promotion`
 * issues, and asks the pure `promotionSweepDecider` for a single action:
 *
 *  - `originate` — a fresh, qualifying candidate: stamps
 *    `@promotion-suggested-<date>` on the file via a commit SCOPED to that
 *    one path (never `git add -A`) and files exactly one #734-shaped
 *    promotion issue carrying a `Promotes: feature-{N}` back-link.
 *  - `decline` — an in-flight candidate whose tracker closed unmerged or
 *    carries `adw:blocked`: writes the terminal `@promotion-declined` marker
 *    to the source file (same scoped-commit seam; resumes TTL) and files no
 *    issue. A blocked tracking issue is left exactly as-is.
 *  - `redrive` — an in-flight candidate whose tracker is missing (crash-
 *    stranded) but still qualifying: re-files exactly one #734-shaped issue.
 *  - `withdraw` — the same stranded state but no longer qualifying: strips
 *    the tag back to `none` (resumes TTL) and files no issue.
 *
 * Mirrors `perIssueScenarioSweep.ts`: injectable deps with production
 * defaults closing over the caller's launch-boundary GitContext (see
 * `promotionSweepDefaults.ts`'s `makeDefaultDeps`), and non-fatal — a
 * transient git/gh error during any action is logged and swallowed, never
 * thrown, so the next candidate still processes. This module performs no
 * repo-identity resolution of its own; it acts on the repo of the passed
 * `gitContext`.
 *
 * Invoke by hand: `bunx tsx adws/triggers/promotionSweep.ts [--target-repo owner/repo]`.
 */

import * as path from 'path';
import { log, type LogLevel } from '../core';
import { parsePromotionTagState, serializePromotionTagState } from '../core/promotionTagState';
import type { PromotionTagState } from '../core/promotionTagState';
import { parseVocabulary, parseScenarios, score, computeThreshold } from '../promotion';
import type { PromotionStats, Scenario, VocabularyRegistry } from '../promotion';
import { decidePromotionAction } from '../core/promotionSweepDecider';
import { reconcileFactFor } from '../core/promotionReconcileLink';
import type { PromotionIssueRef } from '../core/promotionReconcileLink';
import { buildPromotionIssue } from '../core/promotionIssueBody';
import type { PromotionIssueSpec } from '../core/promotionIssueBody';
import { FEATURE_FILENAME_RE, makeDefaultDeps } from './promotionSweepDefaults';
import type { ScenariosPaths } from './promotionSweepDefaults';
import type { GitContext } from '../gitContext';
import { buildLaunchGitContext, parseTargetRepoArgs } from '../core';

export interface PromotionSweepDeps {
  gitContext: GitContext;
  now?: () => Date;
  listPerIssueFeatures?: () => string[];
  readFeatureContent?: (path: string) => string | null;
  listStepDefSiblings?: (featureNumber: number) => string[];
  loadVocabulary?: () => string;
  loadStats?: () => PromotionStats;
  listPromotionIssues?: () => PromotionIssueRef[];
  scenariosConfig?: ScenariosPaths;
  tagAndCommit?: (path: string, newContent: string, message: string) => void;
  fileIssue?: (spec: PromotionIssueSpec) => void;
  log?: (msg: string, level?: string) => void;
}

export interface PromotionSweepReport {
  originated: number[];
  redriven: number[];
  declined: string[];
  withdrawn: string[];
  left: string[];
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

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

// ── Per-candidate processing ─────────────────────────────────────────────────

interface SweepContext {
  now: () => Date;
  registry: VocabularyRegistry;
  threshold: number;
  promotionIssues: readonly PromotionIssueRef[];
  scenariosConfig: ScenariosPaths;
  listStepDefSiblings: (featureNumber: number) => string[];
  tagAndCommit: (path: string, newContent: string, message: string) => void;
  fileIssue: (spec: PromotionIssueSpec) => void;
  logger: (msg: string, level?: LogLevel) => void;
}

type CandidateOutcome =
  | { kind: 'skip' }
  | { kind: 'left'; filePath: string }
  | { kind: 'originated'; featureNumber: number }
  | { kind: 'redriven'; featureNumber: number }
  | { kind: 'declined'; filePath: string }
  | { kind: 'withdrawn'; filePath: string }
  | { kind: 'action-failed' };

/** Non-fatal tag-write: serializes `target` and commits it. Swallows and logs a transient failure. */
function attemptTagWrite(
  filePath: string,
  content: string,
  target: PromotionTagState,
  message: string,
  ctx: SweepContext,
): boolean {
  try {
    ctx.tagAndCommit(filePath, serializePromotionTagState(content, target), message);
    return true;
  } catch (err) {
    ctx.logger(`promotionSweep: ${target} write failed for ${filePath}: ${err} — leaving for next sweep`, 'warn');
    return false;
  }
}

/** Builds the #734-shaped issue spec and files it via the injected seam. */
function fileIssueFor(filePath: string, featureNumber: number, scenarios: readonly Scenario[], ctx: SweepContext): void {
  const spec = buildPromotionIssue({
    featureNumber,
    sourceFeaturePath: filePath,
    sourceStepDefPaths: ctx.listStepDefSiblings(featureNumber),
    destinationRegressionDir: ctx.scenariosConfig.regressionDir,
    vocabularyRegistryPath: ctx.scenariosConfig.vocabPath,
    phrases: dedupedPhrases(scenarios),
    score: bestScore(scenarios, ctx.registry),
  });
  ctx.fileIssue(spec);
}

/** Writes the marker, builds the #734-shaped issue, and files it. Never throws — swallows and logs. */
function attemptOriginate(
  filePath: string,
  featureNumber: number,
  content: string,
  scenarios: readonly Scenario[],
  ctx: SweepContext,
): boolean {
  const feature = `feature-${featureNumber}`;
  try {
    const date = isoDate(ctx.now());
    const newContent = serializePromotionTagState(content, 'suggested', { date });
    ctx.tagAndCommit(filePath, newContent, `chore: mark ${feature} promotion-suggested`);
    fileIssueFor(filePath, featureNumber, scenarios, ctx);

    ctx.logger(`promotionSweep: originated promotion for ${feature}`, 'info');
    return true;
  } catch (err) {
    ctx.logger(`promotionSweep: origination failed for ${filePath}: ${err} — leaving for next sweep`, 'warn');
    return false;
  }
}

/** Re-files the #734-shaped issue for a stranded (no-tracker) but still-qualifying candidate. Never throws — swallows and logs. */
function attemptRedrive(filePath: string, featureNumber: number, scenarios: readonly Scenario[], ctx: SweepContext): boolean {
  try {
    fileIssueFor(filePath, featureNumber, scenarios, ctx);
    ctx.logger(`promotionSweep: redrove stranded promotion for feature-${featureNumber}`, 'info');
    return true;
  } catch (err) {
    ctx.logger(`promotionSweep: redrive failed for ${filePath}: ${err} — leaving for next sweep`, 'warn');
    return false;
  }
}

function processCandidate(
  filePath: string,
  readFeatureContent: (path: string) => string | null,
  ctx: SweepContext,
): CandidateOutcome {
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

  const tagState = parsePromotionTagState(content);
  const meetsThreshold = scenarios.length > 0 && bestScore(scenarios, ctx.registry) >= ctx.threshold;
  const reconcile = reconcileFactFor(`feature-${featureNumber}`, ctx.promotionIssues);
  const action = decidePromotionAction({ tagState, meetsThreshold, reconcile });
  const feature = `feature-${featureNumber}`;

  if (action === 'decline') {
    const declined = attemptTagWrite(filePath, content, 'declined', `chore: mark ${feature} promotion-declined`, ctx);
    return declined ? { kind: 'declined', filePath } : { kind: 'action-failed' };
  }

  if (action === 'redrive') {
    const redriven = attemptRedrive(filePath, featureNumber, scenarios, ctx);
    return redriven ? { kind: 'redriven', featureNumber } : { kind: 'action-failed' };
  }

  if (action === 'withdraw') {
    const withdrawn = attemptTagWrite(filePath, content, 'none', `chore: withdraw ${feature} promotion suggestion`, ctx);
    return withdrawn ? { kind: 'withdrawn', filePath } : { kind: 'action-failed' };
  }

  if (action !== 'originate') {
    ctx.logger(`promotionSweep: ${filePath} → ${action}`, 'info');
    return { kind: 'left', filePath };
  }

  const originated = attemptOriginate(filePath, featureNumber, content, scenarios, ctx);
  return originated ? { kind: 'originated', featureNumber } : { kind: 'action-failed' };
}

// ── Shell entry point ────────────────────────────────────────────────────────

export async function runPromotionSweep(deps: PromotionSweepDeps): Promise<PromotionSweepReport> {
  const now = deps.now ?? (() => new Date());
  const logger = deps.log ?? log;
  const defaults = makeDefaultDeps(deps.gitContext);
  const scenariosConfig = deps.scenariosConfig ?? defaults.scenariosConfig();
  const listPerIssueFeatures = deps.listPerIssueFeatures ?? defaults.listPerIssueFeatures;
  const readFeatureContent = deps.readFeatureContent ?? defaults.readFeatureContent;
  const listStepDefSiblings = deps.listStepDefSiblings ?? defaults.listStepDefSiblings;
  const loadVocabulary = deps.loadVocabulary ?? (() => defaults.loadVocabulary(scenariosConfig.vocabPath));
  const loadStats = deps.loadStats ?? defaults.loadStats;
  const listPromotionIssues = deps.listPromotionIssues ?? defaults.listPromotionIssues;
  const tagAndCommit = deps.tagAndCommit ?? defaults.tagAndCommit;
  const fileIssue = deps.fileIssue ?? defaults.fileIssue;

  const ctx: SweepContext = {
    now,
    registry: parseVocabulary(loadVocabulary()),
    threshold: computeThreshold(loadStats()),
    promotionIssues: listPromotionIssues(),
    scenariosConfig,
    listStepDefSiblings,
    tagAndCommit,
    fileIssue,
    logger,
  };

  const report: PromotionSweepReport = { originated: [], redriven: [], declined: [], withdrawn: [], left: [] };

  for (const filePath of listPerIssueFeatures()) {
    const outcome = processCandidate(filePath, readFeatureContent, ctx);
    if (outcome.kind === 'left') report.left.push(outcome.filePath);
    if (outcome.kind === 'originated') report.originated.push(outcome.featureNumber);
    if (outcome.kind === 'redriven') report.redriven.push(outcome.featureNumber);
    if (outcome.kind === 'declined') report.declined.push(outcome.filePath);
    if (outcome.kind === 'withdrawn') report.withdrawn.push(outcome.filePath);
  }

  return report;
}

// ── CLI entry point ──────────────────────────────────────────────────────────
// Guard mirrors trigger_cron.ts: `import.meta.main` is Bun-only and does not fire
// under this repo's documented `bunx tsx <script>` invocation (verified: tsx runs
// under Node, where import.meta.main is undefined), so this checks argv instead.

if (process.argv[1]?.replace(/\\/g, '/').includes('promotionSweep')) {
  const targetRepo = parseTargetRepoArgs(process.argv.slice(2));
  runPromotionSweep({ gitContext: buildLaunchGitContext(targetRepo) })
    .then(r => log(
      `promotionSweep: originated ${r.originated.length}, redrove ${r.redriven.length}, declined ${r.declined.length}, withdrew ${r.withdrawn.length}, left ${r.left.length} file(s) untouched`,
      'info',
    ))
    .catch(e => {
      log(`promotionSweep: fatal ${e}`, 'error');
      process.exit(1);
    });
}
