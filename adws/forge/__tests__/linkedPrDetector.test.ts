import { describe, it, expect, vi } from 'vitest';
import { hasLinkedMergedOrClosedPR, fetchLinkedPRs } from '../linkedPrDetector';
import type { LinkedPRRef } from '../linkedPrDetector';
import type { CodeHost, PullRequestRecord } from '../../providers/types';

vi.mock('../../core/logger', () => ({ log: vi.fn() }));

function makePR(overrides: Partial<LinkedPRRef> & { number: number; body: string }): LinkedPRRef {
  return {
    state: 'OPEN',
    mergedAt: null,
    ...overrides,
  };
}

describe('hasLinkedMergedOrClosedPR', () => {
  it('returns true for a PR with Implements reference that is merged', () => {
    const prs = [makePR({ number: 10, body: 'Implements #42', mergedAt: '2024-01-01T00:00:00Z' })];
    expect(hasLinkedMergedOrClosedPR(42, prs)).toBe(true);
  });

  it('returns true for a PR with Implements reference that is CLOSED', () => {
    const prs = [makePR({ number: 11, body: 'Implements #42', state: 'CLOSED', mergedAt: null })];
    expect(hasLinkedMergedOrClosedPR(42, prs)).toBe(true);
  });

  // #592 regression: the SDLC PR template emits the repo-qualified `Closes` form.
  it('returns true for a merged PR with a repo-qualified `Closes owner/repo#N` body', () => {
    const prs = [makePR({ number: 30, body: 'Closes paysdoc/AI_Dev_Workflow#42', mergedAt: '2024-01-01T00:00:00Z' })];
    expect(hasLinkedMergedOrClosedPR(42, prs)).toBe(true);
  });

  it('returns false for a PR with Implements reference that is OPEN (not merged)', () => {
    const prs = [makePR({ number: 12, body: 'Implements #42', state: 'OPEN', mergedAt: null })];
    expect(hasLinkedMergedOrClosedPR(42, prs)).toBe(false);
  });

  it('returns false when no PR references the issue', () => {
    const prs = [makePR({ number: 13, body: 'Fixes a bug', mergedAt: '2024-01-01T00:00:00Z' })];
    expect(hasLinkedMergedOrClosedPR(42, prs)).toBe(false);
  });

  it('returns false when only an unrelated closed PR exists', () => {
    const prs = [
      makePR({ number: 14, body: 'Implements #99', state: 'CLOSED', mergedAt: null }),
      makePR({ number: 15, body: 'Implements #42', state: 'OPEN', mergedAt: null }),
    ];
    expect(hasLinkedMergedOrClosedPR(42, prs)).toBe(false);
  });

  it('returns false for an empty PR list', () => {
    expect(hasLinkedMergedOrClosedPR(42, [])).toBe(false);
  });

  // Digit-boundary: Implements #1 must not match issue #12
  it('does not match Implements #1 when checking issue #12', () => {
    const prs = [makePR({ number: 20, body: 'Implements #1', mergedAt: '2024-01-01T00:00:00Z' })];
    expect(hasLinkedMergedOrClosedPR(12, prs)).toBe(false);
  });

  // Digit-boundary: Implements #12 must not match issue #1
  it('does not match Implements #12 when checking issue #1', () => {
    const prs = [makePR({ number: 21, body: 'Implements #12', mergedAt: '2024-01-01T00:00:00Z' })];
    expect(hasLinkedMergedOrClosedPR(1, prs)).toBe(false);
  });

  it('matches Implements #1 correctly when checking issue #1', () => {
    const prs = [makePR({ number: 22, body: 'Implements #1', mergedAt: '2024-01-01T00:00:00Z' })];
    expect(hasLinkedMergedOrClosedPR(1, prs)).toBe(true);
  });

  it('matches Implements #12 correctly when checking issue #12', () => {
    const prs = [makePR({ number: 23, body: 'Implements #12 some text', mergedAt: '2024-01-01T00:00:00Z' })];
    expect(hasLinkedMergedOrClosedPR(12, prs)).toBe(true);
  });
});

describe('fetchLinkedPRs', () => {
  it('returns the code host\'s records unchanged', () => {
    const records: PullRequestRecord[] = [{ number: 1, body: 'Implements #42', state: 'MERGED', mergedAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z', url: 'https://github.com/acme/widget/pull/1' }];
    const codeHost: Pick<CodeHost, 'listPullRequests'> = { listPullRequests: () => records };
    expect(fetchLinkedPRs(codeHost)).toEqual(records);
  });

  it('returns [] and logs an error when listPullRequests throws', async () => {
    const { log } = await import('../../core/logger');
    const codeHost: Pick<CodeHost, 'listPullRequests'> = {
      listPullRequests: () => { throw new Error('rate limited'); },
    };
    expect(fetchLinkedPRs(codeHost)).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch PRs for linked-PR detection'), 'error');
  });
});
