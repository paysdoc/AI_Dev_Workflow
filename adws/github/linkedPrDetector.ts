/**
 * Shared linked-PR detection.
 *
 * Detects whether a GitHub issue has a linked merged or closed pull request
 * by scanning PR bodies for an "Implements #N" reference with a digit-boundary
 * guard (prevents #1 from matching inside #12).
 */

import { execSync } from 'child_process';
import { log } from '../core';
import type { RepoInfo } from './githubApi';

export interface LinkedPRRef {
  readonly number: number;
  readonly body: string;
  readonly state: string;
  readonly mergedAt: string | null;
}

/**
 * Returns true when at least one PR in `prs` references `Implements #<issueNumber>`
 * (with a trailing non-digit boundary) and is merged (`mergedAt != null`) or CLOSED.
 */
export function hasLinkedMergedOrClosedPR(
  issueNumber: number,
  prs: readonly LinkedPRRef[],
): boolean {
  // Digit-boundary regex: `Implements #N` must not be followed by another digit.
  // This prevents issue #1 from matching inside `Implements #12`.
  const pattern = new RegExp(`Implements #${issueNumber}(?!\\d)`);
  return prs.some(
    (pr) =>
      pattern.test(pr.body ?? '') &&
      (pr.mergedAt != null || pr.state === 'CLOSED'),
  );
}

/**
 * Fetches all PRs (open + closed + merged) for the repository.
 * Returns [] on error to allow callers to degrade gracefully.
 */
export function fetchLinkedPRs(repoInfo: RepoInfo): LinkedPRRef[] {
  try {
    const json = execSync(
      `gh pr list --repo ${repoInfo.owner}/${repoInfo.repo} --state all --json number,body,state,mergedAt --limit 200`,
      { encoding: 'utf-8' },
    );
    return JSON.parse(json) as LinkedPRRef[];
  } catch (error) {
    log(`Failed to fetch PRs for linked-PR detection: ${error}`, 'error');
    return [];
  }
}
