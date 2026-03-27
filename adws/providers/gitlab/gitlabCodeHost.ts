/**
 * GitLab implementation of the CodeHost interface.
 * Delegates to GitLabApiClient for synchronous API calls via curl.
 */

import {
  type CodeHost,
  type CreatePROptions,
  type PullRequest,
  type PullRequestResult,
  type RepoIdentifier,
  type ReviewComment,
  validateRepoIdentifier,
} from '../types';
import { GITLAB_TOKEN, GITLAB_INSTANCE_URL } from '../../core';
import { GitLabApiClient } from './gitlabApiClient';
import {
  mapGitLabMRToPullRequest,
  mapGitLabDiscussionsToReviewComments,
  toProjectPath,
} from './mappers';

/**
 * GitLab-specific implementation of the CodeHost interface.
 * Bound to a specific repository at construction time.
 */
export class GitLabCodeHost implements CodeHost {
  private readonly repoId: RepoIdentifier;
  private readonly client: GitLabApiClient;
  private readonly projectPath: string;

  constructor(repoId: RepoIdentifier, client: GitLabApiClient) {
    this.repoId = repoId;
    this.client = client;
    this.projectPath = toProjectPath(repoId);
  }

  /** Returns the bound RepoIdentifier. */
  getRepoIdentifier(): RepoIdentifier {
    return this.repoId;
  }

  /** Fetches the default branch from the GitLab project. */
  getDefaultBranch(): string {
    const project = this.client.getProject(this.projectPath);
    return project.default_branch;
  }

  /** Fetches MR details and maps to PullRequest. */
  fetchPullRequest(prNumber: number): PullRequest {
    const mr = this.client.getMergeRequest(this.projectPath, prNumber);
    return mapGitLabMRToPullRequest(mr);
  }

  /** Posts a comment (note) on the specified MR. */
  commentOnPullRequest(prNumber: number, body: string): void {
    this.client.createNote(this.projectPath, prNumber, body);
  }

  /** Fetches review comments from MR discussions. */
  fetchReviewComments(prNumber: number): ReviewComment[] {
    const discussions = this.client.listDiscussions(this.projectPath, prNumber);
    return mapGitLabDiscussionsToReviewComments(discussions);
  }

  /** Lists open MRs and maps to PullRequest[]. */
  listOpenPullRequests(): PullRequest[] {
    const mrs = this.client.listMergeRequests(this.projectPath, 'opened');
    return [...mrs].map(mapGitLabMRToPullRequest);
  }

  /** Creates a pull request (MR) and returns its URL and number. */
  createPullRequest(options: CreatePROptions): PullRequestResult {
    const mr = this.client.createMergeRequest(this.projectPath, {
      source_branch: options.sourceBranch,
      target_branch: options.targetBranch,
      title: options.title,
      description: options.body,
    });
    return { url: mr.web_url, number: mr.iid };
  }
}

/**
 * Factory function that creates a GitLabCodeHost bound to the given repository.
 * Validates the RepoIdentifier and requires GITLAB_TOKEN to be set.
 */
export function createGitLabCodeHost(
  repoId: RepoIdentifier,
  instanceUrl?: string,
): CodeHost {
  validateRepoIdentifier(repoId);

  if (!GITLAB_TOKEN) {
    throw new Error(
      'GITLAB_TOKEN environment variable is required for GitLab code host. Set it in your .env file.',
    );
  }

  const url = instanceUrl ?? GITLAB_INSTANCE_URL;
  const client = new GitLabApiClient(url, GITLAB_TOKEN);
  return new GitLabCodeHost(repoId, client);
}
