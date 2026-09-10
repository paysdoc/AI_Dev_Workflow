/**
 * Per-issue scenario sweep: removes features/per-issue/feature-{N}.feature files
 * (and their features/per-issue/step_definitions/feature-{N}.* step-def siblings)
 * 14 days after the corresponding issue's PR is merged. Listing, staleness
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
import type { LaunchBoundary } from '../core';
import type { CodeHost } from '../providers/types';

export const RETENTION_DAYS = 14;

const PER_ISSUE_DIR = 'features/per-issue';
const STEP_DEF_DIR = 'features/per-issue/step_definitions';
const FEATURE_FILENAME_RE = /^feature-(\d+)\.feature$/;

/**
 * Pure staleness predicate.
 *
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
  persistRemoval?: (paths: readonly string[]) => void | Promise<void>;
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
 * Finds the merge date of the most recent merged PR that closes `issueNum`,
 * by scanning the code host's recent merged PRs and matching the canonical
 * "Closes owner/repo#N" body marker. Returns null if no merged PR links the
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

/** Lists tracked step-def siblings for issue N from the synced sweep worktree (any framework extension, e.g. feature-N.steps.ts). */
function defaultListStepDefSiblings(base: SweepBase, issueNum: number): string[] {
  try {
    return base.ctx.lsFiles(base.worktreePath, STEP_DEF_DIR).filter(p => path.basename(p).startsWith(`feature-${issueNum}.`));
  } catch {
    return [];
  }
}

/** Reads a stale candidate's content from the synced sweep worktree to check its promotion tag state. Fail-safe: null on any error. */
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
 * every stale file plus its step-def sibling(s) as one persisted batch.
 * Returns the list of removed file paths (empty when nothing is stale — no-op,
 * no commit).
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
  const persistRemoval = deps.persistRemoval ?? (async (paths: readonly string[]) => {
    const base = getBase();
    if (base) await persistRemovalViaPr(paths, base);
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

    if (toRemove.length === 0) return [];

    await persistRemoval(toRemove);
    return toRemove;
  } finally {
    if (cachedBase) cleanupSweepBase(cachedBase);
  }
}
