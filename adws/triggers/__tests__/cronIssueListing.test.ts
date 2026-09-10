import { describe, it, expect, vi } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

import { listCronOpenIssues } from '../cronIssueListing';
import { log } from '../../core';
import { evaluateIssue } from '../cronIssueFilter';
import type { StageResolution } from '../cronStageResolver';
import type { IssueTracker } from '../../providers/types';

function makeFakeIssueTracker(overrides: Record<string, unknown> = {}): Pick<IssueTracker, 'listIssues'> {
  return {
    listIssues: vi.fn(() => []),
    ...overrides,
  } as unknown as Pick<IssueTracker, 'listIssues'>;
}

describe('listCronOpenIssues', () => {
  it('queries the exact seven fields the cron has always requested, with a limit of 100', () => {
    const issueTracker = makeFakeIssueTracker();

    listCronOpenIssues(issueTracker);

    expect(issueTracker.listIssues).toHaveBeenCalledWith({
      fields: ['number', 'title', 'body', 'comments', 'createdAt', 'updatedAt', 'labels'],
      limit: 100,
    });
  });

  it('returns the tracker-provided entries unchanged', () => {
    const rawIssue = {
      number: 42,
      title: 'Fix the thing',
      body: 'issue body',
      comments: [{ body: 'a comment' }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      labels: [{ name: 'adw:bug' }],
    };
    const issueTracker = makeFakeIssueTracker({ listIssues: vi.fn(() => [rawIssue]) });

    const result = listCronOpenIssues(issueTracker);

    expect(result).toEqual([rawIssue]);
  });

  it('the parsed entries carry every field cronIssueFilter.evaluateIssue reads (body, comments, labels, createdAt, updatedAt)', () => {
    const rawIssue = {
      number: 42,
      title: 'Fix the thing',
      body: 'issue body',
      comments: [{ body: 'adw_id: test-adw-id' }],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      labels: [{ name: 'adw:bug' }],
    };
    const issueTracker = makeFakeIssueTracker({ listIssues: vi.fn(() => [rawIssue]) });
    const [issue] = listCronOpenIssues(issueTracker);

    const resolveStage = (): StageResolution => ({ stage: null, adwId: null, lastActivityMs: null });
    const result = evaluateIssue(issue, Date.now(), { spawns: new Set() }, 60_000, resolveStage);

    // Reaching a real eligibility verdict (rather than throwing on a missing
    // field) proves the shape survived the round trip through listIssues.
    expect(typeof result.eligible).toBe('boolean');
  });

  it('logs and returns [] when the issue tracker throws (fail-open — a tick must never abort on a listing failure)', () => {
    const issueTracker = makeFakeIssueTracker({
      listIssues: vi.fn(() => {
        throw new Error('gh api rate limited');
      }),
    });

    const result = listCronOpenIssues(issueTracker);

    expect(result).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch issues'), 'error');
  });
});
