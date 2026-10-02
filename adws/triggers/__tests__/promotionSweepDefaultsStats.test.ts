import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    loadProjectConfig: vi.fn(),
  };
});

import { computeThreshold } from '../../promotion';
import {
  defaultsFor, makeFakeGitContext, makeFakeCodeHost, makeFakeIssueTracker, featureWithScenarioAdditions,
  daysAgo, NOW, SWEEP_WORKTREE,
} from './fixtures/promotionSweepDefaultsHarness';

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loadStats', () => {
  const promotionIssues = [
    { number: 900, body: 'Promotes: feature-101', state: 'CLOSED', labels: [] },
    { number: 901, body: 'Promotes: feature-102', state: 'CLOSED', labels: [] },
    { number: 902, body: 'Promotes: feature-103', state: 'CLOSED', labels: [] },
    { number: 903, body: 'Promotes: feature-104', state: 'OPEN', labels: [] },
    { number: 904, body: 'Promotes: feature-105', state: 'CLOSED', labels: [] },
  ];

  const mergedPullRequests = [
    { body: 'Implements #900\n\nCloses test-owner/test-repo#900', mergedAt: daysAgo(10) },
    { body: 'Closes #901', mergedAt: daysAgo(10) },
    { body: 'Closes #903', mergedAt: daysAgo(10) },
    { body: 'An unrelated change with no issue link', mergedAt: daysAgo(3) },
    { body: 'Closes #904', mergedAt: daysAgo(120) },
  ];

  function statsFixture(overrides: { listMergedPullRequests?: () => unknown; patch?: string } = {}) {
    const ctx = makeFakeGitContext({ logSince: vi.fn(() => overrides.patch ?? featureWithScenarioAdditions(8)) });
    const codeHost = makeFakeCodeHost({
      listMergedPullRequests: vi.fn(overrides.listMergedPullRequests ?? (() => mergedPullRequests)),
    });
    const issueTracker = makeFakeIssueTracker({ listIssues: vi.fn(() => promotionIssues) });
    return { ctx, codeHost, issueTracker };
  }

  it('counts closed promotion issues whose pull request merged in the last 90 days, so the threshold rises above 3', () => {
    const { ctx, codeHost, issueTracker } = statsFixture();

    const stats = defaultsFor(ctx, { codeHost, issueTracker }).loadStats();

    expect(stats).toEqual({ promotedCount90d: 2, totalPerIssueCount90d: 8 });
    expect(computeThreshold(stats)).toBe(5);
    expect(codeHost.listMergedPullRequests).toHaveBeenCalledWith(200);
  });

  it('runs the history query in the sweep worktree on the plain per-issue directory, with no commit-subject grep', () => {
    const { ctx, codeHost, issueTracker } = statsFixture();

    defaultsFor(ctx, { codeHost, issueTracker }).loadStats();

    expect(ctx.logSince).toHaveBeenCalledTimes(1);
    expect(ctx.logSince).toHaveBeenCalledWith(
      { since: expect.any(String), patch: true, pathspec: 'features/per-issue' },
      SWEEP_WORKTREE,
    );
    const options = vi.mocked(ctx.logSince).mock.calls.map(([opts]) => opts);
    expect(options.every((opts) => !('grep' in opts) && !('oneline' in opts))).toBe(true);
  });

  it('counts a promotion once even when several merged pull requests link its issue', () => {
    const { ctx, codeHost, issueTracker } = statsFixture({
      listMergedPullRequests: () => [
        { body: 'Closes #900', mergedAt: daysAgo(2) },
        { body: 'Closes #900', mergedAt: daysAgo(30) },
      ],
    });

    expect(defaultsFor(ctx, { codeHost, issueTracker }).loadStats().promotedCount90d).toBe(1);
  });

  it('does not match an issue number inside a longer one', () => {
    const { ctx, codeHost, issueTracker } = statsFixture({
      listMergedPullRequests: () => [{ body: 'Closes #9001', mergedAt: daysAgo(2) }],
    });

    expect(defaultsFor(ctx, { codeHost, issueTracker }).loadStats().promotedCount90d).toBe(0);
  });

  it('ignores a merged pull request whose merge time is unparseable', () => {
    const { ctx, codeHost, issueTracker } = statsFixture({
      listMergedPullRequests: () => [{ body: 'Closes #900', mergedAt: 'not-a-date' }],
    });

    expect(defaultsFor(ctx, { codeHost, issueTracker }).loadStats().promotedCount90d).toBe(0);
  });

  it('counts no promotion when listMergedPullRequests throws, but still counts the scenario additions', () => {
    const { ctx, codeHost, issueTracker } = statsFixture({
      listMergedPullRequests: () => { throw new Error('gh error'); },
    });

    expect(defaultsFor(ctx, { codeHost, issueTracker }).loadStats()).toEqual({ promotedCount90d: 0, totalPerIssueCount90d: 8 });
  });

  it('counts the promotions when the history query throws', () => {
    const { ctx, codeHost, issueTracker } = statsFixture();
    vi.mocked(ctx.logSince).mockImplementation(() => { throw new Error('not a git repository'); });

    expect(defaultsFor(ctx, { codeHost, issueTracker }).loadStats()).toEqual({ promotedCount90d: 2, totalPerIssueCount90d: 0 });
  });

  it('degrades to zero-stats without a sweep base, and never queries the host checkout', () => {
    const { ctx, codeHost, issueTracker } = statsFixture();

    expect(defaultsFor(ctx, { codeHost, issueTracker, withBase: false }).loadStats()).toEqual({ promotedCount90d: 0, totalPerIssueCount90d: 0 });
    expect(ctx.logSince).not.toHaveBeenCalled();
  });
});

describe('listPromotionIssues', () => {
  it('queries open+closed issues labeled regression-promotion through the injected issue tracker', () => {
    const issues = [{ number: 900, body: 'Promotes: feature-611', state: 'OPEN', labels: [] }];
    const issueTracker = makeFakeIssueTracker({
      listIssues: vi.fn((query: { search?: string; state?: string; limit?: number }) => {
        expect(query.state).toBe('all');
        expect(query.search).toContain('regression-promotion');
        expect(query.limit).toBe(200);
        return issues;
      }),
    });

    expect(defaultsFor(makeFakeGitContext(), { issueTracker }).listPromotionIssues()).toEqual(issues);
  });

  it('degrades to [] when issueTracker.listIssues throws', () => {
    const issueTracker = makeFakeIssueTracker({ listIssues: vi.fn(() => { throw new Error('gh error'); }) });

    expect(defaultsFor(makeFakeGitContext(), { issueTracker }).listPromotionIssues()).toEqual([]);
  });
});
