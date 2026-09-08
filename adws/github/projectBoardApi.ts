/**
 * GitHub Projects V2 API — thin wrapper over the forge adapter's GhRepoApi.
 * All project-board GraphQL is handled in GhRepoApi.moveIssueToStatus().
 */

import { log } from '../core';
import type { RepoIdentifier } from '../providers/types';
import { gitContextForRepo } from './gitContextFactory';
import { notifyReviewTransition } from './hitlBoardNotifier';
import { createGhRepoApi } from '../providers/github/ghRepoApi';

const gh = (repoInfo: RepoIdentifier) => createGhRepoApi(gitContextForRepo(repoInfo));

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
  repoInfo: RepoIdentifier,
): Promise<boolean> {
  try {
    const repoApi = gh(repoInfo);
    const moved = repoApi.moveIssueToStatus(issueNumber, targetStatus);
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
