/**
 * Uses injected runner + fs spy — no child_process or fs module mocks needed.
 */

import { describe, it, expect } from 'vitest';
import { worktreeResetOps } from '@paysdoc/devplatform/git';

type Run = (argv: readonly string[], cwd: string) => string;
type Call = { argv: readonly string[]; cwd: string };

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

function makeRunner(gitDirResponse: string, extras: Map<string, string | Error> = new Map()): { run: Run; calls: Call[] } {
  const calls: Call[] = [];
  let firstCall = true;
  const run: Run = (argv, cwd) => {
    calls.push({ argv: [...argv], cwd });
    if (firstCall) { firstCall = false; return gitDirResponse; }
    const commandLine = argv.join(' ');
    const key = [...extras.keys()].find((k) => commandLine.includes(k));
    const val = key !== undefined ? extras.get(key) : '';
    if (val instanceof Error) throw val;
    return val ?? '';
  };
  return { run, calls };
}

describe('clean worktree — idempotent', () => {
  it('runs fetch, reset, clean in order and makes no abort or rmSync calls', () => {
    const { run, calls } = makeRunner('/wt/.git');
    const fs = makeFsSpy(() => false);

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    const argvs = calls.map((c) => c.argv);
    expect(argvs[0]).toEqual(['git', 'rev-parse', '--git-dir']);
    expect(argvs[1]).toEqual(['git', 'fetch', 'origin', 'main']);
    expect(argvs[2]).toEqual(['git', 'reset', '--hard', 'origin/main']);
    expect(argvs[3]).toEqual(['git', 'clean', '-fdx']);
    expect(argvs).toHaveLength(4);
    expect(fs.rmCalls).toHaveLength(0);
  });

  it('produces the same call sequence on a second invocation (idempotent)', () => {
    let callCount = 0;
    const run: Run = () => {
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

describe('dirty tracked files', () => {
  it('calls git reset --hard exactly once', () => {
    const { run, calls } = makeRunner('/wt/.git');
    const fs = makeFsSpy(() => false);

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    const resetCalls = calls.filter((c) => c.argv.join(' ').includes('reset --hard'));
    expect(resetCalls).toHaveLength(1);
    expect(resetCalls[0].argv).toEqual(['git', 'reset', '--hard', 'origin/main']);
  });
});

describe('in-progress merge — plumbing succeeds', () => {
  it('runs merge --abort before fetch/reset/clean and does not call rmSync', () => {
    const { run, calls } = makeRunner('/wt/.git');
    const fs = makeFsSpy((p) => p.endsWith('MERGE_HEAD'));

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    const argvs = calls.map((c) => c.argv);
    expect(argvs[0]).toEqual(['git', 'rev-parse', '--git-dir']);
    expect(argvs[1]).toEqual(['git', 'merge', '--abort']);
    expect(argvs[2]).toEqual(['git', 'fetch', 'origin', 'main']);
    expect(argvs[3]).toEqual(['git', 'reset', '--hard', 'origin/main']);
    expect(argvs[4]).toEqual(['git', 'clean', '-fdx']);
    expect(fs.rmCalls).toHaveLength(0);
  });
});

describe('in-progress merge — plumbing fails', () => {
  it('removes MERGE_HEAD and continues to fetch/reset/clean', () => {
    const argvs: Array<readonly string[]> = [];
    let first = true;
    const run: Run = (argv) => {
      argvs.push(argv);
      if (first) { first = false; return '/wt/.git'; }
      if (argv.join(' ').includes('merge --abort')) throw new Error('not a merge');
      return '';
    };
    const fs = makeFsSpy((p) => p.endsWith('MERGE_HEAD'));

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    expect(fs.rmCalls.some(([p]) => p.endsWith('MERGE_HEAD'))).toBe(true);
    expect(argvs).toContainEqual(['git', 'fetch', 'origin', 'main']);
    expect(argvs).toContainEqual(['git', 'reset', '--hard', 'origin/main']);
    expect(argvs).toContainEqual(['git', 'clean', '-fdx']);
  });
});

describe('in-progress rebase — plumbing succeeds', () => {
  it('runs rebase --abort before fetch/reset/clean and does not call rmSync', () => {
    const { run, calls } = makeRunner('/wt/.git');
    const fs = makeFsSpy((p) => p.endsWith('rebase-apply'));

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    const argvs = calls.map((c) => c.argv);
    expect(argvs[0]).toEqual(['git', 'rev-parse', '--git-dir']);
    expect(argvs[1]).toEqual(['git', 'rebase', '--abort']);
    expect(argvs[2]).toEqual(['git', 'fetch', 'origin', 'main']);
    expect(fs.rmCalls).toHaveLength(0);
  });
});

describe('in-progress rebase — plumbing fails', () => {
  it('removes rebase-apply and rebase-merge dirs then continues', () => {
    const argvs: Array<readonly string[]> = [];
    let first = true;
    const run: Run = (argv) => {
      argvs.push(argv);
      if (first) { first = false; return '/wt/.git'; }
      if (argv.join(' ').includes('rebase --abort')) throw new Error('no rebase');
      return '';
    };
    const fs = makeFsSpy((p) => p.endsWith('rebase-apply'));

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    expect(fs.rmCalls.some(([p]) => p.endsWith('rebase-apply'))).toBe(true);
    expect(fs.rmCalls.some(([p]) => p.endsWith('rebase-merge'))).toBe(true);
    expect(argvs).toContainEqual(['git', 'fetch', 'origin', 'main']);
  });
});

describe('both merge and rebase markers present', () => {
  it('aborts merge before rebase', () => {
    const { run, calls } = makeRunner('/wt/.git');
    const fs = makeFsSpy((p) => p.endsWith('MERGE_HEAD') || p.endsWith('rebase-apply'));

    worktreeResetOps.resetWorktree(run, fs, '/wt', 'main');

    const lines = calls.map((c) => c.argv.join(' '));
    const mergeIdx = lines.indexOf('git merge --abort');
    const rebaseIdx = lines.indexOf('git rebase --abort');
    expect(mergeIdx).not.toBe(-1);
    expect(rebaseIdx).not.toBe(-1);
    expect(mergeIdx).toBeLessThan(rebaseIdx);
  });
});

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

describe('mandatory steps throw on failure', () => {
  it('throws when git fetch fails and does not call reset or clean', () => {
    const argvs: Array<readonly string[]> = [];
    let first = true;
    const run: Run = (argv) => {
      argvs.push(argv);
      if (first) { first = false; return '/wt/.git'; }
      if (argv.join(' ').includes('fetch')) throw new Error('offline');
      return '';
    };
    const fs = makeFsSpy(() => false);

    expect(() => worktreeResetOps.resetWorktree(run, fs, '/wt', 'main')).toThrow(/Failed to fetch origin\/main/);
    expect(argvs).not.toContainEqual(['git', 'reset', '--hard', 'origin/main']);
    expect(argvs).not.toContainEqual(['git', 'clean', '-fdx']);
  });

  it('throws when git reset --hard fails and does not call clean', () => {
    const argvs: Array<readonly string[]> = [];
    let first = true;
    const run: Run = (argv) => {
      argvs.push(argv);
      if (first) { first = false; return '/wt/.git'; }
      if (argv.join(' ').includes('reset')) throw new Error('reset failed');
      return '';
    };
    const fs = makeFsSpy(() => false);

    expect(() => worktreeResetOps.resetWorktree(run, fs, '/wt', 'main')).toThrow(/Failed to reset to origin\/main/);
    expect(argvs).not.toContainEqual(['git', 'clean', '-fdx']);
  });

  it('throws when git clean -fdx fails', () => {
    const argvs: Array<readonly string[]> = [];
    let first = true;
    const run: Run = (argv) => {
      argvs.push(argv);
      if (first) { first = false; return '/wt/.git'; }
      if (argv.join(' ').includes('clean')) throw new Error('clean failed');
      return '';
    };
    const fs = makeFsSpy(() => false);

    expect(() => worktreeResetOps.resetWorktree(run, fs, '/wt', 'main')).toThrow(/Failed to clean worktree/);
  });
});
