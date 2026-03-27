/**
 * GitHub implementation of the CodeHost interface.
 * Delegates to existing prApi and gitBranchOperations functions.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { RepoInfo } from '../../github/githubApi';
import { execWithRetry, log } from '../../core';
import { fetchPRDetails, fetchPRReviewComments, commentOnPR, fetchPRList } from '../../github/prApi';
import { getDefaultBranch as ghGetDefaultBranch } from '../../vcs/branchOperations';
import { refreshTokenIfNeeded } from '../../github/githubAppAuth';
import {
  type CodeHost,
  type CreatePROptions,
  type PullRequest,
  type PullRequestResult,
  type RepoIdentifier,
  type ReviewComment,
  validateRepoIdentifier,
} from '../types';
import {
  mapPRDetailsToPullRequest,
  mapPRReviewCommentToReviewComment,
  mapPRListItemToPullRequest,
} from './mappers';

/**
 * GitHub-specific implementation of the CodeHost interface.
 * Bound to a specific repository at construction time.
 */
export class GitHubCodeHost implements CodeHost {
  private readonly repoId: RepoIdentifier;
  private readonly repoInfo: RepoInfo;

  constructor(repoId: RepoIdentifier) {
    this.repoId = repoId;
    this.repoInfo = { owner: repoId.owner, repo: repoId.repo };
  }

  /** Returns the bound RepoIdentifier. */
  getRepoIdentifier(): RepoIdentifier {
    return this.repoId;
  }

  /** Delegates to gitBranchOperations.getDefaultBranch(). */
  getDefaultBranch(): string {
    return ghGetDefaultBranch();
  }

  /** Fetches PR details and maps to PullRequest. */
  fetchPullRequest(prNumber: number): PullRequest {
    const pr = fetchPRDetails(prNumber, this.repoInfo);
    return mapPRDetailsToPullRequest(pr);
  }

  /** Posts a comment on the specified PR. */
  commentOnPullRequest(prNumber: number, body: string): void {
    commentOnPR(prNumber, body, this.repoInfo);
  }

  /** Fetches review comments and maps to ReviewComment[]. */
  fetchReviewComments(prNumber: number): ReviewComment[] {
    const comments = fetchPRReviewComments(prNumber, this.repoInfo);
    return comments.map(mapPRReviewCommentToReviewComment);
  }

  /** Lists open PRs and maps to PullRequest[]. */
  listOpenPullRequests(): PullRequest[] {
    const items = fetchPRList(this.repoInfo);
    return items.map(mapPRListItemToPullRequest);
  }

  /**
   * Creates a pull request via `gh pr create` with the provided title and body.
   * Writes the body to a temp file to avoid shell-escaping issues.
   * Returns the PR URL and number.
   */
  createPullRequest(options: CreatePROptions): PullRequestResult {
    refreshTokenIfNeeded();

    const repoFlag = `--repo ${this.repoInfo.owner}/${this.repoInfo.repo}`;

    // Check for an existing open PR on this branch before creating a new one
    try {
      const existing = execWithRetry(
        `gh pr list --head "${options.sourceBranch}" ${repoFlag} --json url,number --limit 1`
      );
      const parsed = JSON.parse(existing) as Array<{ url: string; number: number }>;
      if (parsed.length > 0) {
        const { url, number } = parsed[0];
        log(`Existing PR #${number} found for branch ${options.sourceBranch}, reusing`, 'info');
        return { url, number };
      }
    } catch {
      // If the check fails, fall through to normal PR creation
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-pr-'));
    const tempFilePath = path.join(tempDir, 'pr-body.md');

    try {
      fs.writeFileSync(tempFilePath, options.body, 'utf-8');

      const prUrl = execWithRetry(
        `gh pr create --title "${options.title.replace(/"/g, '\\"')}" --body-file "${tempFilePath}" --base "${options.targetBranch}" --head "${options.sourceBranch}" ${repoFlag}`,
        { shell: '/bin/bash' },
      );

      const numberMatch = prUrl.match(/\/pull\/(\d+)$/);
      if (!numberMatch) {
        throw new Error(`Could not extract PR number from URL: ${prUrl}`);
      }

      return { url: prUrl, number: parseInt(numberMatch[1], 10) };
    } finally {
      try {
        fs.unlinkSync(tempFilePath);
        fs.rmdirSync(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Factory function that creates a GitHubCodeHost bound to the given repository.
 * Validates the RepoIdentifier before construction.
 */
export function createGitHubCodeHost(repoId: RepoIdentifier): CodeHost {
  validateRepoIdentifier(repoId);
  return new GitHubCodeHost(repoId);
}
