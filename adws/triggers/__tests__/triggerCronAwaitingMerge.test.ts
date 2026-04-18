import { describe, it, expect } from 'vitest';
import { evaluateIssue, filterEligibleIssues, type CronIssue, type ProcessedSets } from '../cronIssueFilter';
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

/** Fresh empty dedup sets — one factory call per test, never share instances. */
function noProcessed(): ProcessedSets {
  const spawns = new Set<number>();
  const merges = new Set<number>();
  return { spawns, merges };
}

// ── evaluateIssue — awaiting_merge behaviour ─────────────────────────────────

describe('evaluateIssue — awaiting_merge', () => {
  it('returns eligible with action=merge when stage is awaiting_merge', () => {
    const issue = makeIssue({ number: 10 });
    const resolve = (): StageResolution => makeResolution({ stage: 'awaiting_merge', adwId: 'abc123' });

    const result = evaluateIssue(issue, Date.now(), noProcessed(), GRACE, resolve);

    expect(result.eligible).toBe(true);
    expect(result.action).toBe('merge');
    expect(result.adwId).toBe('abc123');
  });

  it('returns ineligible when stage is awaiting_merge but adwId is missing', () => {
    const issue = makeIssue({ number: 10 });
    const resolve = (): StageResolution => makeResolution({ stage: 'awaiting_merge', adwId: null });

    const result = evaluateIssue(issue, Date.now(), noProcessed(), GRACE, resolve);

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

    const result = evaluateIssue(issue, Date.now(), noProcessed(), GRACE, resolve);

    expect(result.eligible).toBe(true);
    expect(result.action).toBe('merge');
  });

  // Regression for #398/#399: when this same cron process originally spawned the
  // SDLC workflow for an issue, the issue is in `processed.spawns`. Once that
  // workflow exits with awaiting_merge, the next poll must still detect it as
  // a merge candidate — the spawn dedup must NOT block the merge path.
  it('ignores processed.spawns when stage is awaiting_merge (regression #398/#399)', () => {
    const issue = makeIssue({ number: 398 });
    const processed = { spawns: new Set<number>([398]), merges: new Set<number>() };
    const resolve = (): StageResolution =>
      makeResolution({ stage: 'awaiting_merge', adwId: 's59wpc-adwprreview-migrated' });

    const result = evaluateIssue(issue, Date.now(), processed, GRACE, resolve);

    expect(result.eligible).toBe(true);
    expect(result.action).toBe('merge');
    expect(result.adwId).toBe('s59wpc-adwprreview-migrated');
  });

  // Without this guard, the cron would re-spawn adwMerge.tsx every 20 s for an
  // awaiting_merge issue, accumulating parallel merge orchestrators per issue.
  it('returns ineligible when stage is awaiting_merge but issue is in processed.merges', () => {
    const issue = makeIssue({ number: 42 });
    const processed = { spawns: new Set<number>(), merges: new Set<number>([42]) };
    const resolve = (): StageResolution =>
      makeResolution({ stage: 'awaiting_merge', adwId: 'abc123' });

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

    const result = evaluateIssue(issue, Date.now(), noProcessed(), GRACE, resolve);

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

    const result = evaluateIssue(issue, Date.now(), noProcessed(), GRACE, resolve);

    expect(result.eligible).toBe(true);
    expect(result.action).toBe('spawn');
  });

  it('excludes an abandoned issue within the grace period', () => {
    const recentMs = Date.now() - 1_000;
    const issue = makeIssue({ number: 7 });
    const resolve = (): StageResolution =>
      makeResolution({ stage: 'abandoned', adwId: 'aaa', lastActivityMs: recentMs });

    const result = evaluateIssue(issue, Date.now(), noProcessed(), GRACE, resolve);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('grace_period');
  });

  // Spawn dedup must still hold for non-awaiting_merge issues: once the SDLC
  // workflow has been spawned, the cron must not re-spawn it on subsequent polls.
  it('returns ineligible when issue is in processed.spawns and stage is not awaiting_merge', () => {
    const issue = makeIssue({ number: 9 });
    const processed = { spawns: new Set<number>([9]), merges: new Set<number>() };
    const resolve = (): StageResolution => makeResolution({ stage: null, adwId: null, lastActivityMs: null });

    const result = evaluateIssue(issue, Date.now(), processed, GRACE, resolve);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('processed');
  });
});

// ── filterEligibleIssues — awaiting_merge propagation ───────────────────────

describe('filterEligibleIssues — awaiting_merge propagation', () => {
  it('includes awaiting_merge issue with adwId and action=merge', () => {
    const issue = makeIssue({ number: 20 });
    const resolve = (): StageResolution => makeResolution({ stage: 'awaiting_merge', adwId: 'merge-id-1' });

    const { eligible, filteredAnnotations } = filterEligibleIssues([issue], Date.now(), noProcessed(), GRACE, resolve);

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
      noProcessed(),
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

    const { eligible } = filterEligibleIssues([newerIssue, olderIssue], Date.now(), noProcessed(), GRACE, resolve);

    expect(eligible[0].issue.number).toBe(30);
    expect(eligible[1].issue.number).toBe(31);
  });

  it('excludes awaiting_merge with no adwId from eligible list', () => {
    const issue = makeIssue({ number: 40 });
    const resolve = (): StageResolution => makeResolution({ stage: 'awaiting_merge', adwId: null });

    const { eligible, filteredAnnotations } = filterEligibleIssues([issue], Date.now(), noProcessed(), GRACE, resolve);

    expect(eligible).toHaveLength(0);
    expect(filteredAnnotations).toContain('#40(awaiting_merge_no_adwid)');
  });

  // List-level regression for #398/#399.
  it('includes awaiting_merge issue even when it is in processed.spawns', () => {
    const issue = makeIssue({ number: 398 });
    const processed = { spawns: new Set<number>([398]), merges: new Set<number>() };
    const resolve = (): StageResolution =>
      makeResolution({ stage: 'awaiting_merge', adwId: 's59wpc-adwprreview-migrated' });

    const { eligible, filteredAnnotations } = filterEligibleIssues([issue], Date.now(), processed, GRACE, resolve);

    expect(eligible).toHaveLength(1);
    expect(eligible[0].action).toBe('merge');
    expect(eligible[0].adwId).toBe('s59wpc-adwprreview-migrated');
    expect(filteredAnnotations).toHaveLength(0);
  });

  // List-level merge dedup.
  it('excludes awaiting_merge issue when it is in processed.merges', () => {
    const issue = makeIssue({ number: 50 });
    const processed = { spawns: new Set<number>(), merges: new Set<number>([50]) };
    const resolve = (): StageResolution =>
      makeResolution({ stage: 'awaiting_merge', adwId: 'some-id' });

    const { eligible, filteredAnnotations } = filterEligibleIssues([issue], Date.now(), processed, GRACE, resolve);

    expect(eligible).toHaveLength(0);
    expect(filteredAnnotations).toContain('#50(processed)');
  });

});

// ── evaluateIssue — cancelledThisCycle ───────────────────────────────────────

describe('evaluateIssue — cancelledThisCycle', () => {
  it('returns ineligible with reason=\'cancelled\' when issue is in cancelledThisCycle', () => {
    const issue = makeIssue({ number: 7 });
    const cancelledThisCycle = new Set<number>([7]);
    const resolve = (): StageResolution => makeResolution({ stage: null });

    const result = evaluateIssue(issue, Date.now(), noProcessed(), GRACE, resolve, cancelledThisCycle);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('cancelled');
  });

  it('cancelled check takes precedence over awaiting_merge', () => {
    const issue = makeIssue({ number: 8 });
    const cancelledThisCycle = new Set<number>([8]);
    const resolve = (): StageResolution => makeResolution({ stage: 'awaiting_merge', adwId: 'abc' });

    const result = evaluateIssue(issue, Date.now(), noProcessed(), GRACE, resolve, cancelledThisCycle);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('cancelled');
  });

  it('cancelled check takes precedence over processed.spawns', () => {
    const issue = makeIssue({ number: 9 });
    const processed = { spawns: new Set<number>([9]), merges: new Set<number>() };
    const cancelledThisCycle = new Set<number>([9]);
    const resolve = (): StageResolution => makeResolution({ stage: null });

    const result = evaluateIssue(issue, Date.now(), processed, GRACE, resolve, cancelledThisCycle);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('cancelled');
  });

  it('two-cycle regression: skipped in cycle 1, eligible in cycle 2', () => {
    const now = Date.now();
    const issue = makeIssue({ number: 444 });
    const processed = noProcessed();
    const resolve = (): StageResolution => makeResolution({ stage: null });

    // Cycle 1: issue is in cancelledThisCycle → filtered with reason 'cancelled'
    const cycle1CancelledSet = new Set<number>([444]);
    const { eligible: cycle1Eligible, filteredAnnotations: cycle1Filtered } =
      filterEligibleIssues([issue], now, processed, GRACE, resolve, cycle1CancelledSet);

    expect(cycle1Eligible).toHaveLength(0);
    expect(cycle1Filtered).toContain('#444(cancelled)');

    // Cycle 2: cancelledThisCycle is empty (new cycle, new set) → issue is eligible
    const cycle2CancelledSet = new Set<number>();
    const { eligible: cycle2Eligible, filteredAnnotations: cycle2Filtered } =
      filterEligibleIssues([issue], now, processed, GRACE, resolve, cycle2CancelledSet);

    expect(cycle2Eligible).toHaveLength(1);
    expect(cycle2Eligible[0].issue.number).toBe(444);
    expect(cycle2Filtered).toHaveLength(0);
  });
});

// ── filterEligibleIssues — cancelledThisCycle annotation ────────────────────

describe('filterEligibleIssues — cancelledThisCycle annotation', () => {
  it('filtered annotation reads \'#N(cancelled)\' when the issue is in cancelledThisCycle', () => {
    const issue = makeIssue({ number: 55 });
    const cancelledThisCycle = new Set<number>([55]);
    const resolve = (): StageResolution => makeResolution({ stage: null });

    const { eligible, filteredAnnotations } =
      filterEligibleIssues([issue], Date.now(), noProcessed(), GRACE, resolve, cancelledThisCycle);

    expect(eligible).toHaveLength(0);
    expect(filteredAnnotations).toContain('#55(cancelled)');
  });
});
