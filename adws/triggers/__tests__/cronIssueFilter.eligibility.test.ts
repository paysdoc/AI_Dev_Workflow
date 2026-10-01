import { describe, it, expect } from 'vitest';
import { evaluateIssue, filterEligibleIssues } from '../cronIssueFilter';
import type { CronIssue } from '../cronIssueFilter';
import type { LabelRecoveryResult } from '../cronLabelEligibility';
import { GRACE_PERIOD_MS, NOW, OLD_DATE, freshResolution, makeIssue, makeResolution } from './cronIssueFilterFixtures';

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
