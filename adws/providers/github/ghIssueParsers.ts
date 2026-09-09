/**
 * Pure parsers for the `gh issue …` JSON the tracker receives from `GhIssueApi`
 * — the canonical home of parsing that `adws/github/issueApi.ts`/`issueListApi.ts`
 * still carry a copy of until #821 deletes them. The error policy (swallow /
 * wrap / rethrow) lives in the port methods, not here — every function below
 * is pure and throws on malformed JSON.
 */

import type { GitHubIssue, IssueCommentSummary } from './domain/issue';
import type { IssueListEntry, IssueSummary } from '../types';

interface RawGitHubUser {
  login?: string;
  name?: string | null;
  is_bot?: boolean;
}

interface RawGitHubLabel {
  id?: string;
  name: string;
  color?: string;
  description?: string | null;
}

interface RawGitHubMilestone {
  id?: string;
  number: number;
  title: string;
  description?: string | null;
  state: string;
}

interface RawGitHubComment {
  id?: string;
  author?: RawGitHubUser;
  body: string;
  createdAt: string;
  updatedAt?: string | null;
}

interface RawGitHubIssue {
  number: number;
  title: string;
  body?: string;
  state: string;
  author?: RawGitHubUser;
  assignees?: RawGitHubUser[];
  labels?: RawGitHubLabel[];
  milestone?: RawGitHubMilestone | null;
  comments?: RawGitHubComment[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string | null;
  url: string;
}

function transformIssueResponse(rawIssue: RawGitHubIssue): GitHubIssue {
  return {
    number: rawIssue.number,
    title: rawIssue.title,
    body: rawIssue.body || '',
    state: rawIssue.state,
    author: {
      login: rawIssue.author?.login || 'unknown',
      name: rawIssue.author?.name || null,
      isBot: rawIssue.author?.is_bot || false,
    },
    assignees: (rawIssue.assignees || []).map((a) => ({
      login: a.login || 'unknown',
      name: a.name || null,
      isBot: a.is_bot || false,
    })),
    labels: (rawIssue.labels || []).map((l) => ({
      id: l.id || '',
      name: l.name,
      color: l.color || '',
      description: l.description || null,
    })),
    milestone: rawIssue.milestone
      ? {
          id: rawIssue.milestone.id || '',
          number: rawIssue.milestone.number,
          title: rawIssue.milestone.title,
          description: rawIssue.milestone.description || null,
          state: rawIssue.milestone.state,
        }
      : null,
    comments: (rawIssue.comments || []).map((c) => ({
      id: c.id || '',
      author: {
        login: c.author?.login || 'unknown',
        name: c.author?.name || null,
        isBot: c.author?.is_bot || false,
      },
      body: c.body,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt || null,
    })),
    createdAt: rawIssue.createdAt,
    updatedAt: rawIssue.updatedAt,
    closedAt: rawIssue.closedAt || null,
    url: rawIssue.url,
  };
}

/** Parses `gh issue view --json <ISSUE_FIELDS>` output, applying every default `transformIssueResponse` applied. */
export function parseGitHubIssue(json: string): GitHubIssue {
  return transformIssueResponse(JSON.parse(json) as RawGitHubIssue);
}

/** Parses `gh issue view --json state` output. */
export function parseIssueState(json: string): string {
  return (JSON.parse(json) as { state: string }).state;
}

/** Parses `gh api .../issues/:number/comments` (REST) output — `user.login`/`created_at`, not the GraphQL shape. */
export function parseIssueCommentsRest(json: string): IssueCommentSummary[] {
  const raw = JSON.parse(json) as Record<string, unknown>[];
  return raw.map((c) => ({
    id: c.id as number,
    body: (c.body as string) || '',
    authorLogin: ((c.user as Record<string, unknown> | undefined)?.login as string) || 'unknown',
    createdAt: c.created_at as string,
  }));
}

/** Parses `gh issue view --json labels` output. */
export function parseIssueLabelNames(json: string): string[] {
  const result = JSON.parse(json) as { labels?: { name: string }[] };
  return (result.labels || []).map((l) => l.name);
}

/** Parses the issue number out of `gh issue create`'s output URL. Throws verbatim on a non-matching output. */
export function parseCreatedIssueNumber(output: string): number {
  const trimmed = output.trim();
  const match = trimmed.match(/\/issues\/(\d+)$/);
  if (!match) {
    throw new Error(`createIssue: could not parse issue number from gh output: "${trimmed}"`);
  }
  return parseInt(match[1], 10);
}

/** Parses `gh issue list --label 'adw:upgrade' --limit 1` output. */
export function parseFirstIssueNumber(json: string): number | null {
  const results = JSON.parse(json) as { number: number }[];
  return results.length > 0 ? results[0].number : null;
}

/** Parses a `number,title`-projected `gh issue list` output. */
export function parseIssueSummaries(json: string): IssueSummary[] {
  return JSON.parse(json) as IssueSummary[];
}

/** Parses an arbitrarily-projected `gh issue list` output. */
export function parseIssueListEntries(json: string): IssueListEntry[] {
  return JSON.parse(json) as IssueListEntry[];
}
