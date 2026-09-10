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
  { order: 3, status: BoardStatus.InProgress, color: 'GREEN', description: 'This is actively being worked on' },
  { order: 4, status: BoardStatus.Review, color: 'YELLOW', description: 'This item is being peer reviewed' },
  { order: 5, status: BoardStatus.Done, color: 'PURPLE', description: 'This has been completed' },
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

/** Minimal open-issue projection returned by tracker lookups. */
export interface IssueSummary {
  number: number;
  title: string;
}

/** A forge-neutral projection field for {@link IssueListQuery}. */
export type IssueListField = 'number' | 'title' | 'body' | 'state' | 'labels' | 'comments' | 'createdAt' | 'updatedAt';

/** A listing request: which fields to project, and an optional search/state/limit narrowing. */
export interface IssueListQuery {
  readonly fields: readonly IssueListField[];
  readonly limit?: number;
  readonly search?: string;
  readonly state?: 'open' | 'closed' | 'all';
}

/** One listed issue, projected to the fields the caller asked for — the rest are absent, not empty. */
export interface IssueListEntry {
  number: number;
  title?: string;
  body?: string;
  state?: string;
  labels?: readonly { name: string }[];
  comments?: readonly { body: string }[];
  createdAt?: string;
  updatedAt?: string;
}

/** A merged pull request's body (for client-side `Closes owner/repo#N` matching) and merge timestamp. */
export interface MergedPullRequestRecord {
  body: string;
  mergedAt: string | null;
}

/** Every PR of the repository — open, closed or merged — projected to what issue-link detection needs. `state` is the forge-native vocabulary `PullRequestSummary.state` already carries. */
export interface PullRequestRecord {
  number: number;
  body: string;
  state: string;
  mergedAt: string | null;
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
  /** Returns the issue's label names; empty on any error (fail-open). */
  fetchLabels(issueNumber: number): readonly string[];
  /** Adds a label to an issue; logs and swallows any error (fail-open). */
  addLabel(issueNumber: number, labelName: string): void;
  /** Adds a label, lazy-creating it first if missing; rethrows any other error. */
  applyLabel(issueNumber: number, labelName: string): void;
  /** Idempotently creates/updates a label definition on the repo. */
  ensureLabel(name: string, color: string, description: string): void;
  /** Creates a new issue and returns its number. */
  createIssue(title: string, body: string): number;
  /** Replaces the body of an existing issue. */
  updateIssueBody(issueNumber: number, body: string): void;
  /** Open issues matching a forge search string; empty on any error (best-effort). */
  searchOpenIssues(search: string, limit: number): readonly IssueSummary[];
  /** Returns the number of the first open `adw:upgrade` issue, or null. */
  findOpenUpgradeIssue(): number | null;
  /** Issues matching `query` (open unless `state` says otherwise). Throws on failure — callers own the swallow policy. */
  listIssues(query: IssueListQuery): readonly IssueListEntry[];
  /** Returns the issue's title for log lines; `'(unknown)'` on any error (fail-open). */
  getIssueTitle(issueNumber: number): string;
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
  /** True when the forge marks the author as a bot account; absent when the forge does not say. */
  isBot?: boolean;
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
  /** Forge-native state vocabulary (`'OPEN' | 'MERGED' | 'CLOSED'` on GitHub), the same vocabulary `PullRequestSummary.state` already carries. */
  state: string;
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

/** Branch-level PR projection: what merge/idempotency decisions need, nothing more. */
export interface PullRequestSummary {
  number: number;
  state: string;
  sourceBranch: string;
  targetBranch: string;
  labels: readonly string[];
}

/** Outcome of a forge mutation that is reported, not thrown. */
export interface ForgeActionResult {
  success: boolean;
  error?: string;
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
  /** Finds the PR for a branch (open, or most-recently-updated when none are open); null if none. */
  findPullRequestByBranch(branchName: string): PullRequestSummary | null;
  /** True when the PR has at least one qualifying approval. */
  isPullRequestApproved(prNumber: number): boolean;
  /** Approves a PR under the bound identity. */
  approvePullRequest(prNumber: number): ForgeActionResult;
  /** Merges a PR. */
  mergePullRequest(prNumber: number): ForgeActionResult;
  /** Sets a repo secret (e.g. GitHub Actions). */
  setSecret(name: string, value: string): void;
  /** Merged PRs, newest first, at most `limit`. Throws on failure. */
  listMergedPullRequests(limit: number): readonly MergedPullRequestRecord[];
  /** Every PR of the repository (open, closed and merged), newest first, at most the forge's page cap. Throws on failure — callers own the swallow policy. */
  listPullRequests(): readonly PullRequestRecord[];
  /** Login the code host's commands run as; `null` when it cannot be determined (best-effort, warns once per instance). */
  getAuthenticatedUser(): string | null;
  /**
   * True when this code host holds a reviewer identity distinct from the one
   * that authors pull requests, so an approval it submits is not a
   * self-approval. An adapter that cannot express approval at all refuses by
   * name, like every other stub; callers treat a refusal exactly as they
   * treat `false`.
   */
  canApprovePullRequests(): boolean;
}

/**
 * The provider triple — issue tracker, code host, and (optional) board manager —
 * bound to one `RepoIdentifier` at construction. Minted by `mintBoundProviders`
 * (`repoContext.ts`), either directly at a launch boundary or as part of
 * `createRepoContext`'s workspace-validated construction.
 */
export type BoundProviders = Readonly<{
  issueTracker: IssueTracker;
  codeHost: CodeHost;
  boardManager?: BoardManager;
}>;

/**
 * Immutable context object containing the provider instances and workspace info.
 * Passed through workflow phases to decouple them from specific platform implementations.
 */
export type RepoContext = BoundProviders & Readonly<{
  cwd: string;
  repoId: RepoIdentifier;
}>;
