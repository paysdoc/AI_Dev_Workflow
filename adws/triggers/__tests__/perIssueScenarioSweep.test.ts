import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readdirSync: vi.fn(() => []),
    rmSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => []),
  rmSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

vi.mock('../../github', () => ({
  getRepoInfo: vi.fn(() => ({ owner: 'test-owner', repo: 'test-repo' })),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { isScenarioStale, runPerIssueScenarioSweep, RETENTION_DAYS } from '../perIssueScenarioSweep';

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const NOW = new Date('2026-04-28T12:00:00Z');

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS);
}

// ── Predicate truth table ────────────────────────────────────────────────────

describe('isScenarioStale — truth table', () => {
  it('mergedAt = null → false (issue not yet merged)', () => {
    expect(isScenarioStale('features/per-issue/feature-1.feature', null, RETENTION_DAYS, NOW)).toBe(false);
  });

  it('age = 13d → false (within retention window)', () => {
    expect(isScenarioStale('features/per-issue/feature-2.feature', daysAgo(13), RETENTION_DAYS, NOW)).toBe(false);
  });

  it('age = 14d exactly → true (on the boundary)', () => {
    expect(isScenarioStale('features/per-issue/feature-3.feature', daysAgo(14), RETENTION_DAYS, NOW)).toBe(true);
  });

  it('age = 30d → true (well past retention)', () => {
    expect(isScenarioStale('features/per-issue/feature-4.feature', daysAgo(30), RETENTION_DAYS, NOW)).toBe(true);
  });

  it('mergedAt in the future (clock skew) → false', () => {
    const future = new Date(NOW.getTime() + HOUR_MS);
    expect(isScenarioStale('features/per-issue/feature-5.feature', future, RETENTION_DAYS, NOW)).toBe(false);
  });
});

// ── Sweep integration block ──────────────────────────────────────────────────

describe('runPerIssueScenarioSweep — integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes only the stale file; leaves fresh and unmerged files alone', async () => {
    const staleFile = 'features/per-issue/feature-100.feature';
    const freshFile = 'features/per-issue/feature-200.feature';
    const unmergedFile = 'features/per-issue/feature-300.feature';

    const getMergedAt = vi.fn(async (issueNum: number): Promise<Date | null> => {
      if (issueNum === 100) return daysAgo(20);
      if (issueNum === 200) return daysAgo(5);
      if (issueNum === 300) return null;
      return null;
    });

    const deleteFile = vi.fn();
    const logger = vi.fn();

    const deleted = await runPerIssueScenarioSweep({
      now: NOW,
      listFeatures: () => [staleFile, freshFile, unmergedFile],
      getMergedAt,
      deleteFile,
      log: logger,
    });

    expect(deleted).toEqual([staleFile]);
    expect(deleteFile).toHaveBeenCalledOnce();
    expect(deleteFile).toHaveBeenCalledWith(staleFile);
  });

  it('returns the deleted-paths list', async () => {
    const staleFile = 'features/per-issue/feature-42.feature';

    const deleted = await runPerIssueScenarioSweep({
      now: NOW,
      listFeatures: () => [staleFile],
      getMergedAt: async () => daysAgo(20),
      deleteFile: vi.fn(),
      log: vi.fn(),
    });

    expect(deleted).toEqual([staleFile]);
  });

  it('getMergedAt rejection does not delete that file and does not abort others', async () => {
    const failFile = 'features/per-issue/feature-10.feature';
    const staleFile = 'features/per-issue/feature-11.feature';

    const getMergedAt = vi.fn(async (issueNum: number): Promise<Date | null> => {
      if (issueNum === 10) throw new Error('github timeout');
      return daysAgo(20);
    });

    const deleteFile = vi.fn();
    const logger = vi.fn();

    const deleted = await runPerIssueScenarioSweep({
      now: NOW,
      listFeatures: () => [failFile, staleFile],
      getMergedAt,
      deleteFile,
      log: logger,
    });

    expect(deleted).toEqual([staleFile]);
    expect(deleteFile).not.toHaveBeenCalledWith(failFile);
    expect(deleteFile).toHaveBeenCalledWith(staleFile);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('getMergedAt failed'), 'warn');
  });

  it('skips files whose names do not match the feature-{N}.feature pattern', async () => {
    const badFile = 'features/per-issue/README.md';
    const getMergedAt = vi.fn();
    const deleteFile = vi.fn();
    const logger = vi.fn();

    await runPerIssueScenarioSweep({
      now: NOW,
      listFeatures: () => [badFile],
      getMergedAt,
      deleteFile,
      log: logger,
    });

    expect(getMergedAt).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('skipping unrecognised filename'), 'warn');
  });
});
