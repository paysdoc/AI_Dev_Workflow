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

// ── evaluateIssue — review_failed skip-terminal (money-fire pin) ──────────────

describe('evaluateIssue — review_failed skip-terminal', () => {
  it('returns ineligible with reason review_failed for a review_failed issue', () => {
    const issue = makeIssue({ updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('review_failed');

    const result = evaluateIssue(issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('review_failed');
    expect(result.action).toBeUndefined();
  });

  it('review_failed takes precedence over grace period check (recent activity still excluded)', () => {
    const recentDate = new Date(NOW - 1000).toISOString();
    const issue = makeIssue({ updatedAt: recentDate });
    const resolveStage = () => makeResolution('review_failed', 'adw-id', NOW - 1000);

    const result = evaluateIssue(issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('review_failed');
  });

  it('review_failed takes precedence over processed-spawn dedup', () => {
    const issue = makeIssue({ number: 5, updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('review_failed');
    const processed = { spawns: new Set([5]) };

    const result = evaluateIssue(issue, NOW, processed, GRACE_PERIOD_MS, resolveStage);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('review_failed');
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
    const ineligible = vi.fn((_i: CronIssue): LabelRecoveryResult => ({ eligible: false, reason: 'reserved_label' }));

    const result = evaluateIssue(
      issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS,
      () => freshResolution(), new Set(), ineligible,
    );

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('label:reserved_label');
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
    const spy = vi.fn((_i: CronIssue): LabelRecoveryResult => ({ eligible: false, reason: 'reserved_label' }));

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

// ── phase_timeout eligibility ──────────────────────────────────────────────────

describe('evaluateIssue — phase_timeout eligibility', () => {
  it('returns eligible:true with action:spawn for a phase_timeout stage past the grace period', () => {
    const issue = makeIssue({ updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('phase_timeout', 'tg4om4', NOW - 200_000);

    const result = evaluateIssue(issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);

    expect(result.eligible).toBe(true);
    expect(result.action).toBe('spawn');
    expect(result.adwId).toBe('tg4om4');
  });

  it('does NOT return adw_stage:phase_timeout as reason (no longer excluded)', () => {
    const issue = makeIssue({ updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('phase_timeout', 'tg4om4', NOW - 200_000);

    const result = evaluateIssue(issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);

    expect(result.reason).not.toBe('adw_stage:phase_timeout');
  });
});

describe('filterEligibleIssues — phase_timeout appears in eligible, not filteredAnnotations', () => {
  it('includes phase_timeout issue in eligible list', () => {
    const issue = makeIssue({ number: 637, createdAt: OLD_DATE, updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('phase_timeout', 'tg4om4', NOW - 200_000);

    const { eligible, filteredAnnotations } = filterEligibleIssues(
      [issue],
      NOW,
      { spawns: new Set() },
      GRACE_PERIOD_MS,
      resolveStage,
    );

    expect(eligible.map(e => e.issue.number)).toContain(637);
    expect(filteredAnnotations.join(',')).not.toContain('adw_stage:phase_timeout');
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

// ── filterEligibleIssues — region-overlap default resolver wiring ─────────────

describe('filterEligibleIssues — region-overlap default resolver wiring', () => {
  it('serializes two issues whose bodies declare the same touched file when no resolver is injected', () => {
    const sharedPath = 'adws/triggers/takeoverHandler.ts';
    const a = {
      number: 649001,
      body: `## Touched Files\n- \`${sharedPath}\`\n`,
      comments: [],
      createdAt: OLD_DATE,
      updatedAt: OLD_DATE,
      labels: [] as { name: string }[],
    };
    const b = {
      number: 649002,
      body: `## Touched Files\n- \`${sharedPath}\`\n`,
      comments: [],
      createdAt: OLD_DATE,
      updatedAt: OLD_DATE,
      labels: [] as { name: string }[],
    };

    // Deliberately omit the resolver — exercises the production default (resolveTouchedFilesFromBody).
    const { eligible, overlapDeferrals } = filterEligibleIssues(
      [a, b],
      NOW,
      { spawns: new Set() },
      GRACE_PERIOD_MS,
    );

    const eligibleNumbers = eligible.map(e => e.issue.number);
    expect(eligible).toHaveLength(1);
    expect(overlapDeferrals).toHaveLength(1);

    const deferred = overlapDeferrals[0]!;
    const winner = eligibleNumbers[0]!;
    expect(deferred.blockedBy).toBe(winner);
    // overlapPaths are normalized (lowercased) by pathsOverlap/normalizePath
    expect(deferred.overlapPaths).toContain(sharedPath.toLowerCase());
  });
});

// ── evaluateIssue — human_gated skip-terminal ─────────────────────────────────

describe('evaluateIssue — human_gated skip-terminal', () => {
  it('returns ineligible with reason human_gated for a human_gated issue', () => {
    const issue = makeIssue({ updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('human_gated');

    const result = evaluateIssue(issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('human_gated');
    expect(result.action).toBeUndefined();
  });

  it('human_gated takes precedence over grace period check', () => {
    const recentDate = new Date(NOW - 1000).toISOString();
    const issue = makeIssue({ updatedAt: recentDate });
    const resolveStage = () => makeResolution('human_gated', 'adw-id', NOW - 1000);

    const result = evaluateIssue(issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('human_gated');
  });
});

// ── filterEligibleIssues — human_gated annotation ────────────────────────────

describe('filterEligibleIssues — human_gated annotation', () => {
  it('annotates human_gated issue in filteredAnnotations', () => {
    const issue = makeIssue({ number: 7, updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('human_gated');

    const { eligible, filteredAnnotations } = filterEligibleIssues(
      [issue],
      NOW,
      { spawns: new Set() },
      GRACE_PERIOD_MS,
      resolveStage,
    );

    expect(eligible).toHaveLength(0);
    expect(filteredAnnotations).toContain('#7(human_gated)');
  });

  it('does not include human_gated issue in eligible list', () => {
    const gatedIssue = makeIssue({ number: 10, updatedAt: OLD_DATE });
    const freshIssue = makeIssue({ number: 11, createdAt: OLD_DATE, updatedAt: OLD_DATE });

    const resolveStage = (comments: { body: string }[]) =>
      comments === gatedIssue.comments
        ? makeResolution('human_gated')
        : makeResolution(null);

    const { eligible } = filterEligibleIssues(
      [gatedIssue, freshIssue],
      NOW,
      { spawns: new Set() },
      GRACE_PERIOD_MS,
      resolveStage,
    );

    expect(eligible.map(e => e.issue.number)).toEqual([11]);
  });
});

// ── evaluateIssue — processedSpawns must not block recovery (#653) ───────────

describe('evaluateIssue — processedSpawns must not block recovery (#653)', () => {
  it('abandoned issue already in processedSpawns stays eligible for takeover (#653)', () => {
    const issue = makeIssue({ number: 638, updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('abandoned', 'adw-638', NOW - 200_000);
    const result = evaluateIssue(issue, NOW, { spawns: new Set([638]) }, GRACE_PERIOD_MS, resolveStage);
    expect(result.eligible).toBe(true);
    expect(result.action).toBe('spawn');
    expect(result.adwId).toBe('adw-638');
  });

  it('phase_timeout issue already in processedSpawns stays eligible for takeover (#653)', () => {
    const issue = makeIssue({ number: 637, updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('phase_timeout', 'tg4om4', NOW - 200_000);
    const result = evaluateIssue(issue, NOW, { spawns: new Set([637]) }, GRACE_PERIOD_MS, resolveStage);
    expect(result.eligible).toBe(true);
    expect(result.action).toBe('spawn');
    expect(result.adwId).toBe('tg4om4');
  });

  it('fresh (stage === null) issue in processedSpawns stays ineligible — boot-window dedup preserved', () => {
    const issue = makeIssue({ number: 999, updatedAt: OLD_DATE });
    const resolveStage = () => ({ stage: null, adwId: null, lastActivityMs: null });
    const result = evaluateIssue(issue, NOW, { spawns: new Set([999]) }, GRACE_PERIOD_MS, resolveStage);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('processed');
  });

  it('fresh (stage === null) issue NOT in processedSpawns is eligible — unchanged', () => {
    const issue = makeIssue({ number: 1000, updatedAt: OLD_DATE });
    const resolveStage = () => ({ stage: null, adwId: null, lastActivityMs: null });
    const result = evaluateIssue(issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);
    expect(result.eligible).toBe(true);
    expect(result.action).toBe('spawn');
  });
});

describe('filterEligibleIssues — abandoned in processedSpawns appears in eligible, not filtered (#653)', () => {
  it('abandoned issue in processedSpawns appears eligible and is not annotated as (processed)', () => {
    const issue = makeIssue({ number: 638, createdAt: OLD_DATE, updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('abandoned', 'adw-638', NOW - 200_000);

    const { eligible, filteredAnnotations } = filterEligibleIssues(
      [issue],
      NOW,
      { spawns: new Set([638]) },
      GRACE_PERIOD_MS,
      resolveStage,
    );

    expect(eligible.map(e => e.issue.number)).toContain(638);
    expect(eligible.find(e => e.issue.number === 638)?.action).toBe('spawn');
    expect(filteredAnnotations.join(',')).not.toContain('#638(processed)');
  });
});
