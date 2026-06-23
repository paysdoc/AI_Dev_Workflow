/**
 * Tests re-homed from vcs/branchOperations.ts fetchAndResetToRemote onto
 * the GitContext branchOps module (#662).
 * Uses the injected-runner pattern so no child_process mock is needed.
 */

import { describe, it, expect } from 'vitest';
import { branchOps } from '../../gitContext/branchOps';

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

// ── Order & exact commands ───────────────────────────────────────────────────

describe('fetchAndResetToRemote — order and exact commands', () => {
  it('issues git fetch origin then git reset --hard in that order', () => {
    const { run, calls } = makeRunner();
    branchOps.fetchAndResetToRemote(run, 'adw-upgrade-deadbeef', '/wt');
    expect(calls[0].command).toBe('git fetch origin "adw-upgrade-deadbeef"');
    expect(calls[1].command).toBe('git reset --hard "origin/adw-upgrade-deadbeef"');
    expect(calls).toHaveLength(2);
  });

  it('passes cwd to both git commands', () => {
    const { run, calls } = makeRunner();
    branchOps.fetchAndResetToRemote(run, 'adw-upgrade-deadbeef', '/wt');
    expect(calls[0].cwd).toBe('/wt');
    expect(calls[1].cwd).toBe('/wt');
  });
});

// ── Throws on fetch failure ──────────────────────────────────────────────────

describe('fetchAndResetToRemote — throws on fetch failure and skips reset', () => {
  it('throws with /Failed to fetch origin\\//', () => {
    const run = (cmd: string, _cwd: string): string => {
      if (cmd.includes('fetch')) throw new Error('network unreachable');
      return '';
    };
    expect(() => branchOps.fetchAndResetToRemote(run, 'adw-upgrade-deadbeef', '/wt')).toThrow(
      /Failed to fetch origin\//,
    );
  });

  it('does not call git reset --hard when fetch fails', () => {
    const cmds: string[] = [];
    const run = (cmd: string, _cwd: string): string => {
      cmds.push(cmd);
      if (cmd.includes('fetch')) throw new Error('offline');
      return '';
    };
    try { branchOps.fetchAndResetToRemote(run, 'adw-upgrade-deadbeef', '/wt'); } catch { /* expected */ }
    expect(cmds.every((c) => !c.includes('reset --hard'))).toBe(true);
  });
});

// ── Throws on reset failure ──────────────────────────────────────────────────

describe('fetchAndResetToRemote — throws on reset failure', () => {
  it('throws with /Failed to reset to origin\\//', () => {
    const run = (cmd: string, _cwd: string): string => {
      if (cmd.includes('reset')) throw new Error('reset conflict');
      return '';
    };
    expect(() => branchOps.fetchAndResetToRemote(run, 'adw-upgrade-deadbeef', '/wt')).toThrow(
      /Failed to reset to origin\//,
    );
  });
});
