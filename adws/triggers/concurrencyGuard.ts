/**
 * Per-repository concurrency limit checker.
 *
 * Counts in-progress issues (has ADW workflow comment + no merged/closed PR)
 * and checks against MAX_CONCURRENT_PER_REPO.
 */

import { execSync } from 'child_process';
import { MAX_CONCURRENT_PER_REPO, log } from '../core';
import type { RepoInfo } from '../github/githubApi';
import { isAdwComment } from '../core/workflowCommentParsing';
import { fetchLinkedPRs, hasLinkedMergedOrClosedPR } from '../github/linkedPrDetector';

interface RawIssueWithComments {
  number: number;
  comments: { body: string }[];
}

/**
 * Fetches open issues with their comments from the repository.
 */
function fetchOpenIssuesWithComments(repoInfo: RepoInfo): RawIssueWithComments[] {
  try {
    const json = execSync(
      `gh issue list --repo ${repoInfo.owner}/${repoInfo.repo} --state open --json number,comments --limit 100`,
      { encoding: 'utf-8' },
    );
    return JSON.parse(json);
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
async function getInProgressIssueCount(repoInfo: RepoInfo): Promise<number> {
  const issues = fetchOpenIssuesWithComments(repoInfo);
  const prs = fetchLinkedPRs(repoInfo);

  let count = 0;
  for (const issue of issues) {
    const hasAdwComment = issue.comments.some((c) => isAdwComment(c.body));
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
export async function isConcurrencyLimitReached(repoInfo: RepoInfo): Promise<boolean> {
  const count = await getInProgressIssueCount(repoInfo);
  const limitReached = count >= MAX_CONCURRENT_PER_REPO;
  if (limitReached) {
    log(`Concurrency limit reached for ${repoInfo.owner}/${repoInfo.repo}: ${count}/${MAX_CONCURRENT_PER_REPO} in-progress issues`);
  }
  return limitReached;
}
