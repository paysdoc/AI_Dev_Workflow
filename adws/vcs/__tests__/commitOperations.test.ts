/**
 * Tests re-homed from vcs/commitOperations.ts onto the GitContext commitOps module (#662).
 * Uses the injected-runner (ExecFn spy) pattern so no child_process mock is needed.
 */

import { describe, it, expect } from 'vitest';
import { commitOps, isLeaseRejection } from '../../gitContext/commitOps';

type Call = { command: string; cwd: string };

function makeRunner(responses: Map<string, string | Error> = new Map()): { run: (cmd: string, cwd: string) => string; calls: Call[] } {
  const calls: Call[] = [];
  const run = (command: string, cwd: string): string => {
    calls.push({ command, cwd });
    const key = [...responses.keys()].find((k) => command.includes(k));
    const val = key !== undefined ? responses.get(key) : '';
    if (val instanceof Error) throw val;
    return val ?? '';
  };
  return { run, calls };
}

// ── getHeadTreeHash ──────────────────────────────────────────────────────────

describe('getHeadTreeHash', () => {
  it('calls git rev-parse "HEAD^{tree}" with the provided cwd', () => {
    const { run, calls } = makeRunner(new Map([['rev-parse', 'abc123\n']]));
    commitOps.getHeadTreeHash(run, '/my/repo');
    expect(calls[0].command).toBe('git rev-parse "HEAD^{tree}"');
    expect(calls[0].cwd).toBe('/my/repo');
  });

  it('returns trimmed output', () => {
    const { run } = makeRunner(new Map([['rev-parse', 'abc123def456']]));
    expect(commitOps.getHeadTreeHash(run, '/repo')).toBe('abc123def456');
  });
});

// ── hasUncommittedChanges ────────────────────────────────────────────────────

describe('hasUncommittedChanges', () => {
  it('returns true for non-empty porcelain output', () => {
    const { run } = makeRunner(new Map([['status', ' M src/foo.ts\n']]));
    expect(commitOps.hasUncommittedChanges(run, '/repo')).toBe(true);
  });

  it('returns false for empty output', () => {
    const { run } = makeRunner(new Map([['status', '']]));
    expect(commitOps.hasUncommittedChanges(run, '/repo')).toBe(false);
  });

  it('returns false for whitespace-only output', () => {
    const { run } = makeRunner(new Map([['status', '   \n  ']]));
    expect(commitOps.hasUncommittedChanges(run, '/repo')).toBe(false);
  });

  it('calls git status --porcelain with the provided cwd', () => {
    const { run, calls } = makeRunner(new Map([['status', '']]));
    commitOps.hasUncommittedChanges(run, '/my/repo');
    expect(calls[0].command).toBe('git status --porcelain');
    expect(calls[0].cwd).toBe('/my/repo');
  });
});

// ── pushBranch ───────────────────────────────────────────────────────────────

describe('pushBranch', () => {
  it('issues fetch then force-with-lease push in order', () => {
    const { run, calls } = makeRunner();
    commitOps.pushBranch(run, 'feature-x', '/repo');
    expect(calls[0].command).toBe('git fetch origin "feature-x"');
    expect(calls[1].command).toBe('git push --force-with-lease --force-if-includes -u origin "feature-x"');
  });

  it('passes the worktree cwd to both git commands', () => {
    const { run, calls } = makeRunner();
    commitOps.pushBranch(run, 'feature-x', '/repo');
    expect(calls[0].cwd).toBe('/repo');
    expect(calls[1].cwd).toBe('/repo');
  });

  it('tolerates a fetch failure (first push — no remote ref)', () => {
    let pushCalled = false;
    const run = (cmd: string, _cwd: string): string => {
      if (cmd.includes('fetch')) throw new Error('fatal: no such remote ref feature-x');
      pushCalled = true;
      return '';
    };
    expect(() => commitOps.pushBranch(run, 'feature-x', '/repo')).not.toThrow();
    expect(pushCalled).toBe(true);
  });

  it('throws a distinct lease error on stale-info rejection', () => {
    const leaseError = Object.assign(new Error('push rejected'), {
      stderr: ' ! [rejected] feature-x -> feature-x (stale info)',
    });
    const run = (cmd: string): string => {
      if (cmd.includes('push')) throw leaseError;
      return '';
    };
    let thrown: Error | undefined;
    try { commitOps.pushBranch(run, 'feature-x', '/repo'); } catch (e) { thrown = e as Error; }
    expect(thrown?.message).toMatch(/force-with-lease/);
    expect(thrown?.message).toMatch(/moved underneath/i);
  });

  it('throws a distinct lease error on remote-ref-updated-since-checkout rejection', () => {
    const leaseError = Object.assign(new Error('push rejected'), {
      stderr: ' ! [rejected] feature-x -> feature-x (remote ref updated since checkout)',
    });
    const run = (cmd: string): string => {
      if (cmd.includes('push')) throw leaseError;
      return '';
    };
    let thrown: Error | undefined;
    try { commitOps.pushBranch(run, 'feature-x', '/repo'); } catch (e) { thrown = e as Error; }
    expect(thrown?.message).toMatch(/force-with-lease/);
    expect(thrown?.message).toMatch(/manual/i);
  });

  it('rethrows non-lease errors without lease wording', () => {
    const networkError = new Error('fatal: unable to access: Could not resolve host: github.com');
    const run = (cmd: string): string => {
      if (cmd.includes('push')) throw networkError;
      return '';
    };
    let thrown: Error | undefined;
    try { commitOps.pushBranch(run, 'feature-x', '/repo'); } catch (e) { thrown = e as Error; }
    expect(thrown?.message).toContain('Could not resolve host');
    expect(thrown?.message).not.toMatch(/force-with-lease/);
  });
});

// ── isLeaseRejection ─────────────────────────────────────────────────────────

describe('isLeaseRejection', () => {
  it('returns true for stale info stderr', () => {
    const err = Object.assign(new Error(), { stderr: 'stale info' });
    expect(isLeaseRejection(err)).toBe(true);
  });

  it('returns true for remote ref updated since checkout stderr', () => {
    const err = Object.assign(new Error(), { stderr: 'remote ref updated since checkout' });
    expect(isLeaseRejection(err)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    const err = new Error('Could not resolve host');
    expect(isLeaseRejection(err)).toBe(false);
  });
});
