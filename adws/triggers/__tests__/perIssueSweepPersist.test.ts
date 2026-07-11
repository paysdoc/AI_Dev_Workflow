import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock('../../github/gitContextFactory', () => ({
  gitContextForRepo: vi.fn(),
}));

vi.mock('../../core', () => ({
  log: vi.fn(),
}));

vi.mock('../../github', () => ({
  getRepoInfo: vi.fn(() => ({ owner: 'test-owner', repo: 'test-repo' })),
  mergePR: vi.fn(),
  defaultFindPRByBranch: vi.fn(),
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
import { gitContextForRepo } from '../../github/gitContextFactory';
import { getRepoInfo, mergePR, defaultFindPRByBranch } from '../../github';

function makeFakeBase(overrides: Partial<SweepBase> = {}): SweepBase {
  return {
    ctx: {
      removeAndCommitPaths: vi.fn(() => true),
      pushBranch: vi.fn(),
    } as unknown as SweepBase['ctx'],
    repoInfo: { owner: 'o', repo: 'r' },
    defaultBranch: 'dev',
    sweepBranch: SWEEP_BRANCH,
    worktreePath: '/tmp/worktree',
    findOpenSweepPr: vi.fn(() => null),
    openPr: vi.fn(() => 'https://github.com/o/r/pull/42'),
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

  it('an unparseable PR URL is logged at error and does not attempt a merge', async () => {
    const base = makeFakeBase({ openPr: vi.fn(() => '') });

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

  function makeMockCtx(overrides: Record<string, unknown> = {}) {
    return {
      defaultBranch: vi.fn(() => 'dev'),
      removeWorktree: vi.fn(() => true),
      createWorktreeForNewBranch: vi.fn(() => '/repo/.worktrees/chore-scenario-sweep'),
      createPR: vi.fn(() => 'https://github.com/test-owner/test-repo/pull/99'),
      ...overrides,
    };
  }

  it('resolves a SweepBase off a dedicated worktree created from the default branch', () => {
    const mockCtx = makeMockCtx();
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);

    const base = prepareSweepBase();

    expect(base).not.toBeNull();
    expect(getRepoInfo).toHaveBeenCalled();
    expect(mockCtx.createWorktreeForNewBranch).toHaveBeenCalledWith(SWEEP_BRANCH, 'dev');
    expect(base?.defaultBranch).toBe('dev');
    expect(base?.sweepBranch).toBe(SWEEP_BRANCH);
    expect(base?.worktreePath).toBe('/repo/.worktrees/chore-scenario-sweep');
  });

  it('best-effort cleans a stale prior sweep worktree before creating a fresh one', () => {
    const mockCtx = makeMockCtx();
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);

    prepareSweepBase();

    expect(mockCtx.removeWorktree).toHaveBeenCalledWith(SWEEP_BRANCH);
  });

  it('a throwing removeWorktree pre-clean does not abort base preparation', () => {
    const mockCtx = makeMockCtx({ removeWorktree: vi.fn(() => { throw new Error('nothing to remove'); }) });
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);

    const base = prepareSweepBase();

    expect(base).not.toBeNull();
    expect(mockCtx.createWorktreeForNewBranch).toHaveBeenCalled();
  });

  it('returns null when worktree creation fails (degrades to a no-op sweep, never throws)', () => {
    const mockCtx = makeMockCtx({
      createWorktreeForNewBranch: vi.fn(() => { throw new Error('git worktree add failed'); }),
    });
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);

    expect(prepareSweepBase()).toBeNull();
  });

  it('findOpenSweepPr resolves an OPEN PR number via defaultFindPRByBranch', () => {
    const mockCtx = makeMockCtx();
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);
    vi.mocked(defaultFindPRByBranch).mockReturnValue({ number: 12, state: 'OPEN', headRefName: SWEEP_BRANCH, baseRefName: 'dev' });

    const base = prepareSweepBase();

    expect(base?.findOpenSweepPr(SWEEP_BRANCH)).toBe(12);
  });

  it('findOpenSweepPr returns null when the found PR is not open', () => {
    const mockCtx = makeMockCtx();
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);
    vi.mocked(defaultFindPRByBranch).mockReturnValue({ number: 12, state: 'MERGED', headRefName: SWEEP_BRANCH, baseRefName: 'dev' });

    const base = prepareSweepBase();

    expect(base?.findOpenSweepPr(SWEEP_BRANCH)).toBeNull();
  });

  it('findOpenSweepPr returns null when no PR is found for the branch', () => {
    const mockCtx = makeMockCtx();
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);
    vi.mocked(defaultFindPRByBranch).mockReturnValue(null);

    const base = prepareSweepBase();

    expect(base?.findOpenSweepPr(SWEEP_BRANCH)).toBeNull();
  });

  it('openPr delegates to ctx.createPR with the sweep head/base branches', () => {
    const mockCtx = makeMockCtx();
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);

    const base = prepareSweepBase();
    const url = base?.openPr(SWEEP_BRANCH, 'dev');

    expect(mockCtx.createPR).toHaveBeenCalledWith(expect.any(String), expect.any(String), SWEEP_BRANCH, 'dev');
    expect(url).toBe('https://github.com/test-owner/test-repo/pull/99');
  });

  it('mergePr delegates to the repoInfo-scoped mergePR', () => {
    const mockCtx = makeMockCtx();
    vi.mocked(gitContextForRepo).mockReturnValue(mockCtx as never);
    vi.mocked(mergePR).mockReturnValue({ success: true });

    const base = prepareSweepBase();
    const result = base?.mergePr(99);

    expect(mergePR).toHaveBeenCalledWith(99, { owner: 'test-owner', repo: 'test-repo' });
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
