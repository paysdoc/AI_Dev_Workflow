/**
 * GitHub implementation of the CodeHost interface.
 * Delegates to existing prApi and gitBranchOperations functions.
 */

import type { RepoInfo } from '../../github/githubApi';
import { log } from '../../core';
import { fetchPRDetails, fetchPRReviewComments, commentOnPR, fetchPRList } from '../../github/prApi';
import { gitContextForSync, gitContextForRepo } from '../../github/gitContextFactory';
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

  getDefaultBranch(): string {
    return gitContextForSync({ owner: this.repoId.owner, repo: this.repoId.repo, selfHost: false }).defaultBranch();
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
   * Returns the PR URL and number.
   */
  createPullRequest(options: CreatePROptions): PullRequestResult {
    const ctx = gitContextForRepo(this.repoInfo);

    // Check for an existing open PR on this branch before creating a new one
    try {
      const existingJson = ctx.findPRByBranch(options.sourceBranch);
      const parsed = JSON.parse(existingJson) as Array<{ number: number; state: string; headRefName: string; baseRefName: string; updatedAt: string }>;
      const open = parsed.filter((p) => p.state === 'OPEN');
      if (open.length > 0) {
        const pr = open[0];
        const url = `https://github.com/${this.repoInfo.owner}/${this.repoInfo.repo}/pull/${pr.number}`;
        log(`Existing PR #${pr.number} found for branch ${options.sourceBranch}, reusing`, 'info');
        return { url, number: pr.number };
      }
    } catch {
      // If the check fails, fall through to normal PR creation
    }

    const prUrl = ctx.createPR(options.title, options.body, options.sourceBranch, options.targetBranch);

    const numberMatch = prUrl.match(/\/pull\/(\d+)$/);
    if (!numberMatch) {
      throw new Error(`Could not extract PR number from URL: ${prUrl}`);
    }

    return { url: prUrl, number: parseInt(numberMatch[1], 10) };
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
