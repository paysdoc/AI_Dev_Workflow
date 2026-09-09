/**
 * PR Comment Detector - Detects unaddressed PR review comments.
 *
 * Compares PR review comment timestamps against the last ADW commit
 * on the branch to determine which comments still need to be addressed.
 */

import { fetchPRDetails, fetchPRReviewComments, getAuthenticatedUser } from './githubApi';
import type { PRReviewComment } from '../providers/github/domain/pullRequest';
import type { RepoIdentifier } from '../providers/types';
import { gitContextForRepo } from './gitContextFactory';
import { readUnaddressedComments, getLastAdwCommitTimestamp, type UnaddressedCommentCandidate } from '../core/unaddressedComments';

// Re-exported: the git-only half of the composite lives in adws/core/unaddressedComments.ts (#820).
export { getLastAdwCommitTimestamp };

/** Wraps a legacy `PRReviewComment` in the flat shape `readUnaddressedComments` filters on, carrying the original alongside so the wrapper below can return it unchanged. */
interface WrappedComment extends UnaddressedCommentCandidate {
  readonly original: PRReviewComment;
}

function wrapComment(c: PRReviewComment): WrappedComment {
  return { author: c.author.login, isBot: c.author.isBot, body: c.body, createdAt: c.createdAt, original: c };
}

/**
 * Gets unaddressed PR review comments — comments posted after the last ADW commit.
 * If no ADW commits are found, all non-bot comments are considered unaddressed.
 *
 * Thin legacy wrapper over `adws/core/unaddressedComments.ts`'s
 * `readUnaddressedComments`, kept alive for `trigger_cron.ts`'s
 * boundary-less call (#821 migrates that caller).
 */
export function getUnaddressedComments(prNumber: number, repoInfo: RepoIdentifier): PRReviewComment[] {
  const unaddressed = readUnaddressedComments<WrappedComment>(prNumber, {
    fetchPullRequest: (n) => ({ sourceBranch: fetchPRDetails(n, repoInfo).headBranch }),
    fetchReviewComments: (n) => fetchPRReviewComments(n, repoInfo).map(wrapComment),
    getAuthenticatedUser,
    lastAdwCommitTimestamp: (branchName) => getLastAdwCommitTimestamp(branchName, gitContextForRepo(repoInfo)),
  });
  return unaddressed.map((c) => c.original);
}

/**
 * Returns true if the PR has any unaddressed review comments.
 */
export function hasUnaddressedComments(prNumber: number, repoInfo: RepoIdentifier): boolean {
  return getUnaddressedComments(prNumber, repoInfo).length > 0;
}
