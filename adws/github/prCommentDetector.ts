/**
 * PR Comment Detector - Detects unaddressed PR review comments.
 *
 * Compares PR review comment timestamps against the last ADW commit
 * on the branch to determine which comments still need to be addressed.
 */

import { execSync } from 'child_process';
import { PRReviewComment, log } from '../core';
import { resolveTargetRepoCwd } from '../core/targetRepoRegistry';
import { fetchPRDetails, fetchPRReviewComments } from './githubApi';
import type { RepoInfo } from './githubApi';

/**
 * Structural regex matching the universal ADW commit format: `<agentName>: <issueClass>: <message>`.
 * The double colon-space prefix is distinctive to ADW commits — normal developer commits use a single
 * prefix like `feat: message`. This pattern is forward-compatible with new agents and issue types.
 */
export const ADW_COMMIT_PATTERN = /^[\w/-]+: \w+: /;

/**
 * Gets the timestamp of the last ADW commit on the given branch.
 * Matches commits using the structural ADW commit format `<agentName>: <issueClass>: <message>`.
 * Returns null if no ADW commits are found.
 */
export function getLastAdwCommitTimestamp(branchName: string, cwd?: string): Date | null {
  try {
    const resolvedCwd = resolveTargetRepoCwd(cwd);
    const output = execSync(
      `git log "${branchName}" --format="%aI %s" --no-merges`,
      { encoding: 'utf-8', cwd: resolvedCwd }
    );

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

/**
 * Gets unaddressed PR review comments — comments posted after the last ADW commit.
 * If no ADW commits are found, all non-bot comments are considered unaddressed.
 */
export function getUnaddressedComments(prNumber: number, repoInfo?: RepoInfo): PRReviewComment[] {
  log(`Fetching unaddressed comments for PR #${prNumber}`);
  const prDetails = fetchPRDetails(prNumber, repoInfo);
  const comments = fetchPRReviewComments(prNumber, repoInfo);
  log(`Found ${comments.length} total comments on PR #${prNumber}`);

  // Filter out bot comments
  const humanComments = comments.filter(c => !c.author.isBot);
  log(`Found ${humanComments.length} human comments (filtered ${comments.length - humanComments.length} bot comments)`);

  if (humanComments.length === 0) {
    log(`No human comments found on PR #${prNumber}, returning empty`);
    return [];
  }

  const lastAdwCommit = getLastAdwCommitTimestamp(prDetails.headBranch);
  log(`Last ADW commit timestamp for branch ${prDetails.headBranch}: ${lastAdwCommit ?? 'none'}`);

  if (!lastAdwCommit) {
    // No ADW commits found — treat all human comments as unaddressed
    log(`No ADW commits found, treating all ${humanComments.length} human comments as unaddressed`);
    return humanComments;
  }

  // Return comments created after the last ADW commit
  const unaddressed = humanComments.filter(c => new Date(c.createdAt) > lastAdwCommit);
  log(`Found ${unaddressed.length} unaddressed comments (after ${lastAdwCommit.toISOString()})`);
  return unaddressed;
}

/**
 * Returns true if the PR has any unaddressed review comments.
 */
export function hasUnaddressedComments(prNumber: number, repoInfo?: RepoInfo): boolean {
  return getUnaddressedComments(prNumber, repoInfo).length > 0;
}
