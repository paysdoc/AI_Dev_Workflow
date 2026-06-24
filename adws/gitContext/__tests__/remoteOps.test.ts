import { describe, it, expect } from 'vitest';
import { remoteOps } from '../remoteOps';

interface RunnerCall {
  command: string;
  cwd: string;
}

function makeRunner(stdout = ''): { run: (cmd: string, cwd: string) => string; calls: RunnerCall[] } {
  const calls: RunnerCall[] = [];
  const run = (command: string, cwd: string): string => {
    calls.push({ command, cwd });
    return stdout;
  };
  return { run, calls };
}

const CWD = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-foo';

// ── fetchRemote ──────────────────────────────────────────────────────────────

describe('fetchRemote', () => {
  it('issues git fetch origin "<branch>" with the given cwd', () => {
    const { run, calls } = makeRunner();
    remoteOps.fetchRemote(run, 'main', CWD);
    expect(calls[0].command).toBe('git fetch origin "main"');
    expect(calls[0].cwd).toBe(CWD);
  });

  it('propagates runner errors', () => {
    const run = () => { throw new Error('fetch failed'); };
    expect(() => remoteOps.fetchRemote(run, 'main', CWD)).toThrow('fetch failed');
  });
});

// ── mergeBranch ──────────────────────────────────────────────────────────────

describe('mergeBranch', () => {
  it('issues git merge "<ref>" with no flags when opts is empty', () => {
    const { run, calls } = makeRunner();
    remoteOps.mergeBranch(run, 'origin/main', CWD);
    expect(calls[0].command).toBe('git merge "origin/main"');
    expect(calls[0].cwd).toBe(CWD);
  });

  it('includes --no-commit and --no-ff flags', () => {
    const { run, calls } = makeRunner();
    remoteOps.mergeBranch(run, 'origin/main', CWD, { noCommit: true, noFf: true });
    expect(calls[0].command).toBe('git merge --no-commit --no-ff "origin/main"');
  });

  it('includes --no-edit flag', () => {
    const { run, calls } = makeRunner();
    remoteOps.mergeBranch(run, 'origin/main', CWD, { noEdit: true });
    expect(calls[0].command).toBe('git merge --no-edit "origin/main"');
  });

  it('propagates runner errors (conflict throws)', () => {
    const run = () => { throw Object.assign(new Error('CONFLICT'), { status: 1 }); };
    expect(() => remoteOps.mergeBranch(run, 'origin/main', CWD)).toThrow('CONFLICT');
  });
});

// ── abortMerge ───────────────────────────────────────────────────────────────

describe('abortMerge', () => {
  it('issues git merge --abort with the given cwd', () => {
    const { run, calls } = makeRunner();
    remoteOps.abortMerge(run, CWD);
    expect(calls[0].command).toBe('git merge --abort');
    expect(calls[0].cwd).toBe(CWD);
  });

  it('swallows a thrown runner error (no merge in progress is benign)', () => {
    const run = () => { throw new Error('fatal: There is no merge to abort.'); };
    expect(() => remoteOps.abortMerge(run, CWD)).not.toThrow();
  });
});

// ── lsRemote ─────────────────────────────────────────────────────────────────

describe('lsRemote', () => {
  it('issues git ls-remote origin "<branch>" with the given cwd', () => {
    const { run, calls } = makeRunner('abc123\trefs/heads/main\n');
    remoteOps.lsRemote(run, 'main', CWD);
    expect(calls[0].command).toBe('git ls-remote origin "main"');
    expect(calls[0].cwd).toBe(CWD);
  });

  it('returns the runner output', () => {
    const { run } = makeRunner('abc123\trefs/heads/main\n');
    const result = remoteOps.lsRemote(run, 'main', CWD);
    expect(result).toBe('abc123\trefs/heads/main\n');
  });

  it('returns empty string when branch is absent (exit 0, empty stdout)', () => {
    const { run } = makeRunner('');
    const result = remoteOps.lsRemote(run, 'no-such-branch', CWD);
    expect(result).toBe('');
  });

  it('propagates runner errors (network/auth failures)', () => {
    const run = () => { throw new Error('ssh: connect to host github.com port 22: No route to host'); };
    expect(() => remoteOps.lsRemote(run, 'main', CWD)).toThrow('No route to host');
  });
});
