/**
 * Shared linked-PR detection.
 *
 * Detects whether a GitHub issue has a linked merged or closed pull request
 * by scanning PR bodies for a `Closes`/`Implements #N` reference (see
 * issueLinkMarker for the canonical match, including the optional owner/repo
 * qualifier and the digit-boundary guard).
 */

import { log } from '../core';
import type { RepoInfo } from './githubApi';
import { bodyLinksIssue } from './issueLinkMarker';
import { gitContextForRepo } from './gitContextFactory';
import { createGhRepoApi } from '../providers/github/ghRepoApi';

const gh = (repoInfo: RepoInfo) => createGhRepoApi(gitContextForRepo(repoInfo));

export interface LinkedPRRef {
  readonly number: number;
  readonly body: string;
  readonly state: string;
  readonly mergedAt: string | null;
}

/**
 * Returns true when at least one PR in `prs` links `issueNumber` via a
 * recognised closing keyword (see issueLinkMarker) and is merged
 * (`mergedAt != null`) or CLOSED.
 */
export function hasLinkedMergedOrClosedPR(
  issueNumber: number,
  prs: readonly LinkedPRRef[],
): boolean {
  return prs.some(
    (pr) =>
      bodyLinksIssue(pr.body, issueNumber) &&
      (pr.mergedAt != null || pr.state === 'CLOSED'),
  );
}

/**
 * Fetches all PRs (open + closed + merged) for the repository.
 * Returns [] on error to allow callers to degrade gracefully.
 */
export function fetchLinkedPRs(repoInfo: RepoInfo): LinkedPRRef[] {
  try {
    const json = gh(repoInfo).fetchAllPRs();
    return JSON.parse(json) as LinkedPRRef[];
  } catch (error) {
    log(`Failed to fetch PRs for linked-PR detection: ${error}`, 'error');
    return [];
  }
}
