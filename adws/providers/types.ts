/**
 * Provider interfaces and types for platform-agnostic issue tracking and code hosting.
 *
 * These interfaces abstract away platform-specific operations, enabling ADW to work
 * with different issue trackers (GitHub Issues, Jira, Linear) and code hosting
 * platforms (GitHub, GitLab, Bitbucket).
 */

/**
 * Supported code hosting and issue tracking platforms.
 */
export enum Platform {
  GitHub = 'github',
  GitLab = 'gitlab',
  Bitbucket = 'bitbucket',
}

/**
 * Platform-agnostic repository identifier.
 */
export interface RepoIdentifier {
  owner: string;
  repo: string;
  platform: Platform;
}

/**
 * Validates that a RepoIdentifier is well-formed.
 * Throws an error if the identifier has empty or whitespace-only owner/repo fields.
 */
export function validateRepoIdentifier(id: RepoIdentifier): void {
  if (!id.owner.trim()) {
    throw new Error('RepoIdentifier owner must not be empty');
  }
  if (!id.repo.trim()) {
    throw new Error('RepoIdentifier repo must not be empty');
  }
}

/**
 * Platform-agnostic comment on an issue/ticket.
 */
export interface IssueComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

/**
 * Platform-agnostic issue/ticket representation.
 */
export interface Issue {
  id: string;
  number: number;
  title: string;
  body: string;
  state: string;
  author: string;
  labels: string[];
  comments: IssueComment[];
}

/**
 * Named constants for project board status values.
 * Use these instead of raw strings when calling moveToStatus.
 */
export enum BoardStatus {
  InProgress = 'In Progress',
  Review = 'Review',
}

/**
 * Interface for issue tracking operations across platforms.
 * Maps 1:1 to existing GitHub issue operations for seamless migration.
 */
export interface IssueTracker {
  fetchIssue(issueNumber: number): Promise<Issue>;
  commentOnIssue(issueNumber: number, body: string): void;
  deleteComment(commentId: string): void;
  closeIssue(issueNumber: number, comment?: string): Promise<boolean>;
  getIssueState(issueNumber: number): string;
  fetchComments(issueNumber: number): IssueComment[];
  issueHasLabel(issueNumber: number, labelName: string): boolean;
  moveToStatus(issueNumber: number, status: BoardStatus): Promise<boolean>;
}

/**
 * Platform-agnostic review comment on a merge/pull request.
 */
export interface ReviewComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  path?: string;
  line?: number;
}

/**
 * Platform-agnostic pull request representation.
 */
export interface PullRequest {
  number: number;
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  url: string;
  linkedIssueNumber?: number;
}

/**
 * Options for creating a pull request.
 */
export interface CreatePROptions {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  linkedIssueNumber?: number;
}

/**
 * Result returned by a successful pull request creation.
 */
export interface PullRequestResult {
  url: string;
  number: number;
}

/**
 * Result returned by a PR approval operation.
 */
export interface ApproveResult {
  success: boolean;
  error?: string;
}

/**
 * Extended pull request representation including runtime state.
 * Used when full PR details (including open/closed/merged state) are needed.
 */
export interface PullRequestDetails extends PullRequest {
  state: string;
}

/**
 * Interface for code hosting operations across platforms.
 * Maps 1:1 to existing GitHub code hosting operations for seamless migration.
 */
export interface CodeHost {
  getDefaultBranch(): string;
  createPullRequest(options: CreatePROptions): PullRequestResult;
  fetchPullRequest(prNumber: number): PullRequest;
  approvePR(prNumber: number): ApproveResult;
  fetchPRDetails(prNumber: number): PullRequestDetails;
  commentOnPullRequest(prNumber: number, body: string): void;
  fetchReviewComments(prNumber: number): ReviewComment[];
  listOpenPullRequests(): PullRequest[];
  getRepoIdentifier(): RepoIdentifier;
}

/**
 * Immutable context object containing the provider instances and workspace info.
 * Passed through workflow phases to decouple them from specific platform implementations.
 */
export type RepoContext = Readonly<{
  issueTracker: IssueTracker;
  codeHost: CodeHost;
  cwd: string;
  repoId: RepoIdentifier;
}>;
