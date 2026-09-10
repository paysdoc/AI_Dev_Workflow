import { describe, it, expect } from 'vitest';
import { fetchIssueRecord } from '../issueRecord';
import type { Issue, IssueTracker } from '../../providers/types';

const SAMPLE_ISSUE: Issue = {
  id: '42', number: 42, title: 'Ship it', body: 'Do the thing', state: 'OPEN',
  author: 'octocat', labels: ['adw:feature'], comments: [],
  createdAt: '2026-01-01T00:00:00Z', url: 'https://github.com/acme/widget/issues/42',
};

function fakeTracker(fetchIssue: IssueTracker['fetchIssue']): Pick<IssueTracker, 'fetchIssue'> {
  return { fetchIssue };
}

describe('fetchIssueRecord', () => {
  it('delegates to the tracker with the given issue number', async () => {
    const calls: number[] = [];
    const tracker = fakeTracker(async (issueNumber) => {
      calls.push(issueNumber);
      return SAMPLE_ISSUE;
    });

    await fetchIssueRecord(tracker, 42);

    expect(calls).toEqual([42]);
  });

  it('returns the tracker\'s Issue untouched', async () => {
    const tracker = fakeTracker(async () => SAMPLE_ISSUE);

    const issue = await fetchIssueRecord(tracker, 42);

    expect(issue).toBe(SAMPLE_ISSUE);
  });

  it('propagates the tracker\'s rejection message unchanged — no double-wrapped prefix', async () => {
    const tracker = fakeTracker(async () => {
      throw new Error('Failed to fetch issue #42: boom');
    });

    await expect(fetchIssueRecord(tracker, 42)).rejects.toThrow(/^Failed to fetch issue #42: boom$/);
  });
});
