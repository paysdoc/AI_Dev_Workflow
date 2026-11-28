/**
 * Per-issue scenario sweep: removes the Per-Issue Scenarios (feature-{N}.feature in the per-issue directory the target's
 * `.adw/scenarios.md` names) 14 days after the issue's PR is merged, with the step-def files named for the issue
 * (feature-{N}.* and feature-{N}-*) in its configured step-definition directories, plus any such file whose feature is
 * already gone. A stale scenario that is a candidate of a Promotion Proposal ADW has not yet acted on, open or closed, or
 * that an open promotion implementation issue promotes, is kept, by issue, until neither holds: it stays listed, so its step
 * files are no orphans and the report counts its definitions as used. A sweep that cannot read the proposals or the
 * implementation issues removes nothing. The runner's dry run (perIssueSweepStepUsage.ts) writes a report. A usage
 * report (cucumber-js) keeps a step file that a remaining feature file uses, and after the batch lands it lists the
 * definitions no remaining feature file uses in one removal chore. An unused-steps report (cucumber-jvm, playwright-bdd)
 * lists only the definitions no feature file on the default branch uses: it keeps no step file by name, and the next sweep
 * lists the definitions that this batch leaves unused. Without a report, only step files inside the per-issue directory
 * are removed. Every batch passes the post-removal gate (sweepRemovalGate.ts) before it is committed: files a survivor
 * still imports are kept, and a batch that leaves the repo's static checks red is repaired or discarded — never landed.
 * Listing, staleness decisions, the dry run and the removal all run against a dedicated worktree synced to fresh
 * origin/<default> (see perIssueSweepPersist.ts) — never the cron host's own, possibly stale, base checkout — and the
 * removal lands via an immediately-merged pull request from a dedicated sweep branch, never a direct commit/push onto the
 * shared default branch. Identity comes entirely from the caller's injected launch boundary (`deps.boundary`).
 */

import * as path from 'path';
import { log, type LogLevel } from '../core';
import { getDefaultScenariosConfig, loadProjectConfig } from '../core/projectConfig';
import { isWithinDirectory, resolveScenarioDirectories, type ScenarioDirectories } from '../core/scenarioDirectories';
import type { UnusedStepIssueRef, UnusedStepIssueSpec } from '../core/unusedStepIssueBody';
import { bodyLinksIssue } from '../forge/issueLinkMarker';
import type { NominationKey } from '../promotion/nominationCollector';
import { prepareSweepBase, persistRemovalViaPr, cleanupSweepBase, type SweepBase } from './perIssueSweepPersist';
import { keptForPromotion, readSweepExemptCandidates, readSweepExemptIssues } from './promotionProposalIssues';
import { defaultFileRemovalIssue, defaultListOpenRemovalIssues, defaultReadStepUsage, readStepUsageOutcome, reconcileUnusedStepDefinitions, withoutUsedStepFiles, type StepUsageOutcome } from './perIssueSweepStepUsage';
import { verifyRemoval, worktreeGateDeps } from './sweepRemovalGate';
import type { LaunchBoundary } from '../core';
import type { CodeHost } from '@paysdoc/devplatform';

export const RETENTION_DAYS = 14;

const FEATURE_FILENAME_RE = /^feature-(\d+)\.feature$/;
// A step-def file belongs to issue N when named feature-N.<ext> or split as feature-N-<part>.<ext>.
const STEP_DEF_ISSUE_RE = /^feature-(\d+)[.-]/;
const FEATURE_EXTENSION = '.feature';

type Logger = (msg: string, level?: LogLevel) => void;

export function stepDefIssueNumber(filePath: string): number | null {
  const match = STEP_DEF_ISSUE_RE.exec(path.basename(filePath));
  return match ? parseInt(match[1], 10) : null;
}

/**
 * `filePath` is included in the signature so callers can log it alongside the
 * result without juggling tuples — it is not consulted by the predicate itself.
 */
export function isScenarioStale(
  filePath: string,
  mergedAt: Date | null,
  retentionDays: number,
  now: Date,
): boolean {
  void filePath;
  if (mergedAt === null) return false;
  const ageMs = now.getTime() - mergedAt.getTime();
  return ageMs >= retentionDays * 86_400_000;
}

export interface PerIssueSweepDeps {
  boundary: LaunchBoundary;
  now?: Date;
  listFeatures?: () => string[];
  getMergedAt?: (issueNum: number) => Promise<Date | null>;
  listStepDefSiblings?: (issueNum: number) => string[];
  /** Step-def files whose issue has no feature file among `featureFiles`. */
  listOrphanStepDefs?: (featureFiles: readonly string[]) => string[];
  /** Post-removal gate run inside the default persist path; returns the paths cleared to land, or null for none. */
  gateRemoval?: (paths: readonly string[], base: SweepBase) => Promise<readonly string[] | null>;
  /** Resolves the paths that actually landed; void means the whole batch did. */
  persistRemoval?: (paths: readonly string[]) => void | readonly string[] | Promise<void | readonly string[]>;
  /** The per-issue, regression and step-definition directories of the target's `.adw/scenarios.md`. */
  readDirectories?: () => ScenarioDirectories;
  /** Which feature files use each step definition, read from the scenario runner's dry run. */
  readStepUsage?: () => Promise<StepUsageOutcome>;
  listOpenRemovalIssues?: () => readonly UnusedStepIssueRef[];
  fileRemovalIssue?: (spec: UnusedStepIssueSpec) => number;
  /**
   * The candidates the sweep keeps: those of every undecided Promotion Proposal and the scenarios of every open promotion
   * implementation issue. Throws when the forge cannot be read.
   */
  readExemptCandidates?: () => readonly NominationKey[];
  log?: (msg: string, level?: string) => void;
}

type SweepListers = Required<Pick<PerIssueSweepDeps, 'listFeatures' | 'listStepDefSiblings' | 'listOrphanStepDefs'>>;

interface StaleScenario {
  readonly issueNum: number;
  readonly mergedAt: Date;
}

interface RemovalBatch {
  readonly staleFeatures: readonly string[];
  readonly paths: readonly string[];
}

function lsFilesUnder(base: SweepBase, directory: string): string[] {
  try {
    return base.ctx.lsFiles(base.worktreePath, directory);
  } catch {
    return [];
  }
}

/**
 * Lists tracked feature files from a dedicated worktree synced to fresh
 * origin/<default> (see prepareSweepBase) — never the cron host's own,
 * possibly stale, base checkout. Deciding and persisting off this synced base
 * is what makes the sweep self-healing: a removal whose push/PR/merge failed
 * in a prior cycle was never committed to the base, so the file is still
 * tracked on origin and is re-listed (and re-attempted) here.
 */
function defaultListFeatures(base: SweepBase, directories: ScenarioDirectories): string[] {
  return lsFilesUnder(base, directories.perIssue)
    .filter(p => FEATURE_FILENAME_RE.test(path.basename(p)))
    .filter(p => !isWithinDirectory(p, directories.regression));
}

/**
 * Returns null if no merged PR links the
 * issue, or on any lookup failure.
 */
export function defaultGetMergedAt(codeHost: CodeHost, issueNum: number): Promise<Date | null> {
  try {
    // GitHub search can't reliably express the "Closes owner/repo#N" body marker,
    // so fetch merged PRs and filter client-side with the canonical matcher.
    // gh returns newest-first, so the first linked PR is the most recent merge.
    const prs = codeHost.listMergedPullRequests(200);
    const linked = prs.find((pr) => bodyLinksIssue(pr.body, issueNum) && pr.mergedAt);
    if (!linked?.mergedAt) return Promise.resolve(null);
    const d = new Date(linked.mergedAt);
    return Promise.resolve(isNaN(d.getTime()) ? null : d);
  } catch {
    return Promise.resolve(null);
  }
}

/** A step-definition directory may be as wide as the whole scenario tree, so feature files and the Regression Suite's own files are left out. */
function listStepDefFiles(base: SweepBase, directories: ScenarioDirectories): string[] {
  const listed = directories.stepDefinitions.flatMap(directory => lsFilesUnder(base, directory));
  return [...new Set(listed)].filter(p => !p.endsWith(FEATURE_EXTENSION) && !isWithinDirectory(p, directories.regression));
}

/** Lists tracked step-def siblings for issue N from the synced sweep worktree (feature-N.steps.ts, feature-N-world.ts, …). */
function defaultListStepDefSiblings(base: SweepBase, directories: ScenarioDirectories, issueNum: number): string[] {
  return listStepDefFiles(base, directories).filter(p => stepDefIssueNumber(p) === issueNum);
}

function defaultListOrphanStepDefs(base: SweepBase, directories: ScenarioDirectories, featureFiles: readonly string[]): string[] {
  const featureIssues = new Set(featureFiles.map(f => FEATURE_FILENAME_RE.exec(path.basename(f))?.[1]).filter(Boolean).map(Number));
  return listStepDefFiles(base, directories).filter(p => {
    const issueNum = stepDefIssueNumber(p);
    return issueNum !== null && !featureIssues.has(issueNum);
  });
}

function defaultReadDirectories(base: SweepBase | null): ScenarioDirectories {
  const scenarios = base ? loadProjectConfig(base.worktreePath).scenarios : getDefaultScenariosConfig();
  return resolveScenarioDirectories(scenarios);
}

function resolveListers(deps: PerIssueSweepDeps, getBase: () => SweepBase | null, directories: ScenarioDirectories): SweepListers {
  const onBase = (list: (base: SweepBase) => string[]): string[] => {
    const base = getBase();
    return base ? list(base) : [];
  };
  return {
    listFeatures: deps.listFeatures ?? (() => onBase(base => defaultListFeatures(base, directories))),
    listStepDefSiblings: deps.listStepDefSiblings ?? (issueNum => onBase(base => defaultListStepDefSiblings(base, directories, issueNum))),
    listOrphanStepDefs: deps.listOrphanStepDefs ?? (featureFiles => onBase(base => defaultListOrphanStepDefs(base, directories, featureFiles))),
  };
}

/** Runs the post-removal gate in the sweep worktree; returns the paths cleared to land, or null when none may. */
async function defaultGateRemoval(paths: readonly string[], base: SweepBase, logger: (msg: string, level?: LogLevel) => void): Promise<readonly string[] | null> {
  const outcome = await verifyRemoval(paths, worktreeGateDeps(base.worktreePath, () => base.ctx.lsFiles(base.worktreePath), logger));
  switch (outcome.kind) {
    case 'verified':
      logger(`perIssueScenarioSweep: gate passed — ${outcome.removed.length} file(s) cleared to land, ${outcome.kept.length} kept`, 'info');
      return outcome.removed;
    case 'base_red':
      logger(`perIssueScenarioSweep: base branch fails its static checks before any removal (${outcome.detail}) — sweep skipped this cycle`, 'warn');
      return null;
    case 'hard_fail':
      logger(`perIssueScenarioSweep: gate HARD FAIL — removal batch discarded, nothing landed: ${outcome.detail}`, 'error');
      return null;
  }
}

/** The issue and merge date of a stale Per-Issue Scenario; null for any file not swept this cycle. */
async function staleScenarioOf(filePath: string, getMergedAt: (issueNum: number) => Promise<Date | null>, now: Date, logger: Logger): Promise<StaleScenario | null> {
  const basename = path.basename(filePath);
  const match = FEATURE_FILENAME_RE.exec(basename);
  if (!match) {
    logger(`perIssueScenarioSweep: skipping unrecognised filename ${basename}`, 'warn');
    return null;
  }

  const issueNum = parseInt(match[1], 10);
  try {
    const mergedAt = await getMergedAt(issueNum);
    return mergedAt !== null && isScenarioStale(filePath, mergedAt, RETENTION_DAYS, now) ? { issueNum, mergedAt } : null;
  } catch (err) {
    logger(`perIssueScenarioSweep: getMergedAt failed for issue #${issueNum}: ${err} — skipping`, 'warn');
    return null;
  }
}

async function collectRemovalBatch(listers: SweepListers, staleScenario: (filePath: string) => Promise<StaleScenario | null>, exempt: ReadonlySet<number>, logger: Logger): Promise<RemovalBatch> {
  const files = listers.listFeatures();
  const staleFeatures: string[] = [];
  const toRemove: string[] = [];

  for (const filePath of files) {
    const stale = await staleScenario(filePath);
    if (!stale || keptForPromotion(filePath, stale.issueNum, exempt, logger)) continue;
    const siblings = listers.listStepDefSiblings(stale.issueNum);
    logger(
      `perIssueScenarioSweep: sweeping stale scenario ${filePath} (issue #${stale.issueNum} merged ${stale.mergedAt.toISOString()}) + ${siblings.length} step-def sibling(s)`,
      'info',
    );
    staleFeatures.push(filePath);
    toRemove.push(filePath, ...siblings);
  }

  const orphans = listers.listOrphanStepDefs(files).filter(p => !toRemove.includes(p));
  if (orphans.length > 0) {
    logger(`perIssueScenarioSweep: ${orphans.length} step-def file(s) whose feature is already gone: ${orphans.join(', ')}`, 'info');
    toRemove.push(...orphans);
  }
  return { staleFeatures, paths: toRemove };
}

/**
 * Removes every stale Per-Issue Scenario that no promotion keeps, with its step-def sibling(s), and every step-def file
 * whose feature is already gone, as one gated, persisted batch, then files the removal chore the report calls for (see the
 * module doc). Returns the paths that landed: none when nothing is stale, the gate cleared nothing, or the exemption could
 * not be read. The base-dependent defaults (directories, listing, the dry run and persistence) share one
 * lazily-memoized SweepBase, created at most once per call and only when such a default runs (never for a fully-injected
 * caller), and torn down before returning, on every exit path.
 */
export async function runPerIssueScenarioSweep(deps: PerIssueSweepDeps): Promise<string[]> {
  const now = deps.now ?? new Date();
  const getMergedAt = deps.getMergedAt ?? ((issueNum: number) => defaultGetMergedAt(deps.boundary.providers.codeHost, issueNum));
  const logger = deps.log ?? log;
  const { issueTracker } = deps.boundary.providers;
  const exempt = readSweepExemptIssues(deps.readExemptCandidates ?? (() => readSweepExemptCandidates(issueTracker)), logger);
  if (exempt === null) return [];

  let cachedBase: SweepBase | null | undefined;
  const getBase = (): SweepBase | null => {
    if (cachedBase === undefined) cachedBase = prepareSweepBase(deps.boundary);
    return cachedBase;
  };

  const readDirectories = deps.readDirectories ?? (() => defaultReadDirectories(getBase()));
  const readStepUsage = deps.readStepUsage ?? defaultReadStepUsage(getBase, logger);
  const gateRemoval = deps.gateRemoval ?? ((paths: readonly string[], base: SweepBase) => defaultGateRemoval(paths, base, logger));
  const persistRemoval = deps.persistRemoval ?? (async (paths: readonly string[]): Promise<readonly string[]> => {
    const base = getBase();
    if (!base) return [];
    let cleared: readonly string[] = [];
    const landed = await persistRemovalViaPr(paths, base, async (candidates, b) => {
      const result = await gateRemoval(candidates, b);
      cleared = result ?? [];
      return result;
    });
    return landed ? cleared : [];
  });

  try {
    const directories = readDirectories();
    const staleScenario = (filePath: string) => staleScenarioOf(filePath, getMergedAt, now, logger);
    const batch = await collectRemovalBatch(resolveListers(deps, getBase, directories), staleScenario, exempt, logger);

    // Read before anything is removed, while the worktree still equals the default branch; the paths that land then tell
    // which uses are gone, so the one report answers both what to keep and what is left unused.
    const usage = await readStepUsageOutcome(readStepUsage, logger);
    const toRemove = withoutUsedStepFiles(batch.paths, batch.staleFeatures, usage, directories, logger);

    const persisted = toRemove.length === 0 ? [] : await persistRemoval(toRemove);
    const landed = persisted ? [...persisted] : [...toRemove];
    if (usage.kind !== 'usage' && usage.kind !== 'unused') return landed;

    reconcileUnusedStepDefinitions(usage, landed, directories, {
      listOpenRemovalIssues: deps.listOpenRemovalIssues ?? defaultListOpenRemovalIssues(issueTracker),
      fileRemovalIssue: deps.fileRemovalIssue ?? defaultFileRemovalIssue(issueTracker),
      defaultBranch: cachedBase?.defaultBranch ?? null,
      log: logger,
    });
    return landed;
  } finally {
    if (cachedBase) cleanupSweepBase(cachedBase);
  }
}
