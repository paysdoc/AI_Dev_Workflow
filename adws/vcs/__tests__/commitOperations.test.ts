import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('fs', () => ({
  mkdtempSync: vi.fn(),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
  rmSync: vi.fn(),
}));
vi.mock('os', () => ({ tmpdir: vi.fn(() => '/tmp') }));
vi.mock('../../core', () => ({ log: vi.fn() }));

import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'fs';
import { log } from '../../core';
import { commitAndPushKpiFile } from '../commitOperations';

const mockExecSync = vi.mocked(execSync);
const mockMkdtempSync = vi.mocked(mkdtempSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockCopyFileSync = vi.mocked(copyFileSync);
const mockRmSync = vi.mocked(rmSync);
const mockLog = vi.mocked(log);

beforeEach(() => {
  mockExecSync.mockReset();
  mockMkdtempSync.mockReset();
  mockMkdirSync.mockReset();
  mockCopyFileSync.mockReset();
  mockRmSync.mockReset();
  mockLog.mockReset();
});

const TMPDIR = '/tmp/adw-kpi-abc';

function mockHappyPath(tmpdir = TMPDIR): void {
  mockMkdtempSync.mockReturnValue(tmpdir);
  mockExecSync
    .mockReturnValueOnce(' M app_docs/agentic_kpis.md\n') // status --porcelain
    .mockReturnValueOnce('dev\n')                          // gh repo view (getDefaultBranch)
    .mockReturnValueOnce('')                               // git fetch origin "dev"
    .mockReturnValueOnce('')                               // git worktree add --detach
    .mockReturnValueOnce('')                               // git add
    .mockReturnValueOnce('')                               // git commit
    .mockReturnValueOnce('')                               // git push origin HEAD:"dev"
    .mockReturnValueOnce('');                              // git worktree remove --force
}

// ── No-op when no changes ──────────────────────────────────────────────────────

describe('no-op when no changes', () => {
  it('returns false when status --porcelain output is empty', () => {
    mockExecSync.mockReturnValueOnce('');

    const result = commitAndPushKpiFile();

    expect(result).toBe(false);
    expect(mockLog).toHaveBeenCalledWith('No KPI file changes to commit', 'info');
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes('gh repo view'))).toBe(false);
    expect(calls.some((c) => c.includes('git fetch'))).toBe(false);
    expect(calls.some((c) => c.includes('git worktree add'))).toBe(false);
    expect(mockMkdtempSync).not.toHaveBeenCalled();
  });
});

// ── Happy path — correct command sequence ──────────────────────────────────────

describe('happy path — correct command sequence', () => {
  it('runs status, gh repo view, fetch, worktree add --detach, copy, add, commit, push, remove in order', () => {
    mockHappyPath();

    const result = commitAndPushKpiFile('/repo');

    expect(result).toBe(true);
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toMatch(/git status --porcelain/);
    expect(calls[1]).toMatch(/gh repo view/);
    expect(calls[2]).toBe('git fetch origin "dev"');
    expect(calls[3]).toMatch(/git worktree add --detach.*origin\/dev/);
    expect(calls[4]).toMatch(/git add/);
    expect(calls[5]).toMatch(/git commit/);
    expect(calls[6]).toBe('git push origin HEAD:"dev"');
    expect(calls[7]).toMatch(/git worktree remove --force/);

    expect(mockCopyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('app_docs/agentic_kpis.md'),
      expect.stringContaining(TMPDIR),
    );
    expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining(TMPDIR), { recursive: true });
  });

  it('uses --detach flag on worktree add', () => {
    mockHappyPath();

    commitAndPushKpiFile('/repo');

    const worktreeCall = mockExecSync.mock.calls.map((c) => c[0] as string).find((c) => c.includes('git worktree add'));
    expect(worktreeCall).toMatch(/--detach/);
  });

  it('pushes via HEAD:<defaultBranch> refspec, not -u', () => {
    mockHappyPath();

    commitAndPushKpiFile('/repo');

    const pushCall = mockExecSync.mock.calls.map((c) => c[0] as string).find((c) => c.includes('git push'));
    expect(pushCall).toContain('HEAD:"dev"');
    expect(pushCall).not.toContain('-u');
  });
});

// ── Cleanup runs on success and failure ───────────────────────────────────────

describe('cleanup runs on success and failure', () => {
  it('calls git worktree remove --force with the temp path on the happy path', () => {
    mockHappyPath();

    commitAndPushKpiFile();

    const removeCalls = mockExecSync.mock.calls.map((c) => c[0] as string).filter((c) => c.includes('git worktree remove --force'));
    expect(removeCalls.length).toBeGreaterThan(0);
    expect(removeCalls[0]).toContain(TMPDIR);
  });

  it('calls git worktree remove --force even when git commit throws', () => {
    mockMkdtempSync.mockReturnValue(TMPDIR);
    mockExecSync
      .mockReturnValueOnce(' M app_docs/agentic_kpis.md\n') // status
      .mockReturnValueOnce('dev\n')                          // gh repo view
      .mockReturnValueOnce('')                               // fetch
      .mockReturnValueOnce('')                               // worktree add
      .mockReturnValueOnce('')                               // git add
      .mockImplementationOnce(() => { throw new Error('commit failed'); }) // git commit
      .mockReturnValueOnce('');                              // git worktree remove

    commitAndPushKpiFile();

    const removeCalls = mockExecSync.mock.calls.map((c) => c[0] as string).filter((c) => c.includes('git worktree remove --force'));
    expect(removeCalls.length).toBeGreaterThan(0);
  });

  it('calls git worktree remove --force even when git push throws', () => {
    mockMkdtempSync.mockReturnValue(TMPDIR);
    mockExecSync
      .mockReturnValueOnce(' M app_docs/agentic_kpis.md\n') // status
      .mockReturnValueOnce('dev\n')                          // gh repo view
      .mockReturnValueOnce('')                               // fetch
      .mockReturnValueOnce('')                               // worktree add
      .mockReturnValueOnce('')                               // git add
      .mockReturnValueOnce('')                               // git commit
      .mockImplementationOnce(() => { throw new Error('push failed'); })  // git push
      .mockReturnValueOnce('');                              // git worktree remove

    commitAndPushKpiFile();

    const removeCalls = mockExecSync.mock.calls.map((c) => c[0] as string).filter((c) => c.includes('git worktree remove --force'));
    expect(removeCalls.length).toBeGreaterThan(0);
  });

  it('swallows errors from git worktree remove --force', () => {
    mockMkdtempSync.mockReturnValue(TMPDIR);
    mockExecSync
      .mockReturnValueOnce(' M app_docs/agentic_kpis.md\n') // status
      .mockReturnValueOnce('dev\n')                          // gh repo view
      .mockReturnValueOnce('')                               // fetch
      .mockReturnValueOnce('')                               // worktree add
      .mockReturnValueOnce('')                               // git add
      .mockReturnValueOnce('')                               // git commit
      .mockImplementationOnce(() => { throw new Error('push failed'); })    // git push
      .mockImplementationOnce(() => { throw new Error('remove failed'); }); // git worktree remove

    const result = commitAndPushKpiFile();

    expect(result).toBe(false);
  });

  it('calls fs.rmSync on the temp path as a belt-and-braces cleanup', () => {
    mockHappyPath();

    commitAndPushKpiFile();

    expect(mockRmSync).toHaveBeenCalledWith(TMPDIR, { recursive: true, force: true });
  });
});

// ── Non-fatal on failure ───────────────────────────────────────────────────────

describe('non-fatal on failure', () => {
  it('returns false and logs error when getDefaultBranch throws (gh CLI absent)', () => {
    mockExecSync
      .mockReturnValueOnce(' M app_docs/agentic_kpis.md\n') // status
      .mockImplementationOnce(() => { throw new Error('gh: command not found'); }); // gh repo view

    const result = commitAndPushKpiFile();

    expect(result).toBe(false);
    expect(mockLog).toHaveBeenCalledWith(expect.stringContaining('Failed to commit KPI file'), 'error');
  });

  it('returns false and logs error when git fetch fails', () => {
    mockExecSync
      .mockReturnValueOnce(' M app_docs/agentic_kpis.md\n') // status
      .mockReturnValueOnce('dev\n')                          // gh repo view
      .mockImplementationOnce(() => { throw new Error('network error'); }); // git fetch

    const result = commitAndPushKpiFile();

    expect(result).toBe(false);
    expect(mockMkdtempSync).not.toHaveBeenCalled();
    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes('git worktree add'))).toBe(false);
  });

  it('returns false and logs error when git worktree add fails', () => {
    mockMkdtempSync.mockReturnValue(TMPDIR);
    mockExecSync
      .mockReturnValueOnce(' M app_docs/agentic_kpis.md\n') // status
      .mockReturnValueOnce('dev\n')                          // gh repo view
      .mockReturnValueOnce('')                               // fetch
      .mockImplementationOnce(() => { throw new Error('worktree add failed'); }); // worktree add

    const result = commitAndPushKpiFile();

    expect(result).toBe(false);
    expect(mockRmSync).toHaveBeenCalledWith(TMPDIR, { recursive: true, force: true });
  });

  it('returns false and logs error when git push fails', () => {
    mockMkdtempSync.mockReturnValue(TMPDIR);
    mockExecSync
      .mockReturnValueOnce(' M app_docs/agentic_kpis.md\n') // status
      .mockReturnValueOnce('dev\n')                          // gh repo view
      .mockReturnValueOnce('')                               // fetch
      .mockReturnValueOnce('')                               // worktree add
      .mockReturnValueOnce('')                               // git add
      .mockReturnValueOnce('')                               // git commit
      .mockImplementationOnce(() => { throw new Error('push failed'); })  // git push
      .mockReturnValueOnce('');                              // git worktree remove

    const result = commitAndPushKpiFile();

    expect(result).toBe(false);
    const removeCalls = mockExecSync.mock.calls.map((c) => c[0] as string).filter((c) => c.includes('git worktree remove --force'));
    expect(removeCalls.length).toBeGreaterThan(0);
  });
});

// ── Target-branch correctness (regression gate) ───────────────────────────────

describe('target-branch correctness', () => {
  it('pushes to the default branch returned by getDefaultBranch, not the current branch', () => {
    mockMkdtempSync.mockReturnValue(TMPDIR);
    mockExecSync
      .mockReturnValueOnce(' M app_docs/agentic_kpis.md\n') // status
      .mockReturnValueOnce('main\n')                         // gh repo view → 'main'
      .mockReturnValueOnce('')                               // fetch
      .mockReturnValueOnce('')                               // worktree add
      .mockReturnValueOnce('')                               // git add
      .mockReturnValueOnce('')                               // git commit
      .mockReturnValueOnce('')                               // git push
      .mockReturnValueOnce('');                              // git worktree remove

    commitAndPushKpiFile();

    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    const pushCall = calls.find((c) => c.startsWith('git push'));
    expect(pushCall).toBe('git push origin HEAD:"main"');
    expect(calls.some((c) => c.includes('git push origin "') && !c.includes('HEAD:'))).toBe(false);
  });

  it('never calls git branch --show-current', () => {
    mockHappyPath();

    commitAndPushKpiFile();

    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => /git branch --show-current/.test(c))).toBe(false);
  });
});
