import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PathLike } from 'fs';

vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
}));
vi.mock('../../core', () => ({ log: vi.fn() }));

import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { resetWorktreeToRemote } from '../worktreeReset';

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockRmSync = vi.mocked(rmSync);

beforeEach(() => {
  mockExecSync.mockReset();
  mockExistsSync.mockReset();
  mockRmSync.mockReset();
});

function mockGitDir(gitDirPath: string): void {
  mockExecSync.mockReturnValueOnce(gitDirPath);
}

function mockCleanRun(): void {
  mockExecSync
    .mockReturnValueOnce('') // fetch
    .mockReturnValueOnce('') // reset --hard
    .mockReturnValueOnce(''); // clean -fdx
}

// ── Clean worktree (idempotent) ────────────────────────────────────────────────

describe('clean worktree — idempotent', () => {
  it('runs fetch, reset, clean in order and makes no abort or rmSync calls', () => {
    mockGitDir('/wt/.git');
    mockExistsSync.mockReturnValue(false);
    mockCleanRun();

    resetWorktreeToRemote('/wt', 'main');

    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toBe('git rev-parse --git-dir');
    expect(calls[1]).toBe('git fetch origin "main"');
    expect(calls[2]).toBe('git reset --hard "origin/main"');
    expect(calls[3]).toBe('git clean -fdx');
    expect(calls).toHaveLength(4);
    expect(mockRmSync).not.toHaveBeenCalled();
  });

  it('produces the same call sequence on a second invocation (idempotent)', () => {
    for (let i = 0; i < 2; i++) {
      mockGitDir('/wt/.git');
      mockExistsSync.mockReturnValue(false);
      mockCleanRun();
    }

    resetWorktreeToRemote('/wt', 'main');
    const firstCallCount = mockExecSync.mock.calls.length;
    resetWorktreeToRemote('/wt', 'main');
    const secondCallCount = mockExecSync.mock.calls.length - firstCallCount;

    expect(firstCallCount).toBe(4);
    expect(secondCallCount).toBe(4);
  });
});

// ── Dirty tracked files ────────────────────────────────────────────────────────

describe('dirty tracked files', () => {
  it('calls git reset --hard exactly once to discard tracked changes', () => {
    mockGitDir('/wt/.git');
    mockExistsSync.mockReturnValue(false);
    mockCleanRun();

    resetWorktreeToRemote('/wt', 'main');

    const resetCalls = mockExecSync.mock.calls.filter(
      (c) => (c[0] as string).includes('reset --hard'),
    );
    expect(resetCalls).toHaveLength(1);
    expect(resetCalls[0][0]).toBe('git reset --hard "origin/main"');
  });
});

// ── In-progress merge, plumbing succeeds ──────────────────────────────────────

describe('in-progress merge — plumbing succeeds', () => {
  it('runs merge --abort before fetch/reset/clean and does not call rmSync', () => {
    mockGitDir('/wt/.git');
    mockExistsSync.mockImplementation((p: PathLike) =>
      String(p).endsWith('MERGE_HEAD'),
    );
    mockExecSync
      .mockReturnValueOnce('') // merge --abort
      .mockReturnValueOnce('') // fetch
      .mockReturnValueOnce('') // reset --hard
      .mockReturnValueOnce(''); // clean

    resetWorktreeToRemote('/wt', 'main');

    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toBe('git rev-parse --git-dir');
    expect(calls[1]).toBe('git merge --abort');
    expect(calls[2]).toBe('git fetch origin "main"');
    expect(calls[3]).toBe('git reset --hard "origin/main"');
    expect(calls[4]).toBe('git clean -fdx');
    expect(mockRmSync).not.toHaveBeenCalled();
  });
});

// ── In-progress merge, plumbing fails → fallback ──────────────────────────────

describe('in-progress merge — plumbing fails', () => {
  it('removes MERGE_HEAD and continues to fetch/reset/clean', () => {
    mockGitDir('/wt/.git');
    mockExistsSync.mockImplementation((p: PathLike) =>
      String(p).endsWith('MERGE_HEAD'),
    );
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('not a merge'); }) // merge --abort fails
      .mockReturnValueOnce('') // fetch
      .mockReturnValueOnce('') // reset
      .mockReturnValueOnce(''); // clean

    resetWorktreeToRemote('/wt', 'main');

    expect(mockRmSync).toHaveBeenCalledWith('/wt/.git/MERGE_HEAD', { force: true });
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls).toContain('git fetch origin "main"');
    expect(calls).toContain('git reset --hard "origin/main"');
    expect(calls).toContain('git clean -fdx');
  });
});

// ── In-progress rebase, plumbing succeeds ────────────────────────────────────

describe('in-progress rebase — plumbing succeeds', () => {
  it('runs rebase --abort before fetch/reset/clean and does not call rmSync', () => {
    mockGitDir('/wt/.git');
    mockExistsSync.mockImplementation((p: PathLike) =>
      String(p).endsWith('rebase-apply'),
    );
    mockExecSync
      .mockReturnValueOnce('') // rebase --abort
      .mockReturnValueOnce('') // fetch
      .mockReturnValueOnce('') // reset
      .mockReturnValueOnce(''); // clean

    resetWorktreeToRemote('/wt', 'main');

    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toBe('git rev-parse --git-dir');
    expect(calls[1]).toBe('git rebase --abort');
    expect(calls[2]).toBe('git fetch origin "main"');
    expect(mockRmSync).not.toHaveBeenCalled();
  });
});

// ── In-progress rebase, plumbing fails → fallback ────────────────────────────

describe('in-progress rebase — plumbing fails', () => {
  it('removes rebase-apply and rebase-merge dirs then continues', () => {
    mockGitDir('/wt/.git');
    mockExistsSync.mockImplementation((p: PathLike) =>
      String(p).endsWith('rebase-apply'),
    );
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('no rebase'); }) // rebase --abort fails
      .mockReturnValueOnce('') // fetch
      .mockReturnValueOnce('') // reset
      .mockReturnValueOnce(''); // clean

    resetWorktreeToRemote('/wt', 'main');

    expect(mockRmSync).toHaveBeenCalledWith('/wt/.git/rebase-apply', {
      recursive: true,
      force: true,
    });
    expect(mockRmSync).toHaveBeenCalledWith('/wt/.git/rebase-merge', {
      recursive: true,
      force: true,
    });
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls).toContain('git fetch origin "main"');
  });
});

// ── Untracked files ────────────────────────────────────────────────────────────

describe('untracked files', () => {
  it('runs git clean -fdx as the last execSync call', () => {
    mockGitDir('/wt/.git');
    mockExistsSync.mockReturnValue(false);
    mockCleanRun();

    resetWorktreeToRemote('/wt', 'main');

    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls[calls.length - 1]).toBe('git clean -fdx');
  });
});

// ── Both merge and rebase markers present ────────────────────────────────────

describe('both merge and rebase markers present', () => {
  it('aborts merge before rebase', () => {
    mockGitDir('/wt/.git');
    mockExistsSync.mockImplementation((p: PathLike) => {
      const s = String(p);
      return s.endsWith('MERGE_HEAD') || s.endsWith('rebase-apply');
    });
    mockExecSync
      .mockReturnValueOnce('') // merge --abort
      .mockReturnValueOnce('') // rebase --abort
      .mockReturnValueOnce('') // fetch
      .mockReturnValueOnce('') // reset
      .mockReturnValueOnce(''); // clean

    resetWorktreeToRemote('/wt', 'main');

    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    const mergeIdx = calls.indexOf('git merge --abort');
    const rebaseIdx = calls.indexOf('git rebase --abort');
    expect(mergeIdx).not.toBe(-1);
    expect(rebaseIdx).not.toBe(-1);
    expect(mergeIdx).toBeLessThan(rebaseIdx);
  });
});

// ── git-dir resolution: relative vs absolute ──────────────────────────────────

describe('git-dir resolution', () => {
  it('resolves a relative .git to an absolute path for existence checks', () => {
    mockExecSync.mockReturnValueOnce('.git');
    mockExistsSync.mockImplementation((p: PathLike) =>
      String(p) === '/wt/.git/MERGE_HEAD',
    );
    mockExecSync
      .mockReturnValueOnce('') // merge --abort
      .mockReturnValueOnce('') // fetch
      .mockReturnValueOnce('') // reset
      .mockReturnValueOnce(''); // clean

    resetWorktreeToRemote('/wt', 'main');

    expect(mockExistsSync).toHaveBeenCalledWith('/wt/.git/MERGE_HEAD');
  });

  it('uses an absolute git-dir path as-is for existence checks (linked worktree)', () => {
    mockExecSync.mockReturnValueOnce('/abs/path/to/gitdir');
    mockExistsSync.mockImplementation((p: PathLike) =>
      String(p) === '/abs/path/to/gitdir/MERGE_HEAD',
    );
    mockExecSync
      .mockReturnValueOnce('') // merge --abort
      .mockReturnValueOnce('') // fetch
      .mockReturnValueOnce('') // reset
      .mockReturnValueOnce(''); // clean

    resetWorktreeToRemote('/wt', 'main');

    expect(mockExistsSync).toHaveBeenCalledWith('/abs/path/to/gitdir/MERGE_HEAD');
  });
});

// ── Mandatory steps throw on failure ─────────────────────────────────────────

describe('mandatory steps throw on failure', () => {
  it('throws when git fetch fails and does not call reset or clean', () => {
    mockGitDir('/wt/.git');
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementationOnce(() => { throw new Error('offline'); });

    expect(() => resetWorktreeToRemote('/wt', 'main')).toThrow(/Failed to fetch origin\/main/);
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls).not.toContain('git reset --hard "origin/main"');
    expect(calls).not.toContain('git clean -fdx');
  });

  it('throws when git reset --hard fails and does not call clean', () => {
    mockGitDir('/wt/.git');
    mockExistsSync.mockReturnValue(false);
    mockExecSync
      .mockReturnValueOnce('') // fetch ok
      .mockImplementationOnce(() => { throw new Error('reset failed'); });

    expect(() => resetWorktreeToRemote('/wt', 'main')).toThrow(/Failed to reset to origin\/main/);
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls).not.toContain('git clean -fdx');
  });

  it('throws when git clean -fdx fails', () => {
    mockGitDir('/wt/.git');
    mockExistsSync.mockReturnValue(false);
    mockExecSync
      .mockReturnValueOnce('') // fetch ok
      .mockReturnValueOnce('') // reset ok
      .mockImplementationOnce(() => { throw new Error('clean failed'); });

    expect(() => resetWorktreeToRemote('/wt', 'main')).toThrow(/Failed to clean worktree/);
  });
});
