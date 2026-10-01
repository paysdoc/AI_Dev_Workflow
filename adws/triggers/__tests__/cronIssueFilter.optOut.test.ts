import { describe, it, expect, vi } from 'vitest';
import { evaluateIssue, filterEligibleIssues } from '../cronIssueFilter';
import type { CronIssue } from '../cronIssueFilter';
import type { LabelRecoveryResult } from '../cronLabelEligibility';
import { GRACE_PERIOD_MS, NOW, OLD_DATE, freshResolution, makeIssue, makeResolution, takeoverResolution } from './cronIssueFilterFixtures';

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

describe('evaluateIssue — adw:none opts out on every stage', () => {
  const OPTED_OUT = { eligible: false, reason: 'label:opt_out' };

  function makeOptedOutIssue(number = 9) {
    return makeIssue({ number, labels: [{ name: 'adw:none' }], updatedAt: OLD_DATE });
  }

  it('drops a fresh issue although no label evaluator is injected', () => {
    const result = evaluateIssue(makeOptedOutIssue(), NOW, { spawns: new Set() }, GRACE_PERIOD_MS, () => freshResolution());

    expect(result).toEqual(OPTED_OUT);
  });

  it('drops a fresh issue with a prior adwId, which the label evaluator never sees', () => {
    const evaluator = vi.fn((_i: CronIssue): LabelRecoveryResult => ({ eligible: true }));

    const result = evaluateIssue(
      makeOptedOutIssue(), NOW, { spawns: new Set() }, GRACE_PERIOD_MS,
      () => takeoverResolution(), new Set(), evaluator,
    );

    expect(result).toEqual(OPTED_OUT);
    expect(evaluator).not.toHaveBeenCalled();
  });

  it.each(['abandoned', 'phase_timeout'])('drops an issue at stage %s, so no take-over is dispatched', (stage) => {
    const resolveStage = () => makeResolution(stage, 'adw-prior', NOW - 200_000);

    const result = evaluateIssue(makeOptedOutIssue(), NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);

    expect(result).toEqual(OPTED_OUT);
  });

  it('drops an awaiting_merge issue, so no merge is dispatched', () => {
    const resolveStage = () => makeResolution('awaiting_merge', 'adw-prior');

    const result = evaluateIssue(makeOptedOutIssue(), NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);

    expect(result).toEqual(OPTED_OUT);
  });

  it('keeps the cancelled-this-cycle reason ahead of the opt-out', () => {
    const result = evaluateIssue(
      makeOptedOutIssue(9), NOW, { spawns: new Set() }, GRACE_PERIOD_MS,
      () => freshResolution(), new Set([9]),
    );

    expect(result).toEqual({ eligible: false, reason: 'cancelled' });
  });

  it('filterEligibleIssues leaves the issue out of eligible and annotates it #N(label:opt_out)', () => {
    const resolveStage = () => makeResolution('abandoned', 'adw-prior', NOW - 200_000);

    const { eligible, filteredAnnotations } = filterEligibleIssues(
      [makeOptedOutIssue(12)], NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage,
    );

    expect(eligible).toHaveLength(0);
    expect(filteredAnnotations).toContain('#12(label:opt_out)');
  });

  it('control: the same abandoned issue without the label stays eligible for take-over', () => {
    const issue = makeIssue({ number: 9, updatedAt: OLD_DATE });
    const resolveStage = () => makeResolution('abandoned', 'adw-prior', NOW - 200_000);

    const result = evaluateIssue(issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);

    expect(result.eligible).toBe(true);
    expect(result.action).toBe('spawn');
  });
});
