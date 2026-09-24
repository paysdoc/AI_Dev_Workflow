/**
 * The pr-review unaddressed-comment read wired to a launch boundary — the
 * single place `readUnaddressedComments`'s four reads are bound to
 * `boundary.providers.codeHost` and `boundary.gitContext`; `prReviewPhase.ts`
 * and `trigger_cron.ts` share it.
 */

import { readUnaddressedComments, getLastAdwCommitTimestamp, type UnaddressedCommentReads } from '../core/unaddressedComments';
import type { LaunchBoundary } from '../core/launchGitContext';
import type { ReviewComment } from '@paysdoc/devplatform';

export function buildUnaddressedCommentReads(
  boundary: Pick<LaunchBoundary, 'providers' | 'gitContext'>,
): UnaddressedCommentReads<ReviewComment> {
  const { codeHost } = boundary.providers;
  return {
    fetchPullRequest: (n) => codeHost.fetchPullRequest(n),
    fetchReviewComments: (n) => codeHost.fetchReviewComments(n),
    getAuthenticatedUser: () => codeHost.getAuthenticatedUser(),
    lastAdwCommitTimestamp: (branchName) => getLastAdwCommitTimestamp(branchName, boundary.gitContext),
  };
}

export function hasUnaddressedComments(
  prNumber: number,
  boundary: Pick<LaunchBoundary, 'providers' | 'gitContext'>,
): boolean {
  return readUnaddressedComments(prNumber, buildUnaddressedCommentReads(boundary)).length > 0;
}
