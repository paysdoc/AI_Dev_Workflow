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
 * Platform-agnostic comment on a work item (issue/ticket).
 */
export interface WorkItemComment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
}

/**
 * Platform-agnostic issue/ticket representation.
 */
export interface WorkItem {
  id: string;
  number: number;
  title: string;
  body: string;
  state: string;
  author: string;
  labels: string[];
  comments: WorkItemComment[];
}

/**
 * Interface for issue tracking operations across platforms.
 * Maps 1:1 to existing GitHub issue operations for seamless migration.
 */
export interface IssueTracker {
  fetchIssue(issueNumber: number): Promise<WorkItem>;
  commentOnIssue(issueNumber: number, body: string): void;
  deleteComment(commentId: string): void;
  closeIssue(issueNumber: number, comment?: string): Promise<boolean>;
  getIssueState(issueNumber: number): string;
  fetchComments(issueNumber: number): WorkItemComment[];
  moveToStatus(issueNumber: number, status: string): Promise<boolean>;
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
 * Platform-agnostic merge/pull request representation.
 */
export interface MergeRequest {
  number: number;
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  url: string;
  linkedIssueNumber?: number;
}

/**
 * Options for creating a merge/pull request.
 */
export interface CreateMROptions {
  title: string;
  body: string;
  sourceBranch: string;
  targetBranch: string;
  linkedIssueNumber?: number;
}

/**
 * Interface for code hosting operations across platforms.
 * Maps 1:1 to existing GitHub code hosting operations for seamless migration.
 */
export interface CodeHost {
  getDefaultBranch(): string;
  createMergeRequest(options: CreateMROptions): string;
  fetchMergeRequest(mrNumber: number): MergeRequest;
  commentOnMergeRequest(mrNumber: number, body: string): void;
  fetchReviewComments(mrNumber: number): ReviewComment[];
  listOpenMergeRequests(): MergeRequest[];
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
