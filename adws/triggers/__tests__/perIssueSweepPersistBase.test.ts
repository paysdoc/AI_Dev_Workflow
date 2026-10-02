import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

import {
  prepareSweepBase,
  cleanupSweepBase,
  SWEEP_BRANCH,
  PER_ISSUE_SWEEP_SPEC,
  type SweepBase,
  type SweepPersistSpec,
} from '../perIssueSweepPersist';
import { makeFakeGitContext, makeFakeCodeHost, makeFakeBoundary } from './fixtures/perIssueSweepPersistHarness';

describe('prepareSweepBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a SweepBase off a dedicated worktree created from the code host\'s default branch', () => {
    const mockCtx = makeFakeGitContext();
    const codeHost = makeFakeCodeHost({ getDefaultBranch: vi.fn(() => 'dev') });

    const base = prepareSweepBase(makeFakeBoundary(mockCtx, codeHost));

    expect(base).not.toBeNull();
    expect(codeHost.getDefaultBranch).toHaveBeenCalledTimes(1);
    expect(mockCtx.createWorktreeForNewBranch).toHaveBeenCalledWith(SWEEP_BRANCH, 'dev');
    expect(base?.defaultBranch).toBe('dev');
    expect(base?.sweepBranch).toBe(SWEEP_BRANCH);
    expect(base?.worktreePath).toBe('/repo/.worktrees/chore-scenario-sweep');
  });

  it('best-effort cleans a stale prior sweep worktree before creating a fresh one', () => {
    const mockCtx = makeFakeGitContext();

    prepareSweepBase(makeFakeBoundary(mockCtx));

    expect(mockCtx.removeWorktree).toHaveBeenCalledWith(SWEEP_BRANCH);
  });

  it('a throwing removeWorktree pre-clean does not abort base preparation', () => {
    const mockCtx = makeFakeGitContext({ removeWorktree: vi.fn(() => { throw new Error('nothing to remove'); }) });

    const base = prepareSweepBase(makeFakeBoundary(mockCtx));

    expect(base).not.toBeNull();
    expect(mockCtx.createWorktreeForNewBranch).toHaveBeenCalled();
  });

  it('returns null when worktree creation fails (degrades to a no-op sweep, never throws)', () => {
    const mockCtx = makeFakeGitContext({
      createWorktreeForNewBranch: vi.fn(() => { throw new Error('git worktree add failed'); }),
    });

    expect(prepareSweepBase(makeFakeBoundary(mockCtx))).toBeNull();
  });

  it('findOpenSweepPr resolves an OPEN PR number via codeHost.findPullRequestByBranch', () => {
    const mockCtx = makeFakeGitContext();
    const codeHost = makeFakeCodeHost({
      findPullRequestByBranch: vi.fn(() => ({ number: 12, state: 'OPEN', sourceBranch: SWEEP_BRANCH, targetBranch: 'dev', labels: [] })),
    });

    const base = prepareSweepBase(makeFakeBoundary(mockCtx, codeHost));

    expect(base?.findOpenSweepPr(SWEEP_BRANCH)).toBe(12);
  });

  it('findOpenSweepPr returns null when the found PR is not open', () => {
    const mockCtx = makeFakeGitContext();
    const codeHost = makeFakeCodeHost({
      findPullRequestByBranch: vi.fn(() => ({ number: 12, state: 'MERGED', sourceBranch: SWEEP_BRANCH, targetBranch: 'dev', labels: [] })),
    });

    const base = prepareSweepBase(makeFakeBoundary(mockCtx, codeHost));

    expect(base?.findOpenSweepPr(SWEEP_BRANCH)).toBeNull();
  });

  it('findOpenSweepPr returns null when no PR is found for the branch', () => {
    const mockCtx = makeFakeGitContext();
    const codeHost = makeFakeCodeHost({ findPullRequestByBranch: vi.fn(() => null) });

    const base = prepareSweepBase(makeFakeBoundary(mockCtx, codeHost));

    expect(base?.findOpenSweepPr(SWEEP_BRANCH)).toBeNull();
  });

  it('openPr delegates to codeHost.createPullRequest with the sweep head/base branches and returns the PR number', () => {
    const mockCtx = makeFakeGitContext();
    const codeHost = makeFakeCodeHost({
      createPullRequest: vi.fn(() => ({ url: 'https://github.com/test-owner/test-repo/pull/99', number: 99 })),
    });

    const base = prepareSweepBase(makeFakeBoundary(mockCtx, codeHost));
    const prNumber = base?.openPr(SWEEP_BRANCH, 'dev');

    expect(codeHost.createPullRequest).toHaveBeenCalledWith(expect.objectContaining({ sourceBranch: SWEEP_BRANCH, targetBranch: 'dev' }));
    expect(prNumber).toBe(99);
  });

  it('mergePr delegates to codeHost.mergePullRequest', () => {
    const mockCtx = makeFakeGitContext({ owner: 'other-owner', repo: 'other-repo' });
    const codeHost = makeFakeCodeHost({ mergePullRequest: vi.fn(() => ({ success: true })) });

    const base = prepareSweepBase(makeFakeBoundary(mockCtx, codeHost));
    const result = base?.mergePr(99);

    expect(codeHost.mergePullRequest).toHaveBeenCalledWith(99);
    expect(result).toEqual({ success: true });
  });
});

describe('prepareSweepBase — custom spec', () => {
  it('uses the given spec\'s branch for worktree creation and PR title for openPr', () => {
    const customSpec: SweepPersistSpec = {
      branch: 'chore/docs-index-sweep',
      prTitle: 'chore: docs-index sweep',
      prBody: 'Automated docs-index repair.',
    };
    const mockCtx = makeFakeGitContext({ createWorktreeForNewBranch: vi.fn(() => '/repo/.worktrees/chore-docs-index-sweep') });
    const codeHost = makeFakeCodeHost({ getDefaultBranch: vi.fn(() => 'dev') });

    const base = prepareSweepBase(makeFakeBoundary(mockCtx, codeHost), customSpec);

    expect(mockCtx.removeWorktree).toHaveBeenCalledWith('chore/docs-index-sweep');
    expect(mockCtx.createWorktreeForNewBranch).toHaveBeenCalledWith('chore/docs-index-sweep', 'dev');
    expect(base?.sweepBranch).toBe('chore/docs-index-sweep');

    base?.openPr('chore/docs-index-sweep', 'dev');
    expect(codeHost.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'chore: docs-index sweep', body: 'Automated docs-index repair.' }),
    );
  });

  it('defaults to PER_ISSUE_SWEEP_SPEC when no spec is given', () => {
    const mockCtx = makeFakeGitContext();

    const base = prepareSweepBase(makeFakeBoundary(mockCtx));

    expect(base?.sweepBranch).toBe(PER_ISSUE_SWEEP_SPEC.branch);
  });
});

describe('cleanupSweepBase', () => {
  function makeFakeCleanupBase(overrides: Record<string, unknown> = {}, baseOverrides: Partial<SweepBase> = {}) {
    return {
      ctx: {
        deleteRemoteBranch: vi.fn(() => true),
        removeWorktree: vi.fn(() => true),
        ...overrides,
      },
      sweepBranch: SWEEP_BRANCH,
      ...baseOverrides,
    } as unknown as SweepBase;
  }

  it('deletes the remote sweep branch and removes the local worktree', () => {
    const base = makeFakeCleanupBase();

    cleanupSweepBase(base);

    expect(base.ctx.deleteRemoteBranch).toHaveBeenCalledWith(SWEEP_BRANCH);
    expect(base.ctx.removeWorktree).toHaveBeenCalledWith(SWEEP_BRANCH);
  });

  it('a throwing deleteRemoteBranch does not prevent worktree removal (best-effort, never throws)', () => {
    const base = makeFakeCleanupBase({ deleteRemoteBranch: vi.fn(() => { throw new Error('branch gone'); }) });

    expect(() => cleanupSweepBase(base)).not.toThrow();
    expect(base.ctx.removeWorktree).toHaveBeenCalledWith(SWEEP_BRANCH);
  });

  it('a throwing removeWorktree never escapes (best-effort)', () => {
    const base = makeFakeCleanupBase({ removeWorktree: vi.fn(() => { throw new Error('worktree busy'); }) });

    expect(() => cleanupSweepBase(base)).not.toThrow();
  });

  it('leaves the remote branch and the worktree alone when the sweep branch is the default branch', () => {
    const base = makeFakeCleanupBase({}, { defaultBranch: SWEEP_BRANCH });

    cleanupSweepBase(base);

    expect(base.ctx.deleteRemoteBranch).not.toHaveBeenCalled();
    expect(base.ctx.removeWorktree).not.toHaveBeenCalled();
  });

  it('tears the sweep branch down when the default branch is another branch', () => {
    const base = makeFakeCleanupBase({}, { defaultBranch: 'trunk' });

    cleanupSweepBase(base);

    expect(base.ctx.deleteRemoteBranch).toHaveBeenCalledWith(SWEEP_BRANCH);
    expect(base.ctx.removeWorktree).toHaveBeenCalledWith(SWEEP_BRANCH);
  });
});
