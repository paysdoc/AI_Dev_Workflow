/**
 * Adapter-owned raw GitHub payload shapes for issues (#817, PRD story 7).
 * Pure type declarations — no runtime code, no imports — so this module sits
 * inside EXTRACTION_SCOPE. Moved verbatim from `adws/types/issueTypes.ts`.
 */

/**
 * GitHub user model.
 */
export interface GitHubUser {
  /** Not always returned by GitHub API */
  id?: string | null;
  login: string;
  name?: string | null;
  isBot: boolean;
}

/**
 * GitHub label model.
 */
export interface GitHubLabel {
  id: string;
  name: string;
  color: string;
  description?: string | null;
}

/**
 * GitHub milestone model.
 */
export interface GitHubMilestone {
  id: string;
  number: number;
  title: string;
  description?: string | null;
  state: string;
}

/**
 * GitHub comment model.
 */
export interface GitHubComment {
  id: string;
  author: GitHubUser;
  body: string;
  /** ISO 8601 date string */
  createdAt: string;
  /** ISO 8601 date string - Not always returned */
  updatedAt?: string | null;
}

/**
 * GitHub issue model for list responses (simplified).
 */
export interface GitHubIssueListItem {
  number: number;
  title: string;
  body: string;
  labels: GitHubLabel[];
  /** ISO 8601 date string */
  createdAt: string;
  /** ISO 8601 date string */
  updatedAt: string;
}

/**
 * GitHub issue model (full).
 */
export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  author: GitHubUser;
  assignees: GitHubUser[];
  labels: GitHubLabel[];
  milestone?: GitHubMilestone | null;
  comments: GitHubComment[];
  /** ISO 8601 date string */
  createdAt: string;
  /** ISO 8601 date string */
  updatedAt: string;
  /** ISO 8601 date string */
  closedAt?: string | null;
  url: string;
}

/**
 * Minimal issue comment from GitHub REST API (for listing/deleting).
 */
export interface IssueCommentSummary {
  /** Numeric REST API comment ID (required for deletion). */
  id: number;
  /** Comment body text. */
  body: string;
  /** Comment author login. */
  authorLogin: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}
