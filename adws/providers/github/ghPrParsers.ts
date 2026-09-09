/**
 * Pure parsers for the `gh pr …` / `gh api` JSON the code host receives from
 * `GhPrApi` — the canonical home of parsing that `adws/github/prApi.ts` still
 * carries a copy of until #821 deletes it. The error policy (swallow / wrap /
 * rethrow) lives in the port methods, not here — every function below is
 * pure and throws on malformed JSON; there is no logging and no I/O.
 */

import type { PRDetails, PRReviewComment, PRListItem, RawPR } from './domain/pullRequest';

interface RawPRDetails {
  number: number;
  title: string;
  body?: string;
  state: string;
  headRefName: string;
  baseRefName: string;
  url: string;
}

interface RawPRReview {
  id: number;
  state: string;
  body?: string;
  submitted_at: string;
  user?: {
    login?: string;
    type?: string;
  };
}

interface RawPRLineComment {
  id: number;
  body: string;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  created_at: string;
  updated_at: string;
  user?: {
    login?: string;
    type?: string;
  };
}

interface RawPRListItem {
  number: number;
  headRefName: string;
  updatedAt: string;
}

/** Extends `RawPR` with `updatedAt` for PR-selection logic. */
export interface RawPRListEntry extends RawPR {
  readonly updatedAt: string;
}

/**
 * Issue number embedded in an ADW branch name (`{prefix}/issue-{number}-{slug}`).
 * Copied from `adws/triggers/webhookHandlers.ts`'s `extractIssueNumberFromBranch`
 * because the adapter cannot import `adws/triggers`.
 */
export function issueNumberFromBranch(branchName: string | null | undefined): number | null {
  if (!branchName) return null;
  const match = branchName.match(/issue-(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/** Parses `gh pr view --json number,title,body,state,headRefName,baseRefName,url`. */
export function parsePRDetails(json: string): PRDetails {
  const raw = JSON.parse(json) as RawPRDetails;

  const issueMatch = raw.body?.match(/Implements #(\d+)/);
  const issueNumber = issueMatch ? parseInt(issueMatch[1], 10) : issueNumberFromBranch(raw.headRefName);

  return {
    number: raw.number,
    title: raw.title,
    body: raw.body || '',
    state: raw.state,
    headBranch: raw.headRefName,
    baseBranch: raw.baseRefName,
    url: raw.url,
    issueNumber,
    reviewComments: [],
  };
}

/** Parses `gh api .../pulls/:number/reviews` (REST) — filters PENDING and substitutes a placeholder for an empty-bodied review. */
export function parsePRReviews(json: string): PRReviewComment[] {
  const raw = JSON.parse(json) as RawPRReview[];

  return raw
    .filter((r) => r.state !== 'PENDING' && ((r.body && r.body.trim() !== '') || r.state === 'CHANGES_REQUESTED'))
    .map((r) => ({
      id: r.id,
      author: {
        login: r.user?.login || 'unknown',
        name: null,
        isBot: r.user?.type === 'Bot',
      },
      body: (r.body && r.body.trim() !== '') ? r.body : `[Review submitted: ${r.state}]`,
      path: '',
      line: null,
      createdAt: r.submitted_at,
      updatedAt: r.submitted_at,
    }));
}

/** Parses `gh api .../pulls/:number/comments` (REST, line-level comments). */
export function parsePRLineComments(json: string): PRReviewComment[] {
  const raw = JSON.parse(json) as RawPRLineComment[];

  return raw.map((c) => ({
    id: c.id,
    author: {
      login: c.user?.login || 'unknown',
      name: null,
      isBot: c.user?.type === 'Bot',
    },
    body: c.body,
    path: c.path || '',
    line: c.line || c.original_line || null,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));
}

/** Parses `gh pr list --json number,headRefName,updatedAt`. */
export function parsePRListItems(json: string): PRListItem[] {
  const raw = JSON.parse(json) as RawPRListItem[];
  return raw.map((pr) => ({
    number: pr.number,
    headBranch: pr.headRefName,
    updatedAt: pr.updatedAt,
  }));
}

/**
 * Picks the PR ADW should act on for a branch. Prefers the most-recently
 * updated OPEN PR (fixes #508: a stale closed/merged PR must never win over
 * a live open one). Falls back to the most-recently-updated PR overall when
 * none are open.
 */
export function selectPreferredPR(prs: readonly RawPRListEntry[]): RawPRListEntry | null {
  if (prs.length === 0) return null;
  const open = prs.filter((p) => p.state === 'OPEN');
  const pool = open.length > 0 ? open : prs;
  return [...pool].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )[0];
}

/** The GraphQL-shaped (`gh pr view --json reviewDecision,reviews`) review entry: `author`/`submittedAt`, not the REST `user`/`submitted_at`. */
interface PRReview {
  readonly author: { readonly login: string } | null;
  readonly state: string;
  readonly submittedAt: string;
}

/**
 * Per-reviewer-latest approval aggregation fallback, used when `reviewDecision`
 * is null or empty (no branch protection / no required reviewers). Takes only
 * APPROVED/CHANGES_REQUESTED reviews, picks the latest per reviewer, and
 * returns true iff every reviewer's latest substantive review is APPROVED
 * and there is at least one such reviewer.
 */
export function isApprovedFromReviewsList(reviews: readonly PRReview[]): boolean {
  const substantive = reviews.filter((r) => r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED');
  if (substantive.length === 0) return false;

  const latestByAuthor = new Map<string, PRReview>();
  for (const review of substantive) {
    if (!review.author) continue;
    const login = review.author.login;
    const existing = latestByAuthor.get(login);
    if (!existing || review.submittedAt > existing.submittedAt) {
      latestByAuthor.set(login, review);
    }
  }

  for (const review of latestByAuthor.values()) {
    if (review.state !== 'APPROVED') return false;
  }
  return latestByAuthor.size > 0;
}

/**
 * Parses `gh pr view --json reviewDecision,reviews`. `reviewDecision ===
 * 'APPROVED'` wins outright; any other non-empty value is a refusal;
 * null/undefined/"" falls back to {@link isApprovedFromReviewsList}.
 */
export function parsePRApprovalState(json: string): boolean {
  const result = JSON.parse(json) as { reviewDecision: string | null; reviews: PRReview[] };
  const { reviewDecision, reviews } = result;

  if (reviewDecision === 'APPROVED') return true;
  if (reviewDecision) return false;

  return isApprovedFromReviewsList(reviews || []);
}
