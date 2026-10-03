/**
 * The forge a `gh` shadow answers from, shaped as `gh ... --json` shapes it, and its normalisation
 * from the mock GitHub API server's state. The server holds issue and PR records in either the REST
 * shape (`user.login`, `created_at`, `head.ref`) or gh's (`author.login`, `createdAt`,
 * `headRefName`), because its fixtures are gh-shaped and the Given steps write REST. Pure: no I/O.
 */

import type { MockServerState } from './types.ts';

export interface GhLabel {
  id: string;
  name: string;
  color: string;
  description: string;
}

export interface GhPerson {
  login: string;
  name: string;
  is_bot: boolean;
}

export interface GhComment {
  id: string;
  author: { login: string };
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface GhReview {
  author: { login: string };
  state: string;
  submittedAt: string;
  body: string;
}

export interface GhIssue {
  number: number;
  title: string;
  body: string;
  state: 'OPEN' | 'CLOSED';
  author: GhPerson;
  assignees: GhPerson[];
  labels: GhLabel[];
  milestone: null;
  comments: GhComment[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  url: string;
}

export interface GhPullRequest {
  number: number;
  title: string;
  body: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  headRefName: string;
  baseRefName: string;
  url: string;
  mergedAt: string | null;
  updatedAt: string;
  labels: GhLabel[];
  /** Empty when no review has decided, as gh reports it. */
  reviewDecision: string;
  reviews: GhReview[];
  comments: GhComment[];
}

export interface ForgeRepository {
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface ForgeState {
  repository: ForgeRepository;
  issues: Record<string, GhIssue>;
  pullRequests: Record<string, GhPullRequest>;
}

type Loose = Record<string, unknown>;

const EPOCH = new Date(0).toISOString();
const DEFAULT_LABEL_COLOR = 'ededed';

function asRecord(value: unknown): Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** The first candidate that is a non-empty string. */
function firstText(...candidates: unknown[]): string {
  return candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0) ?? '';
}

function labelFrom(raw: unknown): GhLabel {
  if (typeof raw === 'string') return { id: '', name: raw, color: DEFAULT_LABEL_COLOR, description: '' };
  const record = asRecord(raw);
  return {
    id: String(record['id'] ?? ''),
    name: text(record['name']),
    color: text(record['color'], DEFAULT_LABEL_COLOR),
    description: text(record['description']),
  };
}

function labelsFrom(raw: unknown): GhLabel[] {
  return (Array.isArray(raw) ? raw : []).map(labelFrom).filter((label) => label.name.length > 0);
}

function personFrom(raw: unknown): GhPerson {
  const record = asRecord(raw);
  return { login: text(record['login'], 'unknown'), name: text(record['name']), is_bot: record['is_bot'] === true || record['type'] === 'Bot' };
}

function commentFrom(raw: unknown): GhComment {
  const record = asRecord(raw);
  const createdAt = firstText(record['createdAt'], record['created_at']) || EPOCH;
  return {
    id: String(record['id'] ?? ''),
    author: { login: personFrom(record['author'] ?? record['user']).login },
    body: text(record['body']),
    createdAt,
    updatedAt: firstText(record['updatedAt'], record['updated_at']) || createdAt,
  };
}

function commentsFrom(inline: unknown, recorded: unknown): GhComment[] {
  return [...(Array.isArray(inline) ? inline : []), ...(Array.isArray(recorded) ? recorded : [])].map(commentFrom);
}

function reviewFrom(raw: unknown): GhReview {
  const record = asRecord(raw);
  return {
    author: { login: personFrom(record['author'] ?? record['user']).login },
    state: text(record['state']),
    submittedAt: firstText(record['submittedAt'], record['submitted_at']) || EPOCH,
    body: text(record['body']),
  };
}

export function issueUrl(repository: ForgeRepository, number: number): string {
  return `https://github.com/${repository.owner}/${repository.repo}/issues/${number}`;
}

export function pullRequestUrl(repository: ForgeRepository, number: number): string {
  return `https://github.com/${repository.owner}/${repository.repo}/pull/${number}`;
}

function issueFrom(key: string, raw: unknown, repository: ForgeRepository, comments: unknown): GhIssue {
  const record = asRecord(raw);
  const number = Number(record['number'] ?? key);
  const createdAt = firstText(record['createdAt'], record['created_at']) || EPOCH;
  const closedAt = firstText(record['closedAt'], record['closed_at']);
  return {
    number,
    title: text(record['title']),
    body: text(record['body']),
    state: text(record['state']).toUpperCase() === 'CLOSED' ? 'CLOSED' : 'OPEN',
    author: personFrom(record['author'] ?? record['user']),
    assignees: (Array.isArray(record['assignees']) ? record['assignees'] : []).map(personFrom),
    labels: labelsFrom(record['labels']),
    milestone: null,
    comments: commentsFrom(record['comments'], comments),
    createdAt,
    updatedAt: firstText(record['updatedAt'], record['updated_at']) || createdAt,
    closedAt: closedAt || null,
    url: firstText(record['url']) || issueUrl(repository, number),
  };
}

function pullRequestStateOf(record: Loose): GhPullRequest['state'] {
  const state = text(record['state']).toUpperCase();
  if (record['merged'] === true || state === 'MERGED') return 'MERGED';
  return state === 'CLOSED' ? 'CLOSED' : 'OPEN';
}

function pullRequestFrom(key: string, raw: unknown, repository: ForgeRepository, comments: unknown): GhPullRequest {
  const record = asRecord(raw);
  const number = Number(record['number'] ?? key);
  const state = pullRequestStateOf(record);
  return {
    number,
    title: text(record['title']),
    body: text(record['body']),
    state,
    headRefName: firstText(record['headRefName'], asRecord(record['head'])['ref']),
    baseRefName: firstText(record['baseRefName'], asRecord(record['base'])['ref']) || repository.defaultBranch,
    url: firstText(record['url']) || pullRequestUrl(repository, number),
    mergedAt: state === 'MERGED' ? firstText(record['mergedAt'], record['merged_at']) || EPOCH : null,
    updatedAt: firstText(record['updatedAt'], record['updated_at'], record['mergedAt'], record['merged_at']) || EPOCH,
    labels: labelsFrom(record['labels']),
    reviewDecision: text(record['reviewDecision']),
    reviews: (Array.isArray(record['reviews']) ? record['reviews'] : []).map(reviewFrom),
    comments: commentsFrom(record['comments'], comments),
  };
}

/** Each record is keyed by its own number, which a REST or gh record may carry under a different key than the server's map. */
function keyedByNumber<T extends { number: number }>(records: readonly T[]): Record<string, T> {
  return Object.fromEntries(records.map((record) => [String(record.number), record]));
}

export function forgeStateFrom(mock: MockServerState, repository: ForgeRepository): ForgeState {
  const issues = Object.entries(mock.issues).map(([key, raw]) => issueFrom(key, raw, repository, mock.comments[key]));
  const pullRequests = Object.entries(mock.prs).map(([key, raw]) => pullRequestFrom(key, raw, repository, mock.comments[key]));
  return { repository, issues: keyedByNumber(issues), pullRequests: keyedByNumber(pullRequests) };
}

/** The record with exactly the requested fields, or undefined when it defines none of one of them, so the caller can refuse the call. */
export function projectFields(record: object, fields: readonly string[]): Record<string, unknown> | undefined {
  const source = record as Record<string, unknown>;
  if (!fields.every((field) => Object.prototype.hasOwnProperty.call(source, field))) return undefined;
  return Object.fromEntries(fields.map((field) => [field, source[field]]));
}
