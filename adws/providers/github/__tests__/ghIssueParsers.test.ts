import { describe, it, expect } from 'vitest';
import {
  parseGitHubIssue,
  parseIssueState,
  parseIssueCommentsRest,
  parseIssueLabelNames,
  parseCreatedIssueNumber,
  parseFirstIssueNumber,
  parseIssueSummaries,
  parseIssueListEntries,
} from '../ghIssueParsers';

describe('parseGitHubIssue', () => {
  it('maps a full payload, flattening author/labels/comments', () => {
    const json = JSON.stringify({
      number: 42,
      title: 'Ship it',
      body: 'the body',
      state: 'OPEN',
      author: { login: 'octocat' },
      assignees: [],
      labels: [{ name: 'hitl' }, { name: 'adw:feature' }],
      milestone: null,
      comments: [{ id: 'c1', author: { login: 'reviewer' }, body: 'looks good', createdAt: '2026-01-03T00:00:00Z' }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      closedAt: null,
      url: 'https://github.com/acme/widget/issues/42',
    });

    const issue = parseGitHubIssue(json);

    expect(issue.number).toBe(42);
    expect(issue.author.login).toBe('octocat');
    expect(issue.labels.map((l) => l.name)).toEqual(['hitl', 'adw:feature']);
    expect(issue.comments[0].author.login).toBe('reviewer');
  });

  it('defaults author to unknown, body to empty string, labels/comments to [], milestone to null when omitted', () => {
    const json = JSON.stringify({
      number: 42,
      title: 'Orphaned',
      state: 'OPEN',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      url: 'https://github.com/acme/widget/issues/42',
    });

    const issue = parseGitHubIssue(json);

    expect(issue.author).toEqual({ login: 'unknown', name: null, isBot: false });
    expect(issue.body).toBe('');
    expect(issue.labels).toEqual([]);
    expect(issue.comments).toEqual([]);
    expect(issue.milestone).toBeNull();
  });

  it('defaults a comment missing updatedAt to null', () => {
    const json = JSON.stringify({
      number: 1,
      title: 'x',
      state: 'OPEN',
      comments: [{ id: 'c1', body: 'hi', createdAt: '2026-01-01T00:00:00Z' }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      url: 'https://github.com/acme/widget/issues/1',
    });

    const issue = parseGitHubIssue(json);

    expect(issue.comments[0].updatedAt).toBeNull();
  });

  it('defaults an empty label id to an empty string', () => {
    const json = JSON.stringify({
      number: 1,
      title: 'x',
      state: 'OPEN',
      labels: [{ name: 'hitl' }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      url: 'https://github.com/acme/widget/issues/1',
    });

    expect(parseGitHubIssue(json).labels[0].id).toBe('');
  });
});

describe('parseIssueState', () => {
  it('extracts state', () => {
    expect(parseIssueState(JSON.stringify({ state: 'CLOSED' }))).toBe('CLOSED');
  });
});

describe('parseIssueCommentsRest', () => {
  it('maps REST user.login/created_at to authorLogin/createdAt, preserving numeric id', () => {
    const json = JSON.stringify([{ id: 90210, body: 'first', user: { login: 'octocat' }, created_at: '2026-01-04T00:00:00Z' }]);

    const comments = parseIssueCommentsRest(json);

    expect(comments).toEqual([{ id: 90210, body: 'first', authorLogin: 'octocat', createdAt: '2026-01-04T00:00:00Z' }]);
  });

  it('defaults body to empty string and authorLogin to unknown when absent', () => {
    const json = JSON.stringify([{ id: 1, created_at: '2026-01-01T00:00:00Z' }]);
    const comments = parseIssueCommentsRest(json);
    expect(comments[0].body).toBe('');
    expect(comments[0].authorLogin).toBe('unknown');
  });
});

describe('parseIssueLabelNames', () => {
  it('extracts label names', () => {
    expect(parseIssueLabelNames(JSON.stringify({ labels: [{ name: 'a' }, { name: 'b' }] }))).toEqual(['a', 'b']);
  });

  it('defaults to [] when labels is absent', () => {
    expect(parseIssueLabelNames(JSON.stringify({}))).toEqual([]);
  });
});

describe('parseCreatedIssueNumber', () => {
  it('parses the trailing issue number, tolerating a trailing newline', () => {
    expect(parseCreatedIssueNumber('https://github.com/acme/widget/issues/101\n')).toBe(101);
  });

  it('throws the verbatim message on non-matching output', () => {
    expect(() => parseCreatedIssueNumber('created something')).toThrow(
      'createIssue: could not parse issue number from gh output: "created something"',
    );
  });
});

describe('parseFirstIssueNumber', () => {
  it('returns the first result\'s number', () => {
    expect(parseFirstIssueNumber(JSON.stringify([{ number: 7 }, { number: 8 }]))).toBe(7);
  });

  it('returns null for an empty array', () => {
    expect(parseFirstIssueNumber(JSON.stringify([]))).toBeNull();
  });
});

describe('parseIssueSummaries / parseIssueListEntries', () => {
  it('parseIssueSummaries passes through typed JSON', () => {
    expect(parseIssueSummaries(JSON.stringify([{ number: 1, title: 'x' }]))).toEqual([{ number: 1, title: 'x' }]);
  });

  it('parseIssueListEntries passes through typed JSON', () => {
    expect(parseIssueListEntries(JSON.stringify([{ number: 1 }]))).toEqual([{ number: 1 }]);
  });
});
