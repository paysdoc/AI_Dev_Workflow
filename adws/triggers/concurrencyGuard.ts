/**
 * Per-repository concurrency limit checker.
 *
 * Counts in-progress issues (has ADW workflow comment + no merged/closed PR)
 * and checks against MAX_CONCURRENT_PER_REPO.
 */

import { MAX_CONCURRENT_PER_REPO, log } from '../core';
import { isAdwComment } from '../core/workflowCommentParsing';
import { fetchLinkedPRs, hasLinkedMergedOrClosedPR } from '../forge/linkedPrDetector';
import type { BoundProviders, IssueListEntry } from '../providers/types';

type ConcurrencyProviders = Pick<BoundProviders, 'issueTracker' | 'codeHost'>;

/**
 * Fetches open issues with their comments from the repository.
 */
function fetchOpenIssuesWithComments(providers: ConcurrencyProviders): readonly IssueListEntry[] {
  try {
    return providers.issueTracker.listIssues({ fields: ['number', 'comments'], limit: 100 });
  } catch (error) {
    log(`Failed to fetch open issues for concurrency check: ${error}`, 'error');
    return [];
  }
}

/**
 * Counts the number of in-progress issues for a repository.
 * An issue is "in progress" when it has an ADW workflow comment and
 * does not yet have a linked merged/closed PR.
 */
async function getInProgressIssueCount(providers: ConcurrencyProviders): Promise<number> {
  const issues = fetchOpenIssuesWithComments(providers);
  const prs = fetchLinkedPRs(providers.codeHost);

  let count = 0;
  for (const issue of issues) {
    const hasAdwComment = (issue.comments ?? []).some((c) => isAdwComment(c.body));
    if (!hasAdwComment) continue;

    if (!hasLinkedMergedOrClosedPR(issue.number, prs)) {
      count++;
    }
  }

  return count;
}

/**
 * Returns true if the per-repository concurrency limit has been reached or exceeded.
 */
export async function isConcurrencyLimitReached(providers: ConcurrencyProviders): Promise<boolean> {
  const count = await getInProgressIssueCount(providers);
  const limitReached = count >= MAX_CONCURRENT_PER_REPO;
  if (limitReached) {
    const { owner, repo } = providers.codeHost.getRepoIdentifier();
    log(`Concurrency limit reached for ${owner}/${repo}: ${count}/${MAX_CONCURRENT_PER_REPO} in-progress issues`);
  }
  return limitReached;
}
