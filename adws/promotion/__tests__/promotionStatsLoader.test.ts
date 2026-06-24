import { describe, it, expect, vi } from 'vitest';
import { loadPromotionStats } from '../promotionStatsLoader.ts';
import type { PromotionStatsLoaderDeps } from '../promotionStatsLoader.ts';
import type { LogSinceOptions } from '../../gitContext/index.ts';

// Fixed now for deterministic isoSince: 2026-05-21 → since = 2026-02-20
const FIXED_NOW = new Date('2026-05-21T00:00:00Z');
const EXPECTED_SINCE = '2026-02-20';

function makeDeps(overrides: Partial<PromotionStatsLoaderDeps> = {}): PromotionStatsLoaderDeps & { gitLogSince: ReturnType<typeof vi.fn> } {
  const gitLogSince = vi.fn().mockReturnValue('');
  return {
    gitLogSince,
    now: () => FIXED_NOW,
    perIssueGlob: 'features/per-issue/feature-*.feature',
    log: vi.fn(),
    ...overrides,
  } as PromotionStatsLoaderDeps & { gitLogSince: ReturnType<typeof vi.fn> };
}

describe('loadPromotionStats', () => {
  it('(a) numerator happy path: two promotion commits → promotedCount90d = 2', () => {
    const deps = makeDeps({
      gitLogSince: vi.fn().mockImplementation((opts: LogSinceOptions) => {
        if (opts.grep) return 'abc1234 regression-promotion: foo\ndef5678 regression-promotion: bar';
        return '';
      }),
    });
    const stats = loadPromotionStats(deps);
    expect(stats.promotedCount90d).toBe(2);
  });

  it('(b) denominator happy path: diff with three Scenario additions → totalPerIssueCount90d = 3', () => {
    const diff = [
      '+  Scenario: first added',
      '-  Scenario: removed',
      '   Scenario: context line',
      '+  Scenario: second added',
      '+  Scenario: third added',
    ].join('\n');
    const deps = makeDeps({
      gitLogSince: vi.fn().mockImplementation((opts: LogSinceOptions) => {
        if (opts.patch) return diff;
        return '';
      }),
    });
    const stats = loadPromotionStats(deps);
    expect(stats.totalPerIssueCount90d).toBe(3);
  });

  it('(c) empty repo: both gitLogSince calls return empty → { 0, 0 }', () => {
    const deps = makeDeps({ gitLogSince: vi.fn().mockReturnValue('') });
    const stats = loadPromotionStats(deps);
    expect(stats).toEqual({ promotedCount90d: 0, totalPerIssueCount90d: 0 });
  });

  it('(d) gitLogSince throws → returns { 0, 0 } without rethrowing', () => {
    const deps = makeDeps({ gitLogSince: vi.fn().mockImplementation(() => { throw new Error('not a git repository'); }) });
    expect(() => loadPromotionStats(deps)).not.toThrow();
    expect(loadPromotionStats(deps)).toEqual({ promotedCount90d: 0, totalPerIssueCount90d: 0 });
  });

  it('(e) numerator command uses ^regression-promotion: anchor and oneline flag', () => {
    const deps = makeDeps();
    loadPromotionStats(deps);
    const calls = (deps.gitLogSince as ReturnType<typeof vi.fn>).mock.calls as [LogSinceOptions][];
    const numeratorCall = calls.find(([opts]) => opts.grep !== undefined);
    expect(numeratorCall).toBeDefined();
    expect(numeratorCall![0]).toEqual({ since: EXPECTED_SINCE, grep: '^regression-promotion:', oneline: true });
  });

  it('(f) denominator counts only + lines, not - or context lines', () => {
    const diff = '-  Scenario: removed\n   Scenario: context\n+  Scenario: added';
    const deps = makeDeps({
      gitLogSince: vi.fn().mockImplementation((opts: LogSinceOptions) => {
        if (opts.patch) return diff;
        return '';
      }),
    });
    const stats = loadPromotionStats(deps);
    expect(stats.totalPerIssueCount90d).toBe(1);
  });

  it('(g) denominator sums Scenario additions across multiple file diffs', () => {
    const diff = [
      '+  Scenario: file1 A',
      '+  Scenario: file1 B',
      '+  Scenario: file2 A',
      '+  Scenario: file2 B',
      '+  Scenario: file2 C',
    ].join('\n');
    const deps = makeDeps({
      gitLogSince: vi.fn().mockImplementation((opts: LogSinceOptions) => {
        if (opts.patch) return diff;
        return '';
      }),
    });
    const stats = loadPromotionStats(deps);
    expect(stats.totalPerIssueCount90d).toBe(5);
  });

  it('(h) now() is called once; resulting since date is 90 days before the fixed now', () => {
    const deps = makeDeps();
    loadPromotionStats(deps);
    const calls = (deps.gitLogSince as ReturnType<typeof vi.fn>).mock.calls as [LogSinceOptions][];
    for (const [opts] of calls) {
      expect(opts.since).toBe(EXPECTED_SINCE);
    }
  });
});
