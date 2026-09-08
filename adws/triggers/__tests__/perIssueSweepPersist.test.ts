import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  persistRemovalViaPr,
  prepareSweepBase,
  cleanupSweepBase,
  SWEEP_BRANCH,
  SWEEP_COMMIT_MESSAGE,
  type SweepBase,
} from '../perIssueSweepPersist';
import type { GitContext } from '../../gitContext';
import type { LaunchBoundary } from '../../core';
import type { CodeHost, RepoIdentifier } from '../../providers/types';
import { Platform } from '../../providers/types';

function makeFakeGitContext(overrides: Record<string, unknown> = {}): GitContext {
  return {
    owner: 'test-owner',
    repo: 'test-repo',
    removeWorktree: vi.fn(() => true),
    createWorktreeForNewBranch: vi.fn(() => '/repo/.worktrees/chore-scenario-sweep'),
    ...overrides,
  } as unknown as GitContext;
}

function makeFakeCodeHost(overrides: Record<string, unknown> = {}): CodeHost {
  return {
    getDefaultBranch: vi.fn(() => 'dev'),
    findPullRequestByBranch: vi.fn(() => null),
    createPullRequest: vi.fn(() => ({ url: 'https://github.com/test-owner/test-repo/pull/99', number: 99 })),
    mergePullRequest: vi.fn(() => ({ success: true })),
    ...overrides,
  } as unknown as CodeHost;
}

function makeFakeBoundary(gitContext: GitContext, codeHost: CodeHost = makeFakeCodeHost()): LaunchBoundary {
  const repoId: RepoIdentifier = { owner: gitContext.owner, repo: gitContext.repo, platform: Platform.GitHub };
  return { gitContext, repoId, providers: { issueTracker: {} as never, codeHost } } as LaunchBoundary;
}

function makeFakeBase(overrides: Partial<SweepBase> = {}): SweepBase {
  return {
    ctx: {
      removeAndCommitPaths: vi.fn(() => true),
      pushBranch: vi.fn(),
    } as unknown as SweepBase['ctx'],
    codeHost: makeFakeCodeHost(),
    defaultBranch: 'dev',
    sweepBranch: SWEEP_BRANCH,
    worktreePath: '/tmp/worktree',
    findOpenSweepPr: vi.fn(() => null),
    openPr: vi.fn(() => 42),
    mergePr: vi.fn(() => ({ success: true })),
    log: vi.fn(),
    ...overrides,
  };
}

// ── persistRemovalViaPr ──────────────────────────────────────────────────────

describe('persistRemovalViaPr', () => {
  it('no-op when paths is empty — no guard check, no commit', async () => {
    const base = makeFakeBase();

    await persistRemovalViaPr([], base);

    expect(base.findOpenSweepPr).not.toHaveBeenCalled();
    expect(base.ctx.removeAndCommitPaths).not.toHaveBeenCalled();
  });

  it('skips when an open sweep PR already exists — no commit, no push, no new PR', async () => {
    const base = makeFakeBase({ findOpenSweepPr: vi.fn(() => 7) });

    await persistRemovalViaPr(['features/per-issue/feature-1.feature'], base);

    expect(base.ctx.removeAndCommitPaths).not.toHaveBeenCalled();
    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('#7'), 'info');
  });

  it('no-op when removeAndCommitPaths reports nothing staged — no push, no PR', async () => {
    const base = makeFakeBase({
      ctx: { removeAndCommitPaths: vi.fn(() => false), pushBranch: vi.fn() } as unknown as SweepBase['ctx'],
    });

    await persistRemovalViaPr(['features/per-issue/feature-1.feature'], base);

    expect(base.ctx.pushBranch).not.toHaveBeenCalled();
    expect(base.openPr).not.toHaveBeenCalled();
  });

  it('commits scoped to exactly the given paths with the stable sweep commit message', async () => {
    const base = makeFakeBase();
    const paths = ['features/per-issue/feature-1.feature', 'features/per-issue/step_definitions/feature-1.steps.ts'];

    await persistRemovalViaPr(paths, base);

    expect(base.ctx.removeAndCommitPaths).toHaveBeenCalledWith(paths, SWEEP_COMMIT_MESSAGE, base.worktreePath);
  });

  it('a push failure is logged at error and does not open a PR (never throws)', async () => {
    const base = makeFakeBase({
      ctx: {
        removeAndCommitPaths: vi.fn(() => true),
        pushBranch: vi.fn(() => { throw new Error('stale info'); }),
      } as unknown as SweepBase['ctx'],
    });

    await expect(persistRemovalViaPr(['features/per-issue/feature-1.feature'], base)).resolves.toBeUndefined();

    expect(base.openPr).not.toHaveBeenCalled();
    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('stale info'), 'error');
  });

  it('a zero/falsy PR number is logged at error and does not attempt a merge', async () => {
    const base = makeFakeBase({ openPr: vi.fn(() => 0) });

    await persistRemovalViaPr(['features/per-issue/feature-1.feature'], base);

    expect(base.mergePr).not.toHaveBeenCalled();
    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('PR number'), 'error');
  });

  it('a merge failure is logged at error, leaving the PR open (retried next sweep)', async () => {
    const base = makeFakeBase({ mergePr: vi.fn(() => ({ success: false, error: 'required check pending' })) });

    await persistRemovalViaPr(['features/per-issue/feature-1.feature'], base);

    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('required check pending'), 'error');
  });

  it('happy path: commits, pushes the sweep branch, opens a PR, and merges it', async () => {
    const base = makeFakeBase();
    const paths = ['features/per-issue/feature-1.feature'];

    await persistRemovalViaPr(paths, base);

    expect(base.ctx.pushBranch).toHaveBeenCalledWith(base.sweepBranch, base.worktreePath);
    expect(base.openPr).toHaveBeenCalledWith(base.sweepBranch, base.defaultBranch);
    expect(base.mergePr).toHaveBeenCalledWith(42);
    expect(base.log).toHaveBeenCalledWith(expect.stringContaining('#42'), 'success');
  });
});

// ── prepareSweepBase ─────────────────────────────────────────────────────────

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

// ── cleanupSweepBase ─────────────────────────────────────────────────────────

describe('cleanupSweepBase', () => {
  function makeFakeCleanupBase(overrides: Record<string, unknown> = {}) {
    return {
      ctx: {
        deleteRemoteBranch: vi.fn(() => true),
        removeWorktree: vi.fn(() => true),
        ...overrides,
      },
      sweepBranch: SWEEP_BRANCH,
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
});
