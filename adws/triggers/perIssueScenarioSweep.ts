/**
 * Per-issue scenario sweep: removes features/per-issue/feature-{N}.feature files
 * (and their features/per-issue/step_definitions/feature-{N}.* step-def siblings)
 * 14 days after the corresponding issue's PR is merged. The removal is committed
 * and pushed to the default branch via GitContext so it persists to origin — a
 * clean cron run leaves no uncommitted working-tree deletions.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log, type LogLevel } from '../core';
import { getRepoInfo, bodyLinksIssue } from '../github';
import { gitContextForRepo } from '../github/gitContextFactory';
import { parsePromotionTagState, isPromotionExempt } from '../core/promotionTagState';

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
  now?: Date;
  listFeatures?: () => string[];
  getMergedAt?: (issueNum: number) => Promise<Date | null>;
  listStepDefSiblings?: (issueNum: number) => string[];
  persistRemoval?: (paths: readonly string[]) => void;
  log?: (msg: string, level?: string) => void;
  readFeatureContent?: (filePath: string) => string | null;
}

/**
 * Lists tracked feature files (the git index, not the working tree) so staleness
 * is decided on what the repo actually carries. This also makes the sweep
 * self-healing: a file already removed from the working tree in a prior,
 * unpersisted cycle is still tracked, so it is re-listed and persisted here.
 */
function defaultListFeatures(): string[] {
  try {
    const ctx = gitContextForRepo(getRepoInfo());
    return ctx.lsFiles(ctx.basePath, PER_ISSUE_DIR).filter(p => FEATURE_FILENAME_RE.test(path.basename(p)));
  } catch {
    return [];
  }
}

function defaultGetMergedAt(issueNum: number): Promise<Date | null> {
  try {
    const repoInfo = getRepoInfo();
    // GitHub search can't reliably express the "Closes owner/repo#N" body marker,
    // so fetch merged PRs and filter client-side with the canonical matcher.
    // gh returns newest-first, so the first linked PR is the most recent merge.
    const json = gitContextForRepo(repoInfo).fetchMergedPRs(200);
    const prs = JSON.parse(json) as Array<{ body: string; mergedAt: string | null }>;
    const linked = prs.find((pr) => bodyLinksIssue(pr.body, issueNum) && pr.mergedAt);
    if (!linked?.mergedAt) return Promise.resolve(null);
    const d = new Date(linked.mergedAt);
    return Promise.resolve(isNaN(d.getTime()) ? null : d);
  } catch {
    return Promise.resolve(null);
  }
}

/** Lists tracked step-def siblings for issue N (any framework extension, e.g. feature-N.steps.ts). */
function defaultListStepDefSiblings(issueNum: number): string[] {
  try {
    const ctx = gitContextForRepo(getRepoInfo());
    return ctx.lsFiles(ctx.basePath, STEP_DEF_DIR).filter(p => path.basename(p).startsWith(`feature-${issueNum}.`));
  } catch {
    return [];
  }
}

/** Reads a stale candidate's working-tree content to check its promotion tag state. Fail-safe: null on any error. */
function defaultReadFeatureContent(filePath: string): string | null {
  try {
    const ctx = gitContextForRepo(getRepoInfo());
    return fs.readFileSync(path.join(ctx.basePath, filePath), 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Persists a removal batch: `git rm` + a commit scoped to exactly `paths` (never
 * `git add -A` — unrelated dirty state on the cron host must not be swept in),
 * pushed to the default branch. Only mutates when the checkout is actually on
 * the default branch, and never throws — a transient git/gh failure is logged
 * and swallowed so the unwrapped caller in trigger_cron.ts can't be crashed by it.
 * A failed push self-heals on the next sweep that finds anything stale, since the
 * local commit made here is carried forward.
 */
function defaultPersistRemoval(paths: readonly string[]): void {
  if (paths.length === 0) return;
  try {
    const ctx = gitContextForRepo(getRepoInfo());
    const branch = ctx.defaultBranch();
    if (ctx.getCurrentBranch(ctx.basePath) !== branch) {
      log(`perIssueScenarioSweep: checkout is not on default branch "${branch}" — skipping persistence`, 'warn');
      return;
    }
    const committed = ctx.removeAndCommitPaths(
      paths,
      'chore: sweep stale per-issue scenarios (>14d post-merge)',
      ctx.basePath,
    );
    if (committed) ctx.pushBranch(branch, ctx.basePath);
  } catch (err) {
    log(`perIssueScenarioSweep: persistRemoval failed: ${err} — leaving removal uncommitted for next sweep`, 'warn');
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
 */
export async function runPerIssueScenarioSweep(deps?: PerIssueSweepDeps): Promise<string[]> {
  const now = deps?.now ?? new Date();
  const listFeatures = deps?.listFeatures ?? defaultListFeatures;
  const getMergedAt = deps?.getMergedAt ?? defaultGetMergedAt;
  const listStepDefSiblings = deps?.listStepDefSiblings ?? defaultListStepDefSiblings;
  const persistRemoval = deps?.persistRemoval ?? defaultPersistRemoval;
  const logger = deps?.log ?? log;
  const readFeatureContent = deps?.readFeatureContent ?? defaultReadFeatureContent;

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

  persistRemoval(toRemove);
  return toRemove;
}
