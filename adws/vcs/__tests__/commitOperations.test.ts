import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('../../core', () => ({ log: vi.fn() }));

import { execSync } from 'child_process';
import { getHeadTreeHash, hasUncommittedChanges, pushBranch } from '../commitOperations';

const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  mockExecSync.mockReset();
});

// ── getHeadTreeHash ────────────────────────────────────────────────────────────

describe('getHeadTreeHash', () => {
  it('returns the trimmed execSync output', () => {
    mockExecSync.mockReturnValueOnce('abc123def456\n');

    const result = getHeadTreeHash('/repo');

    expect(result).toBe('abc123def456');
  });

  it('calls git rev-parse "HEAD^{tree}" with the provided cwd', () => {
    mockExecSync.mockReturnValueOnce('abc123\n');

    getHeadTreeHash('/my/repo');

    expect(mockExecSync).toHaveBeenCalledWith(
      'git rev-parse "HEAD^{tree}"',
      { encoding: 'utf-8', cwd: '/my/repo' },
    );
  });

  it('passes cwd as undefined when not provided', () => {
    mockExecSync.mockReturnValueOnce('def456\n');

    getHeadTreeHash();

    expect(mockExecSync).toHaveBeenCalledWith(
      'git rev-parse "HEAD^{tree}"',
      { encoding: 'utf-8', cwd: undefined },
    );
  });
});

// ── hasUncommittedChanges ──────────────────────────────────────────────────────

describe('hasUncommittedChanges', () => {
  it('returns true for non-empty porcelain output', () => {
    mockExecSync.mockReturnValueOnce(' M src/foo.ts\n');

    expect(hasUncommittedChanges('/repo')).toBe(true);
  });

  it('returns false for empty output', () => {
    mockExecSync.mockReturnValueOnce('');

    expect(hasUncommittedChanges('/repo')).toBe(false);
  });

  it('returns false for whitespace-only output', () => {
    mockExecSync.mockReturnValueOnce('   \n  ');

    expect(hasUncommittedChanges('/repo')).toBe(false);
  });

  it('calls git status --porcelain with the provided cwd', () => {
    mockExecSync.mockReturnValueOnce('');

    hasUncommittedChanges('/my/repo');

    expect(mockExecSync).toHaveBeenCalledWith(
      'git status --porcelain',
      { encoding: 'utf-8', cwd: '/my/repo' },
    );
  });

  it('passes cwd as undefined when not provided', () => {
    mockExecSync.mockReturnValueOnce('');

    hasUncommittedChanges();

    expect(mockExecSync).toHaveBeenCalledWith(
      'git status --porcelain',
      { encoding: 'utf-8', cwd: undefined },
    );
  });
});

// ── pushBranch ─────────────────────────────────────────────────────────────────

describe('pushBranch', () => {
  it('issues fetch then force-with-lease push with provided cwd', async () => {
    mockExecSync.mockReturnValueOnce('').mockReturnValueOnce('');

    pushBranch('feature-x', '/repo');

    expect(mockExecSync).toHaveBeenNthCalledWith(
      1,
      'git fetch origin "feature-x"',
      { stdio: 'pipe', cwd: '/repo' },
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      'git push --force-with-lease --force-if-includes -u origin "feature-x"',
      { stdio: 'pipe', cwd: '/repo' },
    );
  });

  it('passes cwd as undefined when not provided', async () => {
    mockExecSync.mockReturnValueOnce('').mockReturnValueOnce('');

    pushBranch('feature-x');

    expect(mockExecSync).toHaveBeenNthCalledWith(
      1,
      'git fetch origin "feature-x"',
      { stdio: 'pipe', cwd: undefined },
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      'git push --force-with-lease --force-if-includes -u origin "feature-x"',
      { stdio: 'pipe', cwd: undefined },
    );
  });

  it('push command includes --force-with-lease (recovery mechanism)', async () => {
    mockExecSync.mockReturnValueOnce('').mockReturnValueOnce('');

    pushBranch('feature-x', '/repo');

    const pushCall = mockExecSync.mock.calls[1][0] as string;
    expect(pushCall).toContain('--force-with-lease');
  });

  it('tolerates a fetch failure (first push — no remote ref)', () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('fatal: no such remote ref feature-x'); })
      .mockReturnValueOnce('');

    expect(() => pushBranch('feature-x', '/repo')).not.toThrow();
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it('throws a distinct lease error on stale-info rejection', () => {
    const leaseError = Object.assign(new Error('push rejected'), {
      stderr: ' ! [rejected] feature-x -> feature-x (stale info)',
    });
    mockExecSync
      .mockReturnValueOnce('')
      .mockImplementationOnce(() => { throw leaseError; });

    let thrown: Error | undefined;
    try { pushBranch('feature-x', '/repo'); } catch (e) { thrown = e as Error; }
    expect(thrown?.message).toMatch(/force-with-lease/);
    expect(thrown?.message).toMatch(/moved underneath/i);
  });

  it('throws a distinct lease error on remote-ref-updated-since-checkout rejection', () => {
    const leaseError = Object.assign(new Error('push rejected'), {
      stderr: ' ! [rejected] feature-x -> feature-x (remote ref updated since checkout)',
    });
    mockExecSync
      .mockReturnValueOnce('')
      .mockImplementationOnce(() => { throw leaseError; });

    let thrown: Error | undefined;
    try { pushBranch('feature-x', '/repo'); } catch (e) { thrown = e as Error; }
    expect(thrown?.message).toMatch(/force-with-lease/);
    expect(thrown?.message).toMatch(/manual/i);
  });

  it('rethrows non-lease errors without lease wording', () => {
    const networkError = new Error('fatal: unable to access: Could not resolve host: github.com');
    mockExecSync
      .mockReturnValueOnce('')
      .mockImplementationOnce(() => { throw networkError; });

    let thrown: Error | undefined;
    try { pushBranch('feature-x', '/repo'); } catch (e) { thrown = e as Error; }
    expect(thrown?.message).toContain('Could not resolve host');
    expect(thrown?.message).not.toMatch(/force-with-lease/);
  });
});
