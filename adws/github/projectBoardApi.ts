/**
 * GitHub Projects V2 API — thin adapter over GitContext.
 * All project-board GraphQL is handled in GitContext.moveIssueToStatus().
 */

import { log } from '../core';
import { type RepoInfo } from './githubApi';
import { gitContextForRepo } from './gitContextFactory';
import { notifyReviewTransition } from './hitlBoardNotifier';

/**
 * Moves a GitHub issue to a target status on its project board.
 * Silently handles all error cases (no project, issue not in project,
 * target status not available, already in target status, API errors).
 *
 * @param issueNumber - The issue number to move
 * @param targetStatus - The target status name (e.g., "In Progress", "Review")
 * @param repoInfo - Optional repository info override
 */
export async function moveIssueToStatus(
  issueNumber: number,
  targetStatus: string,
  repoInfo: RepoInfo,
): Promise<boolean> {
  try {
    const ctx = gitContextForRepo(repoInfo);
    const moved = ctx.moveIssueToStatus(issueNumber, targetStatus);
    if (moved && targetStatus.toLowerCase() === 'review') {
      // Await delivery so the orchestrator process cannot exit before the Slack
      // POST settles (issue #647: the void-dispatched fetch was torn down on exit).
      await notifyReviewTransition({ issueNumber, repoInfo });
    }
    return moved;
  } catch (error) {
    log(`Failed to move issue #${issueNumber} to "${targetStatus}": ${error}`, 'error');
    return false;
  }
}
