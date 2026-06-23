/**
 * Tests re-homed from vcs/worktreeReset.ts resetWorktreeToRemote onto
 * the GitContext worktreeResetOps module (#662).
 * Uses injected runner + fs spy — no child_process or fs module mocks needed.
 */

import { describe, it, expect } from 'vitest';
import { worktreeResetOps } from '../../gitContext/worktreeResetOps';

type Call = { command: string; cwd: string };

interface FsSpy {
  existsSync: (p: string) => boolean;
  rmSync: (p: string, opts?: { force?: boolean; recursive?: boolean }) => void;
  existsCalls: string[];
  rmCalls: Array<[string, { force?: boolean; recursive?: boolean } | undefined]>;
}

function makeFsSpy(existsImpl: (p: string) => boolean = () => false): FsSpy {
  const existsCalls: string[] = [];
  const rmCalls: Array<[string, { force?: boolean; recursive?: boolean } | undefined]> = [];
  return {
    existsSync: (p) => { existsCalls.push(p); return existsImpl(p); },
    rmSync: (p, opts) => { rmCalls.push([p, opts]); },
    existsCalls,
    rmCalls,
  };
}

function makeRunner(gitDirResponse: string, extras: Map<string, string | Error> = new Map()): { run: (cmd: string, cwd: string) => string; calls: Call[] } {
  const calls: Call[] = [];
  let firstCall = true;
  const run = (command: string, cwd: string): string => {
    calls.push({ command, cwd });
    if (firstCall) { firstCall = false; return gitDirResponse; }
    const key = [...extras.keys()].find((k) => command.includes(k));
    const val = key !== undefined ? extras.get(key) : '';
    if (val instanceof Error) throw val;
    return val ?? '';
  };
  return { run, calls };
}

// ── Clean worktree (idempotent) ──────────────────────────────────────────────

describe('clean worktree — idempotent', () => {
  it('runs fetch, reset, clean in order and makes no abort or rmSync calls', () => {
    const { run, calls } = makeRunner('/wt/.git');
    const fs = makeFsSpy(() => false);

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    const cmds = calls.map((c) => c.command);
    expect(cmds[0]).toBe('git rev-parse --git-dir');
    expect(cmds[1]).toBe('git fetch origin "main"');
    expect(cmds[2]).toBe('git reset --hard "origin/main"');
    expect(cmds[3]).toBe('git clean -fdx');
    expect(cmds).toHaveLength(4);
    expect(fs.rmCalls).toHaveLength(0);
  });

  it('produces the same call sequence on a second invocation (idempotent)', () => {
    let callCount = 0;
    const run = (_cmd: string, _cwd: string): string => {
      callCount++;
      if (callCount % 4 === 1) return '/wt/.git'; // git-dir per call
      return '';
    };
    const fs = makeFsSpy(() => false);

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');
    const firstCount = callCount;
    callCount = 0;
    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');
    const secondCount = callCount;

    expect(firstCount).toBe(4);
    expect(secondCount).toBe(4);
  });
});

// ── Dirty tracked files ──────────────────────────────────────────────────────

describe('dirty tracked files', () => {
  it('calls git reset --hard exactly once', () => {
    const { run, calls } = makeRunner('/wt/.git');
    const fs = makeFsSpy(() => false);

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    const resetCalls = calls.filter((c) => c.command.includes('reset --hard'));
    expect(resetCalls).toHaveLength(1);
    expect(resetCalls[0].command).toBe('git reset --hard "origin/main"');
  });
});

// ── In-progress merge, plumbing succeeds ────────────────────────────────────

describe('in-progress merge — plumbing succeeds', () => {
  it('runs merge --abort before fetch/reset/clean and does not call rmSync', () => {
    const { run, calls } = makeRunner('/wt/.git');
    const fs = makeFsSpy((p) => p.endsWith('MERGE_HEAD'));

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    const cmds = calls.map((c) => c.command);
    expect(cmds[0]).toBe('git rev-parse --git-dir');
    expect(cmds[1]).toBe('git merge --abort');
    expect(cmds[2]).toBe('git fetch origin "main"');
    expect(cmds[3]).toBe('git reset --hard "origin/main"');
    expect(cmds[4]).toBe('git clean -fdx');
    expect(fs.rmCalls).toHaveLength(0);
  });
});

// ── In-progress merge, plumbing fails → fallback ────────────────────────────

describe('in-progress merge — plumbing fails', () => {
  it('removes MERGE_HEAD and continues to fetch/reset/clean', () => {
    const cmds: string[] = [];
    let first = true;
    const run = (cmd: string, _cwd: string): string => {
      cmds.push(cmd);
      if (first) { first = false; return '/wt/.git'; }
      if (cmd.includes('merge --abort')) throw new Error('not a merge');
      return '';
    };
    const fs = makeFsSpy((p) => p.endsWith('MERGE_HEAD'));

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    expect(fs.rmCalls.some(([p]) => p.endsWith('MERGE_HEAD'))).toBe(true);
    expect(cmds).toContain('git fetch origin "main"');
    expect(cmds).toContain('git reset --hard "origin/main"');
    expect(cmds).toContain('git clean -fdx');
  });
});

// ── In-progress rebase, plumbing succeeds ───────────────────────────────────

describe('in-progress rebase — plumbing succeeds', () => {
  it('runs rebase --abort before fetch/reset/clean and does not call rmSync', () => {
    const { run, calls } = makeRunner('/wt/.git');
    const fs = makeFsSpy((p) => p.endsWith('rebase-apply'));

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    const cmds = calls.map((c) => c.command);
    expect(cmds[0]).toBe('git rev-parse --git-dir');
    expect(cmds[1]).toBe('git rebase --abort');
    expect(cmds[2]).toBe('git fetch origin "main"');
    expect(fs.rmCalls).toHaveLength(0);
  });
});

// ── In-progress rebase, plumbing fails → fallback ───────────────────────────

describe('in-progress rebase — plumbing fails', () => {
  it('removes rebase-apply and rebase-merge dirs then continues', () => {
    const cmds: string[] = [];
    let first = true;
    const run = (cmd: string, _cwd: string): string => {
      cmds.push(cmd);
      if (first) { first = false; return '/wt/.git'; }
      if (cmd.includes('rebase --abort')) throw new Error('no rebase');
      return '';
    };
    const fs = makeFsSpy((p) => p.endsWith('rebase-apply'));

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    expect(fs.rmCalls.some(([p]) => p.endsWith('rebase-apply'))).toBe(true);
    expect(fs.rmCalls.some(([p]) => p.endsWith('rebase-merge'))).toBe(true);
    expect(cmds).toContain('git fetch origin "main"');
  });
});

// ── Both merge and rebase markers ───────────────────────────────────────────

describe('both merge and rebase markers present', () => {
  it('aborts merge before rebase', () => {
    const { run, calls } = makeRunner('/wt/.git');
    const fs = makeFsSpy((p) => p.endsWith('MERGE_HEAD') || p.endsWith('rebase-apply'));

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    const cmds = calls.map((c) => c.command);
    const mergeIdx = cmds.indexOf('git merge --abort');
    const rebaseIdx = cmds.indexOf('git rebase --abort');
    expect(mergeIdx).not.toBe(-1);
    expect(rebaseIdx).not.toBe(-1);
    expect(mergeIdx).toBeLessThan(rebaseIdx);
  });
});

// ── git-dir resolution ───────────────────────────────────────────────────────

describe('git-dir resolution', () => {
  it('resolves a relative .git to an absolute path for existence checks', () => {
    const { run } = makeRunner('.git');
    const fs = makeFsSpy((p) => p === '/wt/.git/MERGE_HEAD');

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    expect(fs.existsCalls).toContain('/wt/.git/MERGE_HEAD');
  });

  it('uses an absolute git-dir path as-is for existence checks (linked worktree)', () => {
    const { run } = makeRunner('/abs/path/to/gitdir');
    const fs = makeFsSpy((p) => p === '/abs/path/to/gitdir/MERGE_HEAD');

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    expect(fs.existsCalls).toContain('/abs/path/to/gitdir/MERGE_HEAD');
  });
});

// ── Mandatory steps throw on failure ────────────────────────────────────────

describe('mandatory steps throw on failure', () => {
  it('throws when git fetch fails and does not call reset or clean', () => {
    const cmds: string[] = [];
    let first = true;
    const run = (cmd: string, _cwd: string): string => {
      cmds.push(cmd);
      if (first) { first = false; return '/wt/.git'; }
      if (cmd.includes('fetch')) throw new Error('offline');
      return '';
    };
    const fs = makeFsSpy(() => false);

    expect(() => worktreeResetOps.resetWorktree(run, fs, '/wt', 'main')).toThrow(/Failed to fetch origin\/main/);
    expect(cmds).not.toContain('git reset --hard "origin/main"');
    expect(cmds).not.toContain('git clean -fdx');
  });

  it('throws when git reset --hard fails and does not call clean', () => {
    const cmds: string[] = [];
    let first = true;
    const run = (cmd: string, _cwd: string): string => {
      cmds.push(cmd);
      if (first) { first = false; return '/wt/.git'; }
      if (cmd.includes('reset')) throw new Error('reset failed');
      return '';
    };
    const fs = makeFsSpy(() => false);

    expect(() => worktreeResetOps.resetWorktree(run, fs, '/wt', 'main')).toThrow(/Failed to reset to origin\/main/);
    expect(cmds).not.toContain('git clean -fdx');
  });

  it('throws when git clean -fdx fails', () => {
    const cmds: string[] = [];
    let first = true;
    const run = (cmd: string, _cwd: string): string => {
      cmds.push(cmd);
      if (first) { first = false; return '/wt/.git'; }
      if (cmd.includes('clean')) throw new Error('clean failed');
      return '';
    };
    const fs = makeFsSpy(() => false);

    expect(() => worktreeResetOps.resetWorktree(run, fs, '/wt', 'main')).toThrow(/Failed to clean worktree/);
  });
});
