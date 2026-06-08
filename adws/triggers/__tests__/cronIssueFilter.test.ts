import { describe, it, expect, vi } from 'vitest';
import { evaluateIssue, filterEligibleIssues } from '../cronIssueFilter';
import type { CronIssue } from '../cronIssueFilter';
import type { StageResolution } from '../cronStageResolver';
import type { LabelRecoveryResult } from '../cronLabelEligibility';

function makeIssue(overrides: {
  number?: number;
  createdAt?: string;
  updatedAt?: string;
  comments?: { body: string }[];
  labels?: { name: string }[];
} = {}) {
  return {
    number: 1,
    body: 'issue body',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    comments: [],
    labels: [],
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

// ── label-recovery gate ────────────────────────────────────────────────────────

// Resolution helper that always produces a fresh, adwId-null result
function freshResolution(): StageResolution {
  return { stage: null, adwId: null, lastActivityMs: null };
}

// Resolution helper with a non-null adwId (simulates dead-orchestrator takeover path)
function takeoverResolution(): StageResolution {
  return { stage: null, adwId: 'existing-adw-id', lastActivityMs: null };
}

describe('evaluateIssue — label-recovery gate', () => {
  it('stage=null + adwId=null + ineligible evaluator → filtered with label: reason', () => {
    const issue = makeIssue({ updatedAt: OLD_DATE });
    const ineligible = vi.fn((_i: CronIssue): LabelRecoveryResult => ({ eligible: false, reason: 'no_adw_label' }));

    const result = evaluateIssue(
      issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS,
      () => freshResolution(), new Set(), ineligible,
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('label:no_adw_label');
    expect(ineligible).toHaveBeenCalledOnce();
  });

  it('stage=null + adwId=null + eligible evaluator → eligible with action spawn', () => {
    const issue = makeIssue({ updatedAt: OLD_DATE });
    const eligible = vi.fn((_i: CronIssue): LabelRecoveryResult => ({ eligible: true }));

    const result = evaluateIssue(
      issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS,
      () => freshResolution(), new Set(), eligible,
    );

    expect(result.eligible).toBe(true);
    expect(result.action).toBe('spawn');
    expect(eligible).toHaveBeenCalledOnce();
  });

  it('stage=null + non-null adwId → gate NOT consulted; issue stays eligible for takeover', () => {
    const issue = makeIssue({ updatedAt: OLD_DATE });
    const spy = vi.fn((_i: CronIssue): LabelRecoveryResult => ({ eligible: false, reason: 'no_adw_label' }));

    const result = evaluateIssue(
      issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS,
      () => takeoverResolution(), new Set(), spy,
    );

    expect(spy).not.toHaveBeenCalled();
    expect(result.eligible).toBe(true);
    expect(result.action).toBe('spawn');
  });

  it('omitting the evaluator preserves legacy behaviour (fresh issue is eligible)', () => {
    const issue = makeIssue({ updatedAt: OLD_DATE });

    const result = evaluateIssue(
      issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS,
      () => freshResolution(),
    );

    expect(result.eligible).toBe(true);
    expect(result.action).toBe('spawn');
  });
});

describe('filterEligibleIssues — label-recovery gate annotations', () => {
  it('ineligible evaluator surfaces label:<reason> in filteredAnnotations', () => {
    const issue = makeIssue({ number: 42, createdAt: OLD_DATE, updatedAt: OLD_DATE });
    const ineligible = (_i: CronIssue): LabelRecoveryResult => ({ eligible: false, reason: 'multi_label' });

    const { eligible, filteredAnnotations } = filterEligibleIssues(
      [issue],
      NOW,
      { spawns: new Set() },
      GRACE_PERIOD_MS,
      () => freshResolution(),
      new Set(),
      ineligible,
    );

    expect(eligible).toHaveLength(0);
    expect(filteredAnnotations).toContain('#42(label:multi_label)');
  });
});
