/**
 * GitHub implementation of the CodeHost interface.
 * Delegates to existing prApi, pullRequestCreator, and gitBranchOperations functions.
 */

import type { RepoInfo } from '../../github/githubApi';
import type { GitHubIssue } from '../../types/issueTypes';
import { fetchPRDetails, fetchPRReviewComments, commentOnPR, fetchPRList } from '../../github/prApi';
import { createPullRequest } from '../../github/pullRequestCreator';
import { getDefaultBranch as ghGetDefaultBranch } from '../../github/gitBranchOperations';
import {
  type CodeHost,
  type CreateMROptions,
  type MergeRequest,
  type RepoIdentifier,
  type ReviewComment,
  validateRepoIdentifier,
} from '../types';
import {
  mapPRDetailsToMergeRequest,
  mapPRReviewCommentToReviewComment,
  mapPRListItemToMergeRequest,
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

  /** Fetches PR details and maps to MergeRequest. */
  fetchMergeRequest(mrNumber: number): MergeRequest {
    const pr = fetchPRDetails(mrNumber, this.repoInfo);
    return mapPRDetailsToMergeRequest(pr);
  }

  /** Posts a comment on the specified PR. */
  commentOnMergeRequest(mrNumber: number, body: string): void {
    commentOnPR(mrNumber, body, this.repoInfo);
  }

  /** Fetches review comments and maps to ReviewComment[]. */
  fetchReviewComments(mrNumber: number): ReviewComment[] {
    const comments = fetchPRReviewComments(mrNumber, this.repoInfo);
    return comments.map(mapPRReviewCommentToReviewComment);
  }

  /** Lists open PRs and maps to MergeRequest[]. */
  listOpenMergeRequests(): MergeRequest[] {
    const items = fetchPRList(this.repoInfo);
    return items.map(mapPRListItemToMergeRequest);
  }

  /**
   * Creates a pull request by adapting CreateMROptions to the existing
   * createPullRequest signature. Constructs a minimal GitHubIssue from
   * the options, with plan/build summaries baked into the body.
   */
  createMergeRequest(options: CreateMROptions): string {
    const minimalIssue: GitHubIssue = {
      number: options.linkedIssueNumber ?? 0,
      title: options.title,
      body: options.body,
      state: 'OPEN',
      author: { login: '', isBot: false },
      assignees: [],
      labels: [],
      comments: [],
      createdAt: '',
      updatedAt: '',
      url: '',
    };

    return createPullRequest(
      minimalIssue,
      '',
      '',
      options.targetBranch,
      process.cwd(),
      this.repoInfo,
    );
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
