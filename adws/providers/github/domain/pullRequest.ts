/**
 * Adapter-owned raw GitHub payload shapes for pull requests (#817, PRD story 7).
 * Pure type declarations — no runtime code — so this module sits inside
 * EXTRACTION_SCOPE. `PRReviewComment`/`PRDetails`/`PRListItem` moved verbatim
 * from `adws/types/workflowTypes.ts`; `RawPR` moved verbatim from
 * `adws/github/prApi.ts`.
 */

import type { GitHubUser } from './issue';

/**
 * PR review comment from GitHub API.
 */
export interface PRReviewComment {
  id: number;
  author: GitHubUser;
  body: string;
  path: string;
  line: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * PR details from GitHub API.
 */
export interface PRDetails {
  number: number;
  title: string;
  body: string;
  state: string;
  headBranch: string;
  baseBranch: string;
  url: string;
  /** Extracted from PR body (e.g., "Implements #12") */
  issueNumber: number | null;
  reviewComments: PRReviewComment[];
}

/**
 * PR list item for CRON trigger polling.
 */
export interface PRListItem {
  number: number;
  headBranch: string;
  updatedAt: string;
}

/** Shape of a PR entry returned by `gh pr list --json ...` */
export interface RawPR {
  readonly number: number;
  readonly state: string;
  readonly headRefName: string;
  readonly baseRefName: string;
  /** Present when the lookup requested labels; absent for callers that don't. */
  readonly labels?: readonly { readonly name: string }[];
}
