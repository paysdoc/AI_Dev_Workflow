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

/**
 * Parses owner and repo from a GitHub URL (HTTPS or SSH).
 */
export function getRepoInfoFromUrl(repoUrl: string): RepoInfo {
  const httpsMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/([^/.]+)/);
  const match = httpsMatch || sshMatch;

  if (!match) {
    throw new Error(`Could not parse GitHub URL: ${repoUrl}`);
  }

  return { owner: match[1], repo: match[2] };
}

/**
 * Parses owner and repo from a GitHub repository full name (e.g., "owner/repo").
 */
export function getRepoInfoFromPayload(repoFullName: string): RepoInfo {
  const parts = repoFullName.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`Invalid repository full name: ${repoFullName}`);
  }
  return { owner: parts[0], repo: parts[1] };
}

// Re-export issue API functions
export {
  fetchGitHubIssue,
  commentOnIssue,
  formatIssueClosureComment,
  getIssueState,
  getIssueTitleSync,
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
