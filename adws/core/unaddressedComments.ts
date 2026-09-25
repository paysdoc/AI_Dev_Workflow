/**
 * The port cannot express the filter as a single field read: excluding bot,
 * self-authored and ADW-signed comments needs `ReviewComment.isBot` (a data
 * widening) plus `CodeHost.getAuthenticatedUser()` (a method widening) plus a
 * git read for the branch's last ADW commit. This module composes those three
 * reads exactly as the legacy composite did — same log lines, same "fetch the
 * PR a second time" behaviour, same laziness (the git read only fires once a
 * human comment exists to test against).
 */

import { log } from './utils';
import type { GitContext, Logger } from '@paysdoc/devplatform/git';
import { isAdwComment } from './workflowCommentParsing';

/**
 * Structural regex matching the universal ADW commit format: `<agentName>: <issueClass>: <message>`.
 * The double colon-space prefix is distinctive to ADW commits — normal developer commits use a single
 * prefix like `feat: message`. This pattern is forward-compatible with new agents and issue types.
 */
const ADW_COMMIT_PATTERN = /^[\w/-]+: \w+: /;

/** Returns null if no ADW commits are found. */
export function getLastAdwCommitTimestamp(branchName: string, gitContext: GitContext, cwd?: string): Date | null {
  try {
    const output = gitContext.log(branchName, cwd);

    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) continue;
      const timestamp = line.substring(0, spaceIdx);
      const message = line.substring(spaceIdx + 1);

      if (ADW_COMMIT_PATTERN.test(message)) {
        return new Date(timestamp);
      }
    }

    return null;
  } catch (error) {
    log(`Failed to get last ADW commit timestamp: ${error}`, 'error');
    return null;
  }
}

export interface UnaddressedCommentCandidate {
  readonly author: string;
  readonly isBot?: boolean;
  readonly body: string;
  readonly createdAt: string;
}

export interface UnaddressedCommentReads<C extends UnaddressedCommentCandidate> {
  fetchPullRequest(prNumber: number): { readonly sourceBranch: string };
  fetchReviewComments(prNumber: number): readonly C[];
  getAuthenticatedUser(): string | null;
  lastAdwCommitTimestamp(branchName: string): Date | null;
}

/**
 * Returns the review comments on `prNumber` posted after the branch's last
 * ADW commit, filtering out bot, self-authored and ADW-signed comments first.
 * When no human comments remain, returns `[]` without ever asking for the
 * last-ADW-commit timestamp.
 */
export function readUnaddressedComments<C extends UnaddressedCommentCandidate>(
  prNumber: number,
  reads: UnaddressedCommentReads<C>,
  logger: Logger = log,
): C[] {
  logger(`Fetching unaddressed comments for PR #${prNumber}`);
  const pr = reads.fetchPullRequest(prNumber);
  const comments = reads.fetchReviewComments(prNumber);
  logger(`Found ${comments.length} total comments on PR #${prNumber}`);

  const authenticatedUser = reads.getAuthenticatedUser();
  const humanComments = comments.filter((c) => {
    if (c.isBot) return false;
    if (authenticatedUser && c.author === authenticatedUser) return false;
    if (isAdwComment(c.body)) return false;
    return true;
  });
  logger(`Found ${humanComments.length} human comments (filtered ${comments.length - humanComments.length} bot/self/ADW comments)`);

  if (humanComments.length === 0) {
    logger(`No human comments found on PR #${prNumber}, returning empty`);
    return [];
  }

  const lastAdwCommit = reads.lastAdwCommitTimestamp(pr.sourceBranch);
  logger(`Last ADW commit timestamp for branch ${pr.sourceBranch}: ${lastAdwCommit ?? 'none'}`);

  if (!lastAdwCommit) {
    logger(`No ADW commits found, treating all ${humanComments.length} human comments as unaddressed`);
    return humanComments;
  }

  const unaddressed = humanComments.filter((c) => new Date(c.createdAt) > lastAdwCommit);
  logger(`Found ${unaddressed.length} unaddressed comments (after ${lastAdwCommit.toISOString()})`);
  return unaddressed;
}
