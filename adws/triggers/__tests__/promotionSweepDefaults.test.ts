import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

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

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { makeDefaultDeps } from '../promotionSweepDefaults';
import { log, loadProjectConfig } from '../../core';
import { readFileSync, writeFileSync } from 'fs';
import type { GitContext } from '../../gitContext';
import type { LaunchBoundary } from '../../core';
import type { IssueTracker, CodeHost, RepoIdentifier } from '../../providers/types';
import { Platform } from '../../providers/types';

const PER_ISSUE_DIR = 'features/per-issue';
const STEP_DEF_DIR = 'features/per-issue/step_definitions';

function makeFakeGitContext(overrides: Record<string, unknown> = {}): GitContext {
  return {
    owner: 'test-owner',
    repo: 'test-repo',
    basePath: '/repo',
    lsFiles: vi.fn(() => []),
    logSince: vi.fn(() => ''),
    getCurrentBranch: vi.fn(() => 'dev'),
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

beforeEach(() => {
  vi.clearAllMocks();
});

// ── listPerIssueFeatures ─────────────────────────────────────────────────────

describe('listPerIssueFeatures', () => {
  it('lists feature-{N}.feature files under the injected context basePath', () => {
    const ctx = makeFakeGitContext({
      basePath: '/target-repo',
      lsFiles: vi.fn((base: string, prefix?: string) => {
        expect(base).toBe('/target-repo');
        expect(prefix).toBe(PER_ISSUE_DIR);
        return ['features/per-issue/feature-611.feature', 'features/per-issue/README.md'];
      }),
    });

    const result = makeDefaultDeps(makeFakeBoundary(ctx)).listPerIssueFeatures();

    expect(result).toEqual(['features/per-issue/feature-611.feature']);
  });

  it('degrades to [] when ctx.lsFiles throws', () => {
    const ctx = makeFakeGitContext({ lsFiles: vi.fn(() => { throw new Error('git ls-files failed'); }) });

    expect(makeDefaultDeps(makeFakeBoundary(ctx)).listPerIssueFeatures()).toEqual([]);
  });
});

// ── readFeatureContent ───────────────────────────────────────────────────────

describe('readFeatureContent', () => {
  it('reads the file from the injected context basePath', () => {
    const ctx = makeFakeGitContext({ basePath: '/target-repo' });
    vi.mocked(readFileSync).mockReturnValue('Feature: fixture\n');

    const content = makeDefaultDeps(makeFakeBoundary(ctx)).readFeatureContent('features/per-issue/feature-611.feature');

    expect(content).toBe('Feature: fixture\n');
    expect(readFileSync).toHaveBeenCalledWith('/target-repo/features/per-issue/feature-611.feature', 'utf-8');
  });

  it('degrades to null when readFileSync throws', () => {
    const ctx = makeFakeGitContext();
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });

    expect(makeDefaultDeps(makeFakeBoundary(ctx)).readFeatureContent('features/per-issue/feature-611.feature')).toBeNull();
  });
});

// ── listStepDefSiblings ──────────────────────────────────────────────────────

describe('listStepDefSiblings', () => {
  it('lists step-def siblings for the given feature number under the injected context basePath', () => {
    const ctx = makeFakeGitContext({
      basePath: '/target-repo',
      lsFiles: vi.fn((base: string, prefix?: string) => {
        expect(base).toBe('/target-repo');
        expect(prefix).toBe(STEP_DEF_DIR);
        return ['features/per-issue/step_definitions/feature-611.steps.ts', 'features/per-issue/step_definitions/feature-612.steps.ts'];
      }),
    });

    expect(makeDefaultDeps(makeFakeBoundary(ctx)).listStepDefSiblings(611)).toEqual(['features/per-issue/step_definitions/feature-611.steps.ts']);
  });

  it('degrades to [] when ctx.lsFiles throws', () => {
    const ctx = makeFakeGitContext({ lsFiles: vi.fn(() => { throw new Error('boom'); }) });

    expect(makeDefaultDeps(makeFakeBoundary(ctx)).listStepDefSiblings(611)).toEqual([]);
  });
});

// ── scenariosConfig ──────────────────────────────────────────────────────────

describe('scenariosConfig', () => {
  it('reads scenario paths via loadProjectConfig(ctx.basePath), falling back to defaults for unset fields', () => {
    const ctx = makeFakeGitContext({ basePath: '/target-repo' });
    vi.mocked(loadProjectConfig).mockReturnValue({
      scenarios: { perIssueScenarioDirectory: 'custom/per-issue' },
    } as unknown as ReturnType<typeof loadProjectConfig>);

    const result = makeDefaultDeps(makeFakeBoundary(ctx)).scenariosConfig();

    expect(loadProjectConfig).toHaveBeenCalledWith('/target-repo');
    expect(result).toEqual({
      perIssueDir: 'custom/per-issue',
      regressionDir: 'features/regression/',
      vocabPath: 'features/regression/vocabulary.md',
    });
  });

  it('degrades to hardcoded defaults when loadProjectConfig throws', () => {
    const ctx = makeFakeGitContext();
    vi.mocked(loadProjectConfig).mockImplementation(() => { throw new Error('boom'); });

    expect(makeDefaultDeps(makeFakeBoundary(ctx)).scenariosConfig()).toEqual({
      perIssueDir: 'features/per-issue',
      regressionDir: 'features/regression/',
      vocabPath: 'features/regression/vocabulary.md',
    });
  });
});

// ── loadVocabulary ───────────────────────────────────────────────────────────

describe('loadVocabulary', () => {
  it('reads the vocabulary file from the injected context basePath', () => {
    const ctx = makeFakeGitContext({ basePath: '/target-repo' });
    vi.mocked(readFileSync).mockReturnValue('## Given\n');

    const vocab = makeDefaultDeps(makeFakeBoundary(ctx)).loadVocabulary('features/regression/vocabulary.md');

    expect(vocab).toBe('## Given\n');
    expect(readFileSync).toHaveBeenCalledWith('/target-repo/features/regression/vocabulary.md', 'utf-8');
  });

  it('degrades to "" when readFileSync throws', () => {
    const ctx = makeFakeGitContext();
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });

    expect(makeDefaultDeps(makeFakeBoundary(ctx)).loadVocabulary('features/regression/vocabulary.md')).toBe('');
  });
});

// ── loadStats ────────────────────────────────────────────────────────────────

describe('loadStats', () => {
  it('routes the numerator/denominator queries through the injected context (ctx.logSince)', () => {
    const ctx = makeFakeGitContext({
      logSince: vi.fn((opts: { grep?: string; patch?: boolean }) => {
        if (opts.grep) return 'abc123 regression-promotion: feature-1\ndef456 regression-promotion: feature-2\n';
        if (opts.patch) return '+ Scenario: one\n+ Scenario: two\n+ Scenario: three\n';
        return '';
      }),
    });

    const stats = makeDefaultDeps(makeFakeBoundary(ctx)).loadStats();

    expect(ctx.logSince).toHaveBeenCalled();
    expect(stats).toEqual({ promotedCount90d: 2, totalPerIssueCount90d: 3 });
  });

  it('degrades to zero-stats when ctx.logSince throws (fail-safe, not a crash)', () => {
    const ctx = makeFakeGitContext({ logSince: vi.fn(() => { throw new Error('gh error'); }) });

    expect(makeDefaultDeps(makeFakeBoundary(ctx)).loadStats()).toEqual({ promotedCount90d: 0, totalPerIssueCount90d: 0 });
  });
});

// ── listPromotionIssues ──────────────────────────────────────────────────────

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
    const ctx = makeFakeGitContext();

    expect(makeDefaultDeps(makeFakeBoundary(ctx, issueTracker)).listPromotionIssues()).toEqual(issues);
  });

  it('degrades to [] when issueTracker.listIssues throws', () => {
    const issueTracker = makeFakeIssueTracker({ listIssues: vi.fn(() => { throw new Error('gh error'); }) });
    const ctx = makeFakeGitContext();

    expect(makeDefaultDeps(makeFakeBoundary(ctx, issueTracker)).listPromotionIssues()).toEqual([]);
  });
});

// ── tagAndCommit ─────────────────────────────────────────────────────────────

describe('tagAndCommit', () => {
  it('writes, commits (scoped to filePath), and pushes when the checkout is on the default branch', () => {
    const ctx = makeFakeGitContext({ basePath: '/target-repo', getCurrentBranch: vi.fn(() => 'dev') });
    const codeHost = makeFakeCodeHost({ getDefaultBranch: vi.fn(() => 'dev') });

    makeDefaultDeps(makeFakeBoundary(ctx, undefined, codeHost)).tagAndCommit('features/per-issue/feature-611.feature', 'tagged content', 'chore: tag');

    expect(writeFileSync).toHaveBeenCalledWith('/target-repo/features/per-issue/feature-611.feature', 'tagged content');
    expect(ctx.addAndCommitPaths).toHaveBeenCalledWith(['features/per-issue/feature-611.feature'], 'chore: tag', '/target-repo');
    expect(ctx.pushBranch).toHaveBeenCalledWith('dev', '/target-repo');
  });

  it('no-ops with a warning and does not write when the checkout is not on the default branch', () => {
    const ctx = makeFakeGitContext({ getCurrentBranch: vi.fn(() => 'feature-branch') });
    const codeHost = makeFakeCodeHost({ getDefaultBranch: vi.fn(() => 'dev') });

    makeDefaultDeps(makeFakeBoundary(ctx, undefined, codeHost)).tagAndCommit('features/per-issue/feature-611.feature', 'tagged content', 'chore: tag');

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(ctx.addAndCommitPaths).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not on default branch'), 'warn');
  });

  it('does not push when addAndCommitPaths reports nothing was committed', () => {
    const ctx = makeFakeGitContext({ addAndCommitPaths: vi.fn(() => false) });

    makeDefaultDeps(makeFakeBoundary(ctx)).tagAndCommit('features/per-issue/feature-611.feature', 'tagged content', 'chore: tag');

    expect(ctx.pushBranch).not.toHaveBeenCalled();
  });
});

// ── fileIssue ────────────────────────────────────────────────────────────────

describe('fileIssue', () => {
  it('creates the issue and applies every label via the injected issue tracker', () => {
    const issueTracker = makeFakeIssueTracker({ createIssue: vi.fn(() => 501) });
    const ctx = makeFakeGitContext({ owner: 'vestmatic', repo: 'vestmatic-research' });

    makeDefaultDeps(makeFakeBoundary(ctx, issueTracker)).fileIssue({
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
    const ctx = makeFakeGitContext();

    expect(() => makeDefaultDeps(makeFakeBoundary(ctx, issueTracker)).fileIssue({ title: 't', body: 'b', labels: [] })).toThrow();
  });
});
