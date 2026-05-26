import { describe, it, expect } from 'vitest';
import { evaluateIssue, filterEligibleIssues } from '../cronIssueFilter';
import type { StageResolution } from '../cronStageResolver';

function makeIssue(overrides: {
  number?: number;
  createdAt?: string;
  updatedAt?: string;
  comments?: { body: string }[];
} = {}) {
  return {
    number: 1,
    body: 'issue body',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    comments: [],
    ...overrides,
  };
}

function makeResolution(stage: string | null, adwId = 'test-adw-id', lastActivityMs: number | null = null): StageResolution {
  return { stage, adwId, lastActivityMs };
}

const GRACE_PERIOD_MS = 60_000;
const NOW = new Date('2024-06-01T12:00:00Z').getTime();
const OLD_DATE = new Date('2024-01-01T00:00:00Z').toISOString();

// ── evaluateIssue — merge_blocked skip-terminal ────────────────────────────────

describe('evaluateIssue — merge_blocked skip-terminal', () => {
  it('returns ineligible with reason merge_blocked for a merge_blocked issue', () => {
    const issue = makeIssue({ updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('merge_blocked');

    const result = evaluateIssue(issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('merge_blocked');
    expect(result.action).toBeUndefined();
  });

  it('merge_blocked takes precedence over grace period check (recent activity still excluded)', () => {
    const recentDate = new Date(NOW - 1000).toISOString();
    const issue = makeIssue({ updatedAt: recentDate });
    const resolveStage = () => makeResolution('merge_blocked', 'adw-id', NOW - 1000);

    const result = evaluateIssue(issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('merge_blocked');
  });

  it('merge_blocked takes precedence over processed-spawn dedup', () => {
    const issue = makeIssue({ number: 5, updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('merge_blocked');
    const processed = { spawns: new Set([5]) };

    const result = evaluateIssue(issue, NOW, processed, GRACE_PERIOD_MS, resolveStage);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('merge_blocked');
  });
});

// ── filterEligibleIssues — merge_blocked annotation ───────────────────────────

describe('filterEligibleIssues — merge_blocked annotation', () => {
  it('annotates merge_blocked issue in filteredAnnotations', () => {
    const issue = makeIssue({ number: 7, updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('merge_blocked');

    const { eligible, filteredAnnotations } = filterEligibleIssues(
      [issue],
      NOW,
      { spawns: new Set() },
      GRACE_PERIOD_MS,
      resolveStage,
    );

    expect(eligible).toHaveLength(0);
    expect(filteredAnnotations).toContain('#7(merge_blocked)');
  });

  it('does not include merge_blocked issue in eligible list', () => {
    const blockedIssue = makeIssue({ number: 10, updatedAt: OLD_DATE });
    const freshIssue = makeIssue({ number: 11, createdAt: OLD_DATE, updatedAt: OLD_DATE });

    const resolveStage = (comments: { body: string }[]) =>
      comments === blockedIssue.comments
        ? makeResolution('merge_blocked')
        : makeResolution(null);

    const { eligible } = filterEligibleIssues(
      [blockedIssue, freshIssue],
      NOW,
      { spawns: new Set() },
      GRACE_PERIOD_MS,
      resolveStage,
    );

    expect(eligible.map(e => e.issue.number)).toEqual([11]);
  });
});
