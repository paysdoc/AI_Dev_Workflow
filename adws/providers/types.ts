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
  Blocked = 'Blocked',
  Todo = 'Todo',
  InProgress = 'In Progress',
  Review = 'Review',
  Done = 'Done',
}

/**
 * Defines a single column (status option) on the project board.
 */
export interface BoardColumnDefinition {
  readonly order: number;
  readonly status: BoardStatus;
  readonly color: string;
  readonly description: string;
}

/**
 * The canonical set of ADW board columns, in display order.
 * Colors and descriptions can only be set at column-creation time (GitHub API limitation).
 */
export const BOARD_COLUMNS: readonly BoardColumnDefinition[] = [
  { order: 1, status: BoardStatus.Blocked, color: 'RED', description: 'This item cannot be completed' },
  { order: 2, status: BoardStatus.Todo, color: 'GRAY', description: "This item hasn't been started" },
  { order: 3, status: BoardStatus.InProgress, color: 'YELLOW', description: 'This is actively being worked on' },
  { order: 4, status: BoardStatus.Review, color: 'PURPLE', description: 'This item is being peer reviewed' },
  { order: 5, status: BoardStatus.Done, color: 'GREEN', description: 'This has been completed' },
] as const;

/**
 * Interface for managing project boards across platforms.
 * Provides board discovery, creation, and column configuration.
 */
export interface BoardManager {
  findBoard(): Promise<string | null>;
  createBoard(name: string): Promise<string>;
  ensureColumns(boardId: string): Promise<boolean>;
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
 * Interface for code hosting operations across platforms.
 * Maps 1:1 to existing GitHub code hosting operations for seamless migration.
 */
export interface CodeHost {
  getDefaultBranch(): string;
  createPullRequest(options: CreatePROptions): PullRequestResult;
  fetchPullRequest(prNumber: number): PullRequest;
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
  boardManager?: BoardManager;
  cwd: string;
  repoId: RepoIdentifier;
}>;
