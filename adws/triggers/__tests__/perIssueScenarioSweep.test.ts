import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../../github/gitContextFactory', () => ({
  gitContextForRepo: vi.fn(),
}));

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

vi.mock('../../github', () => ({
  getRepoInfo: vi.fn(() => ({ owner: 'test-owner', repo: 'test-repo' })),
  bodyLinksIssue: vi.fn((body: string, num: number) => body.includes(`#${num}`)),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { isScenarioStale, runPerIssueScenarioSweep, RETENTION_DAYS } from '../perIssueScenarioSweep';
import { gitContextForRepo } from '../../github/gitContextFactory';

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

  it('sweeps both the feature file and its step-def sibling(s) for a stale issue', async () => {
    const staleFile = 'features/per-issue/feature-100.feature';
    const sibling = 'features/per-issue/step_definitions/feature-100.steps.ts';
    const freshFile = 'features/per-issue/feature-200.feature';
    const unmergedFile = 'features/per-issue/feature-300.feature';

    const getMergedAt = vi.fn(async (issueNum: number): Promise<Date | null> => {
      if (issueNum === 100) return daysAgo(20);
      if (issueNum === 200) return daysAgo(5);
      if (issueNum === 300) return null;
      return null;
    });

    const listStepDefSiblings = vi.fn((issueNum: number) => (issueNum === 100 ? [sibling] : []));
    const persistRemoval = vi.fn();
    const logger = vi.fn();

    const removed = await runPerIssueScenarioSweep({
      now: NOW,
      listFeatures: () => [staleFile, freshFile, unmergedFile],
      getMergedAt,
      listStepDefSiblings,
      persistRemoval,
      log: logger,
    });

    expect(removed).toEqual([staleFile, sibling]);
    expect(listStepDefSiblings).toHaveBeenCalledWith(100);
    expect(listStepDefSiblings).not.toHaveBeenCalledWith(200);
    expect(persistRemoval).toHaveBeenCalledOnce();
    expect(persistRemoval).toHaveBeenCalledWith([staleFile, sibling]);
  });

  it('invokes persistRemoval exactly once with the full removal batch (the commit path)', async () => {
    const staleA = 'features/per-issue/feature-101.feature';
    const staleB = 'features/per-issue/feature-102.feature';
    const siblingB = 'features/per-issue/step_definitions/feature-102.steps.ts';

    const persistRemoval = vi.fn();

    const removed = await runPerIssueScenarioSweep({
      now: NOW,
      listFeatures: () => [staleA, staleB],
      getMergedAt: async () => daysAgo(20),
      listStepDefSiblings: (issueNum) => (issueNum === 102 ? [siblingB] : []),
      persistRemoval,
      log: vi.fn(),
    });

    expect(removed).toEqual([staleA, staleB, siblingB]);
    expect(persistRemoval).toHaveBeenCalledOnce();
    expect(persistRemoval).toHaveBeenCalledWith([staleA, staleB, siblingB]);
  });

  it('no-op: does not invoke persistRemoval and returns [] when nothing is stale', async () => {
    const freshFile = 'features/per-issue/feature-200.feature';
    const unmergedFile = 'features/per-issue/feature-300.feature';

    const persistRemoval = vi.fn();
    const listStepDefSiblings = vi.fn();

    const removed = await runPerIssueScenarioSweep({
      now: NOW,
      listFeatures: () => [freshFile, unmergedFile],
      getMergedAt: async (issueNum) => (issueNum === 200 ? daysAgo(5) : null),
      listStepDefSiblings,
      persistRemoval,
      log: vi.fn(),
    });

    expect(removed).toEqual([]);
    expect(persistRemoval).not.toHaveBeenCalled();
    expect(listStepDefSiblings).not.toHaveBeenCalled();
  });

  it('getMergedAt rejection does not sweep that file and does not abort others', async () => {
    const failFile = 'features/per-issue/feature-10.feature';
    const staleFile = 'features/per-issue/feature-11.feature';

    const getMergedAt = vi.fn(async (issueNum: number): Promise<Date | null> => {
      if (issueNum === 10) throw new Error('github timeout');
      return daysAgo(20);
    });

    const persistRemoval = vi.fn();
    const logger = vi.fn();

    const removed = await runPerIssueScenarioSweep({
      now: NOW,
      listFeatures: () => [failFile, staleFile],
      getMergedAt,
      listStepDefSiblings: () => [],
      persistRemoval,
      log: logger,
    });

    expect(removed).toEqual([staleFile]);
    expect(persistRemoval).toHaveBeenCalledWith([staleFile]);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('getMergedAt failed'), 'warn');
  });

  it('default getMergedAt routes through gitContextForRepo.fetchMergedPRs', async () => {
    const mergedPRs = [{ body: 'Closes #55', mergedAt: '2026-01-01T00:00:00Z' }];
    const mockCtx = { fetchMergedPRs: vi.fn(() => JSON.stringify(mergedPRs)) };
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);

    const persistRemoval = vi.fn();

    const removed = await runPerIssueScenarioSweep({
      now: new Date('2026-02-15T00:00:00Z'),
      listFeatures: () => ['features/per-issue/feature-55.feature'],
      listStepDefSiblings: () => [],
      persistRemoval,
      log: vi.fn(),
    });

    expect(gitContextForRepo).toHaveBeenCalled();
    expect(mockCtx.fetchMergedPRs).toHaveBeenCalledWith(200);
    expect(removed).toEqual(['features/per-issue/feature-55.feature']);
  });

  it('default getMergedAt returns null on throw (fail-open)', async () => {
    vi.mocked(gitContextForRepo).mockReturnValue({ fetchMergedPRs: vi.fn(() => { throw new Error('gh error'); }) } as never);
    const persistRemoval = vi.fn();

    await runPerIssueScenarioSweep({
      now: NOW,
      listFeatures: () => ['features/per-issue/feature-99.feature'],
      listStepDefSiblings: () => [],
      persistRemoval,
      log: vi.fn(),
    });

    expect(persistRemoval).not.toHaveBeenCalled();
  });

  it('skips files whose names do not match the feature-{N}.feature pattern', async () => {
    const badFile = 'features/per-issue/README.md';
    const getMergedAt = vi.fn();
    const persistRemoval = vi.fn();
    const logger = vi.fn();

    await runPerIssueScenarioSweep({
      now: NOW,
      listFeatures: () => [badFile],
      getMergedAt,
      listStepDefSiblings: vi.fn(),
      persistRemoval,
      log: logger,
    });

    expect(getMergedAt).not.toHaveBeenCalled();
    expect(persistRemoval).not.toHaveBeenCalled();
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('skipping unrecognised filename'), 'warn');
  });
});

// ── Default wiring — routes through gitContextForRepo ───────────────────────

describe('runPerIssueScenarioSweep — default wiring through gitContextForRepo', () => {
  const PER_ISSUE_DIR = 'features/per-issue';
  const STEP_DEF_DIR = 'features/per-issue/step_definitions';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeMockCtx(overrides: Record<string, unknown> = {}) {
    const featurePath = 'features/per-issue/feature-77.feature';
    const siblingPath = 'features/per-issue/step_definitions/feature-77.steps.ts';
    const mergedPRs = [{ body: 'Closes #77', mergedAt: '2026-01-01T00:00:00Z' }];
    return {
      featurePath,
      siblingPath,
      basePath: '/repo',
      lsFiles: vi.fn((_cwd: string, prefix?: string) => {
        if (prefix === PER_ISSUE_DIR) return [featurePath];
        if (prefix === STEP_DEF_DIR) return [siblingPath];
        return [];
      }),
      fetchMergedPRs: vi.fn(() => JSON.stringify(mergedPRs)),
      defaultBranch: vi.fn(() => 'dev'),
      getCurrentBranch: vi.fn(() => 'dev'),
      removeAndCommitPaths: vi.fn(() => true),
      pushBranch: vi.fn(),
      ...overrides,
    };
  }

  it('lists via lsFiles and persists via removeAndCommitPaths + pushBranch when on the default branch', async () => {
    const mockCtx = makeMockCtx();
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);

    const removed = await runPerIssueScenarioSweep({ now: new Date('2026-02-15T00:00:00Z') });

    expect(mockCtx.lsFiles).toHaveBeenCalledWith(mockCtx.basePath, PER_ISSUE_DIR);
    expect(mockCtx.lsFiles).toHaveBeenCalledWith(mockCtx.basePath, STEP_DEF_DIR);
    expect(removed).toEqual([mockCtx.featurePath, mockCtx.siblingPath]);
    expect(mockCtx.removeAndCommitPaths).toHaveBeenCalledWith(
      [mockCtx.featurePath, mockCtx.siblingPath],
      expect.any(String),
      mockCtx.basePath,
    );
    expect(mockCtx.pushBranch).toHaveBeenCalledWith('dev', mockCtx.basePath);
  });

  it('does not commit or push when the checkout is not on the default branch', async () => {
    const mockCtx = makeMockCtx({ getCurrentBranch: vi.fn(() => 'some-other-branch') });
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);

    await runPerIssueScenarioSweep({ now: new Date('2026-02-15T00:00:00Z') });

    expect(mockCtx.removeAndCommitPaths).not.toHaveBeenCalled();
    expect(mockCtx.pushBranch).not.toHaveBeenCalled();
  });

  it('does not push when removeAndCommitPaths reports nothing was committed', async () => {
    const mockCtx = makeMockCtx({ removeAndCommitPaths: vi.fn(() => false) });
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);

    await runPerIssueScenarioSweep({ now: new Date('2026-02-15T00:00:00Z') });

    expect(mockCtx.removeAndCommitPaths).toHaveBeenCalled();
    expect(mockCtx.pushBranch).not.toHaveBeenCalled();
  });
});
