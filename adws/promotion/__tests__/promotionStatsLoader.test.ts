import { describe, it, expect, vi } from 'vitest';
import { loadPromotionStats } from '../promotionStatsLoader.ts';
import type { PromotionStatsLoaderDeps } from '../promotionStatsLoader.ts';
import { computeThreshold, BOOTSTRAP_THRESHOLD } from '../promotionThreshold.ts';
import type { LogSinceOptions } from '@paysdoc/devplatform/git';

// Fixed now for deterministic isoSince: 2026-05-21 → since = 2026-02-20
const FIXED_NOW = new Date('2026-05-21T00:00:00Z');
const EXPECTED_SINCE = '2026-02-20';
const DAY_MS = 86_400_000;

const FEATURE_HEADER = 'diff --git a/features/per-issue/feature-1.feature b/features/per-issue/feature-1.feature';
const STEPS_HEADER = 'diff --git a/features/per-issue/step_definitions/feature-1.steps.ts b/features/per-issue/step_definitions/feature-1.steps.ts';

function daysBeforeNow(days: number): Date {
  return new Date(FIXED_NOW.getTime() - days * DAY_MS);
}

function scenarioAdditions(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `+  Scenario: added ${i + 1}`);
}

function patchOf(...lines: string[]): (opts: LogSinceOptions) => string {
  return (opts) => (opts.patch ? lines.join('\n') : '');
}

type Deps = PromotionStatsLoaderDeps & { gitLogSince: ReturnType<typeof vi.fn> };

function makeDeps(overrides: Partial<PromotionStatsLoaderDeps> = {}): Deps {
  return {
    gitLogSince: vi.fn().mockReturnValue(''),
    listPromotionMergeDates: () => [],
    now: () => FIXED_NOW,
    perIssueDir: 'features/per-issue',
    log: vi.fn(),
    ...overrides,
  } as Deps;
}

describe('loadPromotionStats', () => {
  it('(a) numerator counts the promotions that merged inside the 90-day window', () => {
    const deps = makeDeps({
      listPromotionMergeDates: () => [daysBeforeNow(10), daysBeforeNow(10), daysBeforeNow(89)],
    });
    expect(loadPromotionStats(deps).promotedCount90d).toBe(3);
  });

  it('(a2) numerator ignores promotions that merged before the window', () => {
    const deps = makeDeps({
      listPromotionMergeDates: () => [daysBeforeNow(10), daysBeforeNow(91), daysBeforeNow(120)],
    });
    expect(loadPromotionStats(deps).promotedCount90d).toBe(1);
  });

  it('(b) denominator happy path: diff with three Scenario additions → totalPerIssueCount90d = 3', () => {
    const deps = makeDeps({
      gitLogSince: vi.fn().mockImplementation(patchOf(
        FEATURE_HEADER,
        '+  Scenario: first added',
        '-  Scenario: removed',
        '   Scenario: context line',
        '+  Scenario: second added',
        '+  Scenario: third added',
      )),
    });
    expect(loadPromotionStats(deps).totalPerIssueCount90d).toBe(3);
  });

  it('(c) empty repo: no promotions and an empty log → { 0, 0 }', () => {
    expect(loadPromotionStats(makeDeps())).toEqual({ promotedCount90d: 0, totalPerIssueCount90d: 0 });
  });

  it('(d) gitLogSince throws → denominator 0 without rethrowing, numerator untouched', () => {
    const deps = makeDeps({
      gitLogSince: vi.fn().mockImplementation(() => { throw new Error('not a git repository'); }),
      listPromotionMergeDates: () => [daysBeforeNow(10)],
    });
    expect(() => loadPromotionStats(deps)).not.toThrow();
    expect(loadPromotionStats(deps)).toEqual({ promotedCount90d: 1, totalPerIssueCount90d: 0 });
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('denominator query failed'), 'warn');
  });

  it('(e) runs one history query, for the per-issue directory as a plain pathspec, with no commit-subject grep', () => {
    const deps = makeDeps();
    loadPromotionStats(deps);
    expect(deps.gitLogSince).toHaveBeenCalledTimes(1);
    expect(deps.gitLogSince).toHaveBeenCalledWith({ since: EXPECTED_SINCE, patch: true, pathspec: 'features/per-issue' });
  });

  it('(f) denominator counts only + lines, not - or context lines', () => {
    const deps = makeDeps({
      gitLogSince: vi.fn().mockImplementation(patchOf(
        FEATURE_HEADER,
        '-  Scenario: removed',
        '   Scenario: context',
        '+  Scenario: added',
      )),
    });
    expect(loadPromotionStats(deps).totalPerIssueCount90d).toBe(1);
  });

  it('(g) denominator sums Scenario additions across multiple .feature file diffs', () => {
    const deps = makeDeps({
      gitLogSince: vi.fn().mockImplementation(patchOf(
        FEATURE_HEADER,
        ...scenarioAdditions(2),
        'diff --git a/features/per-issue/feature-2.feature b/features/per-issue/feature-2.feature',
        ...scenarioAdditions(3),
      )),
    });
    expect(loadPromotionStats(deps).totalPerIssueCount90d).toBe(5);
  });

  it('(g2) denominator does not count Scenario Outline additions', () => {
    const deps = makeDeps({
      gitLogSince: vi.fn().mockImplementation(patchOf(
        FEATURE_HEADER,
        '+  Scenario Outline: parameterised',
        '+  Scenario: plain',
      )),
    });
    expect(loadPromotionStats(deps).totalPerIssueCount90d).toBe(1);
  });

  it('(g3) denominator ignores Gherkin embedded in a step-definition fixture', () => {
    const deps = makeDeps({
      gitLogSince: vi.fn().mockImplementation(patchOf(
        FEATURE_HEADER,
        ...scenarioAdditions(2),
        STEPS_HEADER,
        ...scenarioAdditions(5),
      )),
    });
    expect(loadPromotionStats(deps).totalPerIssueCount90d).toBe(2);
  });

  it('(g4) denominator still counts the .feature section that follows a step-definition section', () => {
    const deps = makeDeps({
      gitLogSince: vi.fn().mockImplementation(patchOf(
        STEPS_HEADER,
        ...scenarioAdditions(5),
        FEATURE_HEADER,
        ...scenarioAdditions(2),
      )),
    });
    expect(loadPromotionStats(deps).totalPerIssueCount90d).toBe(2);
  });

  it('(h) now() is read once; the resulting since date is 90 days before the fixed now', () => {
    const now = vi.fn(() => FIXED_NOW);
    const deps = makeDeps({ now });
    loadPromotionStats(deps);
    expect(now).toHaveBeenCalledTimes(1);
    expect(deps.gitLogSince).toHaveBeenCalledWith(expect.objectContaining({ since: EXPECTED_SINCE }));
  });

  it('(i) listPromotionMergeDates throwing → numerator 0 with a warning, denominator still computed', () => {
    const deps = makeDeps({
      listPromotionMergeDates: () => { throw new Error('forge unavailable'); },
      gitLogSince: vi.fn().mockImplementation(patchOf(FEATURE_HEADER, ...scenarioAdditions(4))),
    });
    expect(loadPromotionStats(deps)).toEqual({ promotedCount90d: 0, totalPerIssueCount90d: 4 });
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('numerator query failed'), 'warn');
  });

  describe('threshold ramp', () => {
    const promotions = (count: number) => Array.from({ length: count }, () => daysBeforeNow(10));
    const rampCases: ReadonlyArray<readonly [number, number]> = [[0, 3], [1, 4], [2, 5], [4, 7]];

    it.each(rampCases)('with %i promotion(s) merged 10 days ago against 8 scenario additions, the threshold is %i', (merged, threshold) => {
      const deps = makeDeps({
        listPromotionMergeDates: () => promotions(merged),
        gitLogSince: vi.fn().mockImplementation(patchOf(FEATURE_HEADER, ...scenarioAdditions(8))),
      });
      const computed = computeThreshold(loadPromotionStats(deps));
      expect(computed).toBe(threshold);
      if (merged > 0) expect(computed).toBeGreaterThan(BOOTSTRAP_THRESHOLD);
    });

    it('promotions merged more than 90 days ago leave the threshold at the bootstrap value', () => {
      const deps = makeDeps({
        listPromotionMergeDates: () => [daysBeforeNow(120), daysBeforeNow(200)],
        gitLogSince: vi.fn().mockImplementation(patchOf(FEATURE_HEADER, ...scenarioAdditions(8))),
      });
      expect(computeThreshold(loadPromotionStats(deps))).toBe(BOOTSTRAP_THRESHOLD);
    });
  });
});
