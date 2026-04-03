import { describe, it, expect } from 'vitest';
import { evaluateIssue, filterEligibleIssues, type CronIssue } from '../cronIssueFilter';
import type { StageResolution } from '../cronStageResolver';

// ── Helpers ─────────────────────────────────────────────────────────────────

const GRACE = 60_000; // 60 s grace period used across all tests

function makeIssue(overrides: Partial<CronIssue> = {}): CronIssue {
  return {
    number: 1,
    body: '',
    comments: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: new Date(Date.now() - GRACE * 2).toISOString(), // old enough
    ...overrides,
  };
}

function makeResolution(overrides: Partial<StageResolution> = {}): StageResolution {
  return {
    stage: null,
    adwId: null,
    lastActivityMs: null,
    ...overrides,
  };
}

// ── evaluateIssue — awaiting_merge behaviour ─────────────────────────────────

describe('evaluateIssue — awaiting_merge', () => {
  it('returns eligible with action=merge when stage is awaiting_merge', () => {
    const issue = makeIssue({ number: 10 });
    const resolve = (): StageResolution => makeResolution({ stage: 'awaiting_merge', adwId: 'abc123' });

    const result = evaluateIssue(issue, Date.now(), new Set(), GRACE, resolve);

    expect(result.eligible).toBe(true);
    expect(result.action).toBe('merge');
    expect(result.adwId).toBe('abc123');
  });

  it('returns ineligible when stage is awaiting_merge but adwId is missing', () => {
    const issue = makeIssue({ number: 10 });
    const resolve = (): StageResolution => makeResolution({ stage: 'awaiting_merge', adwId: null });

    const result = evaluateIssue(issue, Date.now(), new Set(), GRACE, resolve);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('awaiting_merge_no_adwid');
  });

  it('bypasses grace period for awaiting_merge (recent activity still eligible)', () => {
    const recentMs = Date.now() - 1_000; // only 1 second old — within grace period
    const issue = makeIssue({
      number: 10,
      updatedAt: new Date(recentMs).toISOString(),
    });
    const resolve = (): StageResolution =>
      makeResolution({ stage: 'awaiting_merge', adwId: 'xyz789', lastActivityMs: recentMs });

    const result = evaluateIssue(issue, Date.now(), new Set(), GRACE, resolve);

    expect(result.eligible).toBe(true);
    expect(result.action).toBe('merge');
  });

  it('returns ineligible when already in processedIssues', () => {
    const issue = makeIssue({ number: 42 });
    const processed = new Set([42]);
    const resolve = (): StageResolution => makeResolution({ stage: 'awaiting_merge', adwId: 'abc123' });

    const result = evaluateIssue(issue, Date.now(), processed, GRACE, resolve);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('processed');
  });
});

// ── evaluateIssue — grace period still applies to non-awaiting_merge ─────────

describe('evaluateIssue — grace period for standard stages', () => {
  it('excludes a fresh issue within the grace period', () => {
    const recentMs = Date.now() - 1_000;
    const issue = makeIssue({
      number: 5,
      updatedAt: new Date(recentMs).toISOString(),
    });
    const resolve = (): StageResolution =>
      makeResolution({ stage: null, adwId: null, lastActivityMs: recentMs });

    const result = evaluateIssue(issue, Date.now(), new Set(), GRACE, resolve);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('grace_period');
  });

  it('includes a fresh issue that has aged past the grace period', () => {
    const oldMs = Date.now() - GRACE * 2;
    const issue = makeIssue({
      number: 5,
      updatedAt: new Date(oldMs).toISOString(),
    });
    const resolve = (): StageResolution =>
      makeResolution({ stage: null, adwId: null, lastActivityMs: null });

    const result = evaluateIssue(issue, Date.now(), new Set(), GRACE, resolve);

    expect(result.eligible).toBe(true);
    expect(result.action).toBe('spawn');
  });

  it('excludes an abandoned issue within the grace period', () => {
    const recentMs = Date.now() - 1_000;
    const issue = makeIssue({ number: 7 });
    const resolve = (): StageResolution =>
      makeResolution({ stage: 'abandoned', adwId: 'aaa', lastActivityMs: recentMs });

    const result = evaluateIssue(issue, Date.now(), new Set(), GRACE, resolve);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('grace_period');
  });
});

// ── filterEligibleIssues — awaiting_merge propagation ───────────────────────

describe('filterEligibleIssues — awaiting_merge propagation', () => {
  it('includes awaiting_merge issue with adwId and action=merge', () => {
    const issue = makeIssue({ number: 20 });
    const resolve = (): StageResolution => makeResolution({ stage: 'awaiting_merge', adwId: 'merge-id-1' });

    const { eligible, filteredAnnotations } = filterEligibleIssues([issue], Date.now(), new Set(), GRACE, resolve);

    expect(eligible).toHaveLength(1);
    expect(eligible[0].action).toBe('merge');
    expect(eligible[0].adwId).toBe('merge-id-1');
    expect(eligible[0].issue.number).toBe(20);
    expect(filteredAnnotations).toHaveLength(0);
  });

  it('keeps awaiting_merge in eligible list even when other issues are filtered', () => {
    const awaitingMergeIssue = makeIssue({ number: 20, createdAt: '2024-01-02T00:00:00Z' });
    const recentIssue = makeIssue({
      number: 21,
      updatedAt: new Date(Date.now() - 1_000).toISOString(),
      createdAt: '2024-01-01T00:00:00Z',
    });

    const resolveStage = (comments: { body: string }[]): StageResolution => {
      // Distinguish by comments array identity (empty = awaiting_merge, has content = fresh)
      if (comments === awaitingMergeIssue.comments) {
        return makeResolution({ stage: 'awaiting_merge', adwId: 'merge-id-2' });
      }
      return makeResolution({ stage: null, lastActivityMs: Date.now() - 1_000 });
    };

    const { eligible, filteredAnnotations } = filterEligibleIssues(
      [awaitingMergeIssue, recentIssue],
      Date.now(),
      new Set(),
      GRACE,
      resolveStage,
    );

    expect(eligible).toHaveLength(1);
    expect(eligible[0].issue.number).toBe(20);
    expect(filteredAnnotations).toContain('#21(grace_period)');
  });

  it('returns results sorted oldest-first by createdAt', () => {
    const olderIssue = makeIssue({ number: 30, createdAt: '2024-01-01T00:00:00Z' });
    const newerIssue = makeIssue({ number: 31, createdAt: '2024-06-01T00:00:00Z' });

    const resolve = (): StageResolution => makeResolution({ stage: 'awaiting_merge', adwId: 'some-id' });

    const { eligible } = filterEligibleIssues([newerIssue, olderIssue], Date.now(), new Set(), GRACE, resolve);

    expect(eligible[0].issue.number).toBe(30);
    expect(eligible[1].issue.number).toBe(31);
  });

  it('excludes awaiting_merge with no adwId from eligible list', () => {
    const issue = makeIssue({ number: 40 });
    const resolve = (): StageResolution => makeResolution({ stage: 'awaiting_merge', adwId: null });

    const { eligible, filteredAnnotations } = filterEligibleIssues([issue], Date.now(), new Set(), GRACE, resolve);

    expect(eligible).toHaveLength(0);
    expect(filteredAnnotations).toContain('#40(awaiting_merge_no_adwid)');
  });

  it('excludes already-processed awaiting_merge issues', () => {
    const issue = makeIssue({ number: 50 });
    const processed = new Set([50]);
    const resolve = (): StageResolution => makeResolution({ stage: 'awaiting_merge', adwId: 'some-id' });

    const { eligible } = filterEligibleIssues([issue], Date.now(), processed, GRACE, resolve);

    expect(eligible).toHaveLength(0);
  });
});
