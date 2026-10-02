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

import { makeDefaultDeps, PROMOTION_SWEEP_SPEC } from '../promotionSweepDefaults';
import type { MarkerWrite } from '../promotionSweepDefaults';
import { DOCS_INDEX_SWEEP_SPEC } from '../docsIndexSweepDefaults';
import { PER_ISSUE_SWEEP_SPEC } from '../perIssueSweepPersist';
import type { SweepBase } from '../perIssueSweepPersist';
import { computeThreshold } from '../../promotion';
import { loadProjectConfig } from '../../core';
import { readFileSync, writeFileSync } from 'fs';
import type { GitContext } from '@paysdoc/devplatform/git';
import type { LaunchBoundary } from '../../core';
import type { IssueTracker, CodeHost, RepoIdentifier } from '@paysdoc/devplatform';
import { Platform } from '@paysdoc/devplatform';

const PER_ISSUE_DIR = 'features/per-issue';
const STEP_DEF_DIR = 'features/per-issue/step_definitions';
const HOST_CHECKOUT = '/host-checkout';
const SWEEP_WORKTREE = '/sweep-worktree';
const NOW = new Date('2026-10-02T12:00:00Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function makeFakeGitContext(overrides: Record<string, unknown> = {}): GitContext {
  return {
    owner: 'test-owner',
    repo: 'test-repo',
    basePath: HOST_CHECKOUT,
    lsFiles: vi.fn(() => []),
    logSince: vi.fn(() => ''),
    getCurrentBranch: vi.fn(() => 'main'),
    addAndCommitPaths: vi.fn(() => true),
    pushBranch: vi.fn(),
    ...overrides,
  } as unknown as GitContext;
}

function makeFakeIssueTracker(overrides: Record<string, unknown> = {}): IssueTracker {
  return {
    listIssues: vi.fn(() => []),
    createIssue: vi.fn(() => 501),
    applyLabel: vi.fn(),
    ...overrides,
  } as unknown as IssueTracker;
}

function makeFakeCodeHost(overrides: Record<string, unknown> = {}): CodeHost {
  return {
    getDefaultBranch: vi.fn(() => 'dev'),
    listMergedPullRequests: vi.fn(() => []),
    ...overrides,
  } as unknown as CodeHost;
}

function makeFakeBoundary(
  gitContext: GitContext,
  issueTracker: IssueTracker = makeFakeIssueTracker(),
  codeHost: CodeHost = makeFakeCodeHost(),
): LaunchBoundary {
  const repoId: RepoIdentifier = { owner: gitContext.owner, repo: gitContext.repo, platform: Platform.GitHub };
  return { gitContext, repoId, providers: { issueTracker, codeHost } } as LaunchBoundary;
}

function makeFakeBase(ctx: GitContext, overrides: Partial<SweepBase> = {}): SweepBase {
  return {
    ctx,
    codeHost: makeFakeCodeHost(),
    defaultBranch: 'dev',
    sweepBranch: 'chore/promotion-sweep',
    worktreePath: SWEEP_WORKTREE,
    findOpenSweepPr: vi.fn(() => null),
    openPr: vi.fn(() => 42),
    mergePr: vi.fn(() => ({ success: true })),
    log: vi.fn(),
    ...overrides,
  };
}

/** Builds the defaults over a sweep base wrapping `ctx` (or over no base when `withBase` is false). */
function defaultsFor(
  ctx: GitContext,
  options: { issueTracker?: IssueTracker; codeHost?: CodeHost; withBase?: boolean; base?: SweepBase } = {},
) {
  const base = options.withBase === false ? null : (options.base ?? makeFakeBase(ctx));
  return makeDefaultDeps(makeFakeBoundary(ctx, options.issueTracker, options.codeHost), () => base);
}

function featureWithScenarioAdditions(count: number): string {
  const header = `diff --git a/${PER_ISSUE_DIR}/feature-611.feature b/${PER_ISSUE_DIR}/feature-611.feature`;
  return [header, ...Array.from({ length: count }, (_, i) => `+  Scenario: added ${i + 1}`)].join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PROMOTION_SWEEP_SPEC', () => {
  it('uses a dedicated branch distinct from the per-issue and docs-index sweeps', () => {
    expect(PROMOTION_SWEEP_SPEC.branch).toBe('chore/promotion-sweep');
    expect(PROMOTION_SWEEP_SPEC.branch).not.toBe(PER_ISSUE_SWEEP_SPEC.branch);
    expect(PROMOTION_SWEEP_SPEC.branch).not.toBe(DOCS_INDEX_SWEEP_SPEC.branch);
  });

  it('describes the marker change in its pull request copy without a closing keyword', () => {
    expect(PROMOTION_SWEEP_SPEC.prTitle).toContain('promotion');
    expect(PROMOTION_SWEEP_SPEC.prBody).toContain('@promotion-suggested-');
    expect(PROMOTION_SWEEP_SPEC.prBody).toContain('@promotion-declined');
    expect(PROMOTION_SWEEP_SPEC.prBody).not.toMatch(/(Closes|Implements) /);
  });
});

describe('listPerIssueFeatures', () => {
  it('lists feature-{N}.feature files from the sweep worktree, never the host checkout', () => {
    const ctx = makeFakeGitContext({
      lsFiles: vi.fn(() => ['features/per-issue/feature-611.feature', 'features/per-issue/README.md']),
    });

    const result = defaultsFor(ctx).listPerIssueFeatures();

    expect(result).toEqual(['features/per-issue/feature-611.feature']);
    expect(ctx.lsFiles).toHaveBeenCalledWith(SWEEP_WORKTREE, PER_ISSUE_DIR);
    expect(ctx.lsFiles).not.toHaveBeenCalledWith(HOST_CHECKOUT, expect.anything());
  });

  it('degrades to [] when ctx.lsFiles throws', () => {
    const ctx = makeFakeGitContext({ lsFiles: vi.fn(() => { throw new Error('git ls-files failed'); }) });

    expect(defaultsFor(ctx).listPerIssueFeatures()).toEqual([]);
  });

  it('degrades to [] without a sweep base and lists nothing', () => {
    const ctx = makeFakeGitContext();

    expect(defaultsFor(ctx, { withBase: false }).listPerIssueFeatures()).toEqual([]);
    expect(ctx.lsFiles).not.toHaveBeenCalled();
  });
});

describe('readFeatureContent', () => {
  it('reads the file from the sweep worktree, never the host checkout', () => {
    vi.mocked(readFileSync).mockReturnValue('Feature: fixture\n');

    const content = defaultsFor(makeFakeGitContext()).readFeatureContent('features/per-issue/feature-611.feature');

    expect(content).toBe('Feature: fixture\n');
    expect(readFileSync).toHaveBeenCalledWith(`${SWEEP_WORKTREE}/features/per-issue/feature-611.feature`, 'utf-8');
  });

  it('degrades to null when readFileSync throws', () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });

    expect(defaultsFor(makeFakeGitContext()).readFeatureContent('features/per-issue/feature-611.feature')).toBeNull();
  });

  it('degrades to null without a sweep base and reads nothing', () => {
    expect(defaultsFor(makeFakeGitContext(), { withBase: false }).readFeatureContent('features/per-issue/feature-611.feature')).toBeNull();
    expect(readFileSync).not.toHaveBeenCalled();
  });
});

describe('listStepDefSiblings', () => {
  it('lists step-def siblings for the given feature number from the sweep worktree', () => {
    const ctx = makeFakeGitContext({
      lsFiles: vi.fn(() => ['features/per-issue/step_definitions/feature-611.steps.ts', 'features/per-issue/step_definitions/feature-612.steps.ts']),
    });

    expect(defaultsFor(ctx).listStepDefSiblings(611)).toEqual(['features/per-issue/step_definitions/feature-611.steps.ts']);
    expect(ctx.lsFiles).toHaveBeenCalledWith(SWEEP_WORKTREE, STEP_DEF_DIR);
  });

  it('degrades to [] when ctx.lsFiles throws', () => {
    const ctx = makeFakeGitContext({ lsFiles: vi.fn(() => { throw new Error('boom'); }) });

    expect(defaultsFor(ctx).listStepDefSiblings(611)).toEqual([]);
  });

  it('degrades to [] without a sweep base', () => {
    expect(defaultsFor(makeFakeGitContext(), { withBase: false }).listStepDefSiblings(611)).toEqual([]);
  });
});

describe('scenariosConfig', () => {
  it('reads scenario paths via loadProjectConfig(<sweep worktree>), falling back to defaults for unset fields', () => {
    vi.mocked(loadProjectConfig).mockReturnValue({
      scenarios: { perIssueScenarioDirectory: 'custom/per-issue' },
    } as unknown as ReturnType<typeof loadProjectConfig>);

    const result = defaultsFor(makeFakeGitContext()).scenariosConfig();

    expect(loadProjectConfig).toHaveBeenCalledWith(SWEEP_WORKTREE);
    expect(result).toEqual({
      perIssueDir: 'custom/per-issue',
      regressionDir: 'features/regression/',
      vocabPath: 'features/regression/vocabulary.md',
    });
  });

  it('degrades to hardcoded defaults when loadProjectConfig throws', () => {
    vi.mocked(loadProjectConfig).mockImplementation(() => { throw new Error('boom'); });

    expect(defaultsFor(makeFakeGitContext()).scenariosConfig()).toEqual({
      perIssueDir: 'features/per-issue',
      regressionDir: 'features/regression/',
      vocabPath: 'features/regression/vocabulary.md',
    });
  });

  it('degrades to hardcoded defaults without a sweep base and loads no config', () => {
    expect(defaultsFor(makeFakeGitContext(), { withBase: false }).scenariosConfig()).toEqual({
      perIssueDir: 'features/per-issue',
      regressionDir: 'features/regression/',
      vocabPath: 'features/regression/vocabulary.md',
    });
    expect(loadProjectConfig).not.toHaveBeenCalled();
  });
});

describe('loadVocabulary', () => {
  it('reads the vocabulary file from the sweep worktree', () => {
    vi.mocked(readFileSync).mockReturnValue('## Given\n');

    const vocab = defaultsFor(makeFakeGitContext()).loadVocabulary('features/regression/vocabulary.md');

    expect(vocab).toBe('## Given\n');
    expect(readFileSync).toHaveBeenCalledWith(`${SWEEP_WORKTREE}/features/regression/vocabulary.md`, 'utf-8');
  });

  it('degrades to "" when readFileSync throws', () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });

    expect(defaultsFor(makeFakeGitContext()).loadVocabulary('features/regression/vocabulary.md')).toBe('');
  });

  it('degrades to "" without a sweep base', () => {
    expect(defaultsFor(makeFakeGitContext(), { withBase: false }).loadVocabulary('features/regression/vocabulary.md')).toBe('');
  });
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

describe('persistMarkers', () => {
  const writes: readonly MarkerWrite[] = [
    { filePath: 'features/per-issue/feature-611.feature', content: 'tagged 611', message: 'chore: mark feature-611 promotion-suggested' },
    { filePath: 'features/per-issue/feature-612.feature', content: 'declined 612', message: 'chore: mark feature-612 promotion-declined' },
  ];

  it('writes every marker into the sweep worktree and commits each file on its own', async () => {
    const ctx = makeFakeGitContext();

    await defaultsFor(ctx).persistMarkers(writes);

    expect(writeFileSync).toHaveBeenCalledTimes(2);
    expect(writeFileSync).toHaveBeenCalledWith(`${SWEEP_WORKTREE}/features/per-issue/feature-611.feature`, 'tagged 611');
    expect(writeFileSync).toHaveBeenCalledWith(`${SWEEP_WORKTREE}/features/per-issue/feature-612.feature`, 'declined 612');
    expect(ctx.addAndCommitPaths).toHaveBeenCalledTimes(2);
    expect(ctx.addAndCommitPaths).toHaveBeenCalledWith(
      ['features/per-issue/feature-611.feature'], 'chore: mark feature-611 promotion-suggested', SWEEP_WORKTREE,
    );
    expect(ctx.addAndCommitPaths).toHaveBeenCalledWith(
      ['features/per-issue/feature-612.feature'], 'chore: mark feature-612 promotion-declined', SWEEP_WORKTREE,
    );
  });

  it('pushes the sweep branch once, opens one pull request into the default branch, merges it and resolves true', async () => {
    const ctx = makeFakeGitContext();
    const base = makeFakeBase(ctx);

    const landed = await defaultsFor(ctx, { base }).persistMarkers(writes);

    expect(landed).toBe(true);
    expect(ctx.pushBranch).toHaveBeenCalledTimes(1);
    expect(ctx.pushBranch).toHaveBeenCalledWith('chore/promotion-sweep', SWEEP_WORKTREE);
    expect(base.openPr).toHaveBeenCalledTimes(1);
    expect(base.openPr).toHaveBeenCalledWith('chore/promotion-sweep', 'dev');
    expect(base.mergePr).toHaveBeenCalledWith(42);
  });

  it('never pushes the default branch and never touches the host checkout', async () => {
    const ctx = makeFakeGitContext();

    await defaultsFor(ctx).persistMarkers(writes);

    expect(ctx.pushBranch).not.toHaveBeenCalledWith('dev', expect.anything());
    expect(ctx.pushBranch).not.toHaveBeenCalledWith(expect.anything(), HOST_CHECKOUT);
    expect(ctx.addAndCommitPaths).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), HOST_CHECKOUT);
    expect(vi.mocked(writeFileSync).mock.calls.every(([target]) => String(target).startsWith(SWEEP_WORKTREE))).toBe(true);
  });

  it('resolves false when the pull request cannot be merged', async () => {
    const ctx = makeFakeGitContext();
    const base = makeFakeBase(ctx, { mergePr: vi.fn(() => ({ success: false, error: 'merge refused' })) });

    await expect(defaultsFor(ctx, { base }).persistMarkers(writes)).resolves.toBe(false);
  });

  it('resolves false without pushing when no write changes the files', async () => {
    const ctx = makeFakeGitContext({ addAndCommitPaths: vi.fn(() => false) });

    await expect(defaultsFor(ctx).persistMarkers(writes)).resolves.toBe(false);
    expect(ctx.pushBranch).not.toHaveBeenCalled();
  });

  it('still lands the batch when only some of the writes change a file', async () => {
    const ctx = makeFakeGitContext({ addAndCommitPaths: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true) });

    await expect(defaultsFor(ctx).persistMarkers(writes)).resolves.toBe(true);
    expect(ctx.addAndCommitPaths).toHaveBeenCalledTimes(2);
  });

  it('resolves false and writes nothing without a sweep base', async () => {
    const ctx = makeFakeGitContext();

    await expect(defaultsFor(ctx, { withBase: false }).persistMarkers(writes)).resolves.toBe(false);
    expect(writeFileSync).not.toHaveBeenCalled();
    expect(ctx.addAndCommitPaths).not.toHaveBeenCalled();
  });
});

describe('fileIssue', () => {
  it('creates the issue and applies every label via the injected issue tracker', () => {
    const issueTracker = makeFakeIssueTracker({ createIssue: vi.fn(() => 501) });
    const ctx = makeFakeGitContext({ owner: 'vestmatic', repo: 'vestmatic-research' });

    defaultsFor(ctx, { issueTracker }).fileIssue({
      title: 'Promote feature-611',
      body: 'Promotes: feature-611',
      labels: ['regression-promotion', 'hitl'],
    });

    expect(issueTracker.createIssue).toHaveBeenCalledWith('Promote feature-611', 'Promotes: feature-611');
    expect(issueTracker.applyLabel).toHaveBeenCalledWith(501, 'regression-promotion');
    expect(issueTracker.applyLabel).toHaveBeenCalledWith(501, 'hitl');
  });

  it('propagates a throw from issueTracker.createIssue (no per-candidate swallow here — the shell catches it)', () => {
    const issueTracker = makeFakeIssueTracker({ createIssue: vi.fn(() => { throw new Error('gh: issue create failed'); }) });

    expect(() => defaultsFor(makeFakeGitContext(), { issueTracker }).fileIssue({ title: 't', body: 'b', labels: [] })).toThrow();
  });
});
