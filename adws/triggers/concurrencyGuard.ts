import { MAX_CONCURRENT_PER_REPO, log } from '../core';
import { isAdwComment } from '../core/workflowCommentParsing';
import { fetchLinkedPRs, hasLinkedMergedOrClosedPR } from '../forge/linkedPrDetector';
import type { BoundProviders, IssueListEntry } from '@paysdoc/devplatform';

type ConcurrencyProviders = Pick<BoundProviders, 'issueTracker' | 'codeHost'>;

function fetchOpenIssuesWithComments(providers: ConcurrencyProviders): readonly IssueListEntry[] {
  try {
    return providers.issueTracker.listIssues({ fields: ['number', 'comments'], limit: 100 });
  } catch (error) {
    log(`Failed to fetch open issues for concurrency check: ${error}`, 'error');
    return [];
  }
}

/**
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
 * Exported (with the production cap factored out) so tests can pin the threshold
 * without depending on the frozen, env-derived MAX_CONCURRENT_PER_REPO constant.
 */
export async function isConcurrencyLimitReachedAt(providers: ConcurrencyProviders, limit: number): Promise<boolean> {
  const count = await getInProgressIssueCount(providers);
  const limitReached = count >= limit;
  if (limitReached) {
    const { owner, repo } = providers.codeHost.getRepoIdentifier();
    log(`Concurrency limit reached for ${owner}/${repo}: ${count}/${limit} in-progress issues`);
  }
  return limitReached;
}

export async function isConcurrencyLimitReached(providers: ConcurrencyProviders): Promise<boolean> {
  return isConcurrencyLimitReachedAt(providers, MAX_CONCURRENT_PER_REPO);
}
