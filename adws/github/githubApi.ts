/**
 * GitHub API functions using the gh CLI.
 */

import { execSync } from 'child_process';

export interface RepoInfo {
  owner: string;
  repo: string;
}

/**
 * Extracts owner and repo from the git remote URL.
 * Supports both HTTPS and SSH URL formats.
 */
export function getRepoInfo(): RepoInfo {
  try {
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();

    const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/([^/.]+)/);
    const match = httpsMatch || sshMatch;

    if (!match) {
      throw new Error(`Could not parse GitHub URL: ${remoteUrl}`);
    }

    return { owner: match[1], repo: match[2] };
  } catch (error) {
    throw new Error(`Failed to get repo info: ${error}`);
  }
}

// Re-export issue API functions
export {
  fetchGitHubIssue,
  commentOnIssue,
  formatIssueClosureComment,
  getIssueState,
  closeIssue,
  fetchIssueCommentsRest,
  deleteIssueComment,
} from './issueApi';

// Re-export PR API functions
export {
  fetchPRDetails,
  fetchPRReviews,
  fetchPRReviewComments,
  commentOnPR,
  fetchPRList,
} from './prApi';
