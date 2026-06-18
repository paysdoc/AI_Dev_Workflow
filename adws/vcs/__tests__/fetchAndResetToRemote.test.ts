import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('../../core', () => ({ log: vi.fn() }));

import { execSync } from 'child_process';
import { fetchAndResetToRemote } from '../branchOperations';

const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  mockExecSync.mockReset();
});

// ── Order & exact commands for a claim branch ─────────────────────────────────

describe('fetchAndResetToRemote — order and exact commands for a claim branch', () => {
  it('issues git fetch origin then git reset --hard in that order for an arbitrary claim branch', () => {
    mockExecSync
      .mockReturnValueOnce('') // fetch
      .mockReturnValueOnce(''); // reset --hard

    fetchAndResetToRemote('adw-upgrade-deadbeef', '/wt');

    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toBe('git fetch origin "adw-upgrade-deadbeef"');
    expect(calls[1]).toBe('git reset --hard "origin/adw-upgrade-deadbeef"');
    expect(calls).toHaveLength(2);
  });

  it('passes cwd to both git commands', () => {
    mockExecSync
      .mockReturnValueOnce('')
      .mockReturnValueOnce('');

    fetchAndResetToRemote('adw-upgrade-deadbeef', '/wt');

    for (const call of mockExecSync.mock.calls) {
      expect((call[1] as { cwd?: string }).cwd).toBe('/wt');
    }
  });
});

// ── Throws on fetch failure, skips reset ─────────────────────────────────────

describe('fetchAndResetToRemote — throws on fetch failure and skips reset', () => {
  it('throws /Failed to fetch origin\\//' , () => {
    mockExecSync.mockImplementationOnce(() => { throw new Error('network unreachable'); });

    expect(() => fetchAndResetToRemote('adw-upgrade-deadbeef', '/wt')).toThrow(
      /Failed to fetch origin\//,
    );
  });

  it('does not call git reset --hard when fetch fails', () => {
    mockExecSync.mockImplementationOnce(() => { throw new Error('offline'); });

    try { fetchAndResetToRemote('adw-upgrade-deadbeef', '/wt'); } catch { /* expected */ }

    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls.every((c) => !c.includes('reset --hard'))).toBe(true);
  });
});

// ── Throws on reset failure ───────────────────────────────────────────────────

describe('fetchAndResetToRemote — throws on reset failure', () => {
  it('throws /Failed to reset to origin\\//' , () => {
    mockExecSync
      .mockReturnValueOnce('') // fetch ok
      .mockImplementationOnce(() => { throw new Error('reset conflict'); });

    expect(() => fetchAndResetToRemote('adw-upgrade-deadbeef', '/wt')).toThrow(
      /Failed to reset to origin\//,
    );
  });
});
