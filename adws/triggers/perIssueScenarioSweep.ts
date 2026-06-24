/**
 * Per-issue scenario sweep: deletes features/per-issue/feature-{N}.feature files
 * 14 days after the corresponding issue's PR is merged.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core';
import { getRepoInfo, bodyLinksIssue } from '../github';
import { gitContextForRepo } from '../github/gitContextFactory';

export const RETENTION_DAYS = 14;

const PER_ISSUE_DIR = 'features/per-issue';
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
  deleteFile?: (filePath: string) => void;
  log?: (msg: string, level?: string) => void;
}

function defaultListFeatures(): string[] {
  if (!fs.existsSync(PER_ISSUE_DIR)) return [];
  return fs
    .readdirSync(PER_ISSUE_DIR)
    .filter(name => FEATURE_FILENAME_RE.test(name))
    .map(name => path.join(PER_ISSUE_DIR, name));
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

function defaultDeleteFile(filePath: string): void {
  fs.rmSync(filePath);
}

/**
 * Lists per-issue feature files, checks their linked PR merge date, and deletes
 * any file whose PR was merged more than RETENTION_DAYS ago.
 * Returns the list of deleted file paths.
 */
export async function runPerIssueScenarioSweep(deps?: PerIssueSweepDeps): Promise<string[]> {
  const now = deps?.now ?? new Date();
  const listFeatures = deps?.listFeatures ?? defaultListFeatures;
  const getMergedAt = deps?.getMergedAt ?? defaultGetMergedAt;
  const deleteFile = deps?.deleteFile ?? defaultDeleteFile;
  const logger = deps?.log ?? log;

  const files = listFeatures();
  const deleted: string[] = [];

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

    logger(`perIssueScenarioSweep: deleting stale scenario ${filePath} (issue #${issueNum} merged ${mergedAt?.toISOString()})`, 'info');
    deleteFile(filePath);
    deleted.push(filePath);
  }

  return deleted;
}
