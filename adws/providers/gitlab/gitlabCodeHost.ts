/**
 * GitLab implementation of the CodeHost interface.
 * Delegates to GitLabApiClient for synchronous API calls via curl.
 *
 * The factory takes INJECTED configuration (#818) — never reads the environment.
 */

import {
  type CodeHost,
  type CreatePROptions,
  type ForgeActionResult,
  type MergedPullRequestRecord,
  type PullRequest,
  type PullRequestResult,
  type PullRequestSummary,
  type RepoIdentifier,
  type ReviewComment,
  validateRepoIdentifier,
} from '../types';
import { GitLabApiClient, type GitLabConfig, type GitLabApiClientDeps } from './gitlabApiClient';
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

  findPullRequestByBranch(): PullRequestSummary | null {
    throw new Error('GitLabCodeHost.findPullRequestByBranch is not implemented');
  }

  isPullRequestApproved(): boolean {
    throw new Error('GitLabCodeHost.isPullRequestApproved is not implemented');
  }

  approvePullRequest(): ForgeActionResult {
    throw new Error('GitLabCodeHost.approvePullRequest is not implemented');
  }

  mergePullRequest(): ForgeActionResult {
    throw new Error('GitLabCodeHost.mergePullRequest is not implemented');
  }

  setSecret(): void {
    throw new Error('GitLabCodeHost.setSecret is not implemented');
  }

  listMergedPullRequests(): readonly MergedPullRequestRecord[] {
    throw new Error('GitLabCodeHost.listMergedPullRequests is not implemented');
  }
}

/** Throws a library-facing message when `config` is missing a required field. The env-flavoured operator message lives in ADW's wiring (`repoContext.ts`), not here. */
function validateGitLabConfig(config: GitLabConfig): void {
  if (!config.token?.trim()) {
    throw new Error('GitLab code host requires a non-empty token');
  }
  if (!config.instanceUrl?.trim()) {
    throw new Error('GitLab code host requires a non-empty instanceUrl');
  }
}

/**
 * Creates a GitLabCodeHost bound to `repoId` from INJECTED configuration (#818).
 * Reads no environment; ADW's wiring (`repoContext.ts`) supplies `config`
 * from GITLAB_TOKEN / GITLAB_INSTANCE_URL and its own logger. `deps.logger`
 * defaults to `consoleLogger`, `deps.runCurl` to a real curl.
 */
export function createGitLabCodeHost(repoId: RepoIdentifier, config: GitLabConfig, deps: GitLabApiClientDeps = {}): CodeHost {
  validateRepoIdentifier(repoId);
  validateGitLabConfig(config);
  return new GitLabCodeHost(repoId, new GitLabApiClient(config, deps));
}
