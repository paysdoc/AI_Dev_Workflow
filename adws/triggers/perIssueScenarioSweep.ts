/**
 * Per-issue scenario sweep: removes features/per-issue/feature-{N}.feature files
 * (and their features/per-issue/step_definitions/feature-{N}.* and feature-{N}-*
 * step-def siblings) 14 days after the corresponding issue's PR is merged, plus
 * any step-def file whose feature-{N}.feature is already gone. Every batch passes
 * the post-removal gate (sweepRemovalGate.ts) before it is committed: files a
 * survivor still imports are kept, and a batch that leaves the repo's static
 * checks red is repaired or discarded — never landed. Listing, staleness
 * decisions, and the removal itself all run against a dedicated worktree synced
 * to fresh origin/<default> (see perIssueSweepPersist.ts) — never the cron
 * host's own, possibly stale, base checkout. The removal is pushed on a
 * dedicated sweep branch and landed via an immediately-merged pull request,
 * never a direct commit/push onto the shared default branch.
 *
 * Identity comes entirely from the caller's injected launch boundary
 * (`deps.boundary`) — this module performs no repo-identity resolution of
 * its own.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log, type LogLevel } from '../core';
import { bodyLinksIssue } from '../forge/issueLinkMarker';
import { parsePromotionTagState, isPromotionExempt } from '../core/promotionTagState';
import { prepareSweepBase, persistRemovalViaPr, cleanupSweepBase, type SweepBase } from './perIssueSweepPersist';
import { verifyRemoval, worktreeGateDeps } from './sweepRemovalGate';
import type { LaunchBoundary } from '../core';
import type { CodeHost } from '@paysdoc/devplatform';

export const RETENTION_DAYS = 14;

const PER_ISSUE_DIR = 'features/per-issue';
const STEP_DEF_DIR = 'features/per-issue/step_definitions';
const FEATURE_FILENAME_RE = /^feature-(\d+)\.feature$/;
// A step-def file belongs to issue N when named feature-N.<ext> or split as feature-N-<part>.<ext>.
const STEP_DEF_ISSUE_RE = /^feature-(\d+)[.-]/;

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
  log?: (msg: string, level?: string) => void;
  readFeatureContent?: (filePath: string) => string | null;
}

/**
 * Lists tracked feature files from a dedicated worktree synced to fresh
 * origin/<default> (see prepareSweepBase) — never the cron host's own,
 * possibly stale, base checkout. Deciding and persisting off this synced base
 * is what makes the sweep self-healing: a removal whose push/PR/merge failed
 * in a prior cycle was never committed to the base, so the file is still
 * tracked on origin and is re-listed (and re-attempted) here.
 */
function defaultListFeatures(base: SweepBase): string[] {
  try {
    return base.ctx.lsFiles(base.worktreePath, PER_ISSUE_DIR).filter(p => FEATURE_FILENAME_RE.test(path.basename(p)));
  } catch {
    return [];
  }
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

function listStepDefFiles(base: SweepBase): string[] {
  try {
    return base.ctx.lsFiles(base.worktreePath, STEP_DEF_DIR);
  } catch {
    return [];
  }
}

/** Lists tracked step-def siblings for issue N from the synced sweep worktree (feature-N.steps.ts, feature-N-world.ts, …). */
function defaultListStepDefSiblings(base: SweepBase, issueNum: number): string[] {
  return listStepDefFiles(base).filter(p => stepDefIssueNumber(p) === issueNum);
}

function defaultListOrphanStepDefs(base: SweepBase, featureFiles: readonly string[]): string[] {
  const featureIssues = new Set(featureFiles.map(f => FEATURE_FILENAME_RE.exec(path.basename(f))?.[1]).filter(Boolean).map(Number));
  return listStepDefFiles(base).filter(p => {
    const issueNum = stepDefIssueNumber(p);
    return issueNum !== null && !featureIssues.has(issueNum);
  });
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

/** Fail-safe: null on any error. */
function defaultReadFeatureContent(base: SweepBase, filePath: string): string | null {
  try {
    return fs.readFileSync(path.join(base.worktreePath, filePath), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Reads and parses a stale candidate's promotion tag state to decide whether
 * it should be exempted from this sweep. Fails safe toward preservation: an
 * unreadable file is treated as exempt (skip deletion, self-heals next sweep)
 * rather than swept while its promotion state is unknown.
 */
function shouldSkipForPromotionState(
  filePath: string,
  readFeatureContent: (filePath: string) => string | null,
  logger: (msg: string, level?: LogLevel) => void,
): boolean {
  const content = readFeatureContent(filePath);
  if (content === null) {
    logger(
      `perIssueScenarioSweep: could not read ${filePath} to check promotion state — skipping deletion (conservative)`,
      'warn',
    );
    return true;
  }

  const state = parsePromotionTagState(content);
  if (isPromotionExempt(state)) {
    logger(`perIssueScenarioSweep: ${filePath} is promotion-exempt (@promotion-suggested) — not sweeping`, 'info');
    return true;
  }

  return false;
}

/**
 * Lists per-issue feature files, checks their linked PR merge date, and removes
 * every stale file plus its step-def sibling(s), and every step-def file whose
 * feature is already gone, as one gated, persisted batch. Returns the paths that
 * landed (empty when nothing is stale, or the gate cleared nothing — no commit).
 *
 * The base-dependent defaults (listing, content reads, and persistence) share a
 * single lazily-memoized SweepBase — a dedicated worktree synced to fresh
 * origin/<default> — created at most once per call, and only when a
 * base-dependent default actually runs (never for a fully-injected caller). The
 * worktree is always torn down before returning, on every exit path.
 */
export async function runPerIssueScenarioSweep(deps: PerIssueSweepDeps): Promise<string[]> {
  const now = deps.now ?? new Date();
  const getMergedAt = deps.getMergedAt ?? ((issueNum: number) => defaultGetMergedAt(deps.boundary.providers.codeHost, issueNum));
  const logger = deps.log ?? log;

  let cachedBase: SweepBase | null | undefined;
  const getBase = (): SweepBase | null => {
    if (cachedBase === undefined) cachedBase = prepareSweepBase(deps.boundary);
    return cachedBase;
  };

  const listFeatures = deps.listFeatures ?? (() => {
    const base = getBase();
    return base ? defaultListFeatures(base) : [];
  });
  const listStepDefSiblings = deps.listStepDefSiblings ?? ((issueNum: number) => {
    const base = getBase();
    return base ? defaultListStepDefSiblings(base, issueNum) : [];
  });
  const readFeatureContent = deps.readFeatureContent ?? ((filePath: string) => {
    const base = getBase();
    return base ? defaultReadFeatureContent(base, filePath) : null;
  });
  const listOrphanStepDefs = deps.listOrphanStepDefs ?? ((featureFiles: readonly string[]) => {
    const base = getBase();
    return base ? defaultListOrphanStepDefs(base, featureFiles) : [];
  });
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
    const files = listFeatures();
    const toRemove: string[] = [];

    for (const filePath of files) {
      const basename = path.basename(filePath);
      const match = FEATURE_FILENAME_RE.exec(basename);
      if (!match) {
        logger(`perIssueScenarioSweep: skipping unrecognised filename ${basename}`, 'warn');
        continue;
      }

      const issueNum = parseInt(match[1], 10);
      let mergedAt: Date | null = null;
      try {
        mergedAt = await getMergedAt(issueNum);
      } catch (err) {
        logger(`perIssueScenarioSweep: getMergedAt failed for issue #${issueNum}: ${err} — skipping`, 'warn');
        continue;
      }

      if (!isScenarioStale(filePath, mergedAt, RETENTION_DAYS, now)) continue;
      if (shouldSkipForPromotionState(filePath, readFeatureContent, logger)) continue;

      const siblings = listStepDefSiblings(issueNum);
      logger(
        `perIssueScenarioSweep: sweeping stale scenario ${filePath} (issue #${issueNum} merged ${mergedAt?.toISOString()}) + ${siblings.length} step-def sibling(s)`,
        'info',
      );
      toRemove.push(filePath, ...siblings);
    }

    const orphans = listOrphanStepDefs(files).filter(p => !toRemove.includes(p));
    if (orphans.length > 0) {
      logger(`perIssueScenarioSweep: ${orphans.length} step-def file(s) whose feature is already gone: ${orphans.join(', ')}`, 'info');
      toRemove.push(...orphans);
    }

    if (toRemove.length === 0) return [];

    const landed = await persistRemoval(toRemove);
    return landed ? [...landed] : toRemove;
  } finally {
    if (cachedBase) cleanupSweepBase(cachedBase);
  }
}
