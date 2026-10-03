/**
 * What a row's Givens seeded into the mock server's state, read back as the port types the phases
 * work with. G4 seeds the issue; G-S2 seeds the pull request and its review comment.
 */

import assert from 'assert';
import type { Issue, PullRequest, ReviewComment } from '@paysdoc/devplatform';

import { getMockServerState } from '../../../test/mocks/github-api-server.ts';
import { SURFACE_REPO } from './mockForgeProviders.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function labelName(label: unknown): string {
  if (typeof label === 'string') return label;
  return isRecord(label) && typeof label['name'] === 'string' ? label['name'] : '';
}

function toPortIssue(key: string, raw: unknown): Issue {
  const record = isRecord(raw) ? raw : {};
  const user = isRecord(record['user']) ? record['user'] : {};
  const number = Number(record['number'] ?? key);
  return {
    id: String(record['id'] ?? number),
    number,
    title: String(record['title'] ?? ''),
    body: String(record['body'] ?? ''),
    state: String(record['state'] ?? 'open'),
    author: String(user['login'] ?? ''),
    labels: (Array.isArray(record['labels']) ? record['labels'] : []).map(labelName).filter(Boolean),
    comments: [],
    createdAt: typeof record['created_at'] === 'string' ? record['created_at'] : new Date(0).toISOString(),
    url: `https://github.com/${SURFACE_REPO.owner}/${SURFACE_REPO.repo}/issues/${number}`,
  };
}

/** G4 replaces the whole issue map, so after it the server holds exactly the issue the row seeded. */
export function seededIssue(): Issue {
  const entries = Object.entries(getMockServerState().issues);
  assert.strictEqual(
    entries.length,
    1,
    `Expected the mock issue tracker to hold exactly the issue G4 seeded, but it holds: ${entries.map(([key]) => key).join(', ') || 'none'}`,
  );
  const [key, raw] = entries[0];
  return toPortIssue(key, raw);
}

function toPortPullRequest(key: string, raw: unknown): PullRequest {
  const record = isRecord(raw) ? raw : {};
  const body = String(record['body'] ?? '');
  const linkedIssue = /Implements #(\d+)/.exec(body)?.[1];
  return {
    number: Number(record['number'] ?? key),
    title: String(record['title'] ?? ''),
    body,
    state: String(record['state'] ?? 'OPEN'),
    sourceBranch: String(record['headRefName'] ?? ''),
    targetBranch: String(record['baseRefName'] ?? ''),
    url: String(record['url'] ?? ''),
    ...(linkedIssue === undefined ? {} : { linkedIssueNumber: Number(linkedIssue) }),
  };
}

/** G-S2 replaces the whole pull-request map, so after it the server holds exactly the pull request the row opened. */
export function seededPullRequest(): PullRequest {
  const entries = Object.entries(getMockServerState().prs);
  assert.strictEqual(
    entries.length,
    1,
    `Expected the mock server to hold exactly the pull request G-S2 seeded, but it holds: ${entries.map(([key]) => key).join(', ') || 'none'}`,
  );
  const [key, raw] = entries[0];
  return toPortPullRequest(key, raw);
}

function toReviewComment(raw: unknown): ReviewComment {
  const record = isRecord(raw) ? raw : {};
  const user = isRecord(record['user']) ? record['user'] : {};
  return {
    id: String(record['id'] ?? ''),
    body: String(record['body'] ?? ''),
    author: String(user['login'] ?? ''),
    createdAt: typeof record['created_at'] === 'string' ? record['created_at'] : new Date(0).toISOString(),
  };
}

export function seededReviewComments(prNumber: number): ReviewComment[] {
  return (getMockServerState().comments[String(prNumber)] ?? []).map(toReviewComment);
}
