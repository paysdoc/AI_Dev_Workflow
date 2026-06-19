import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('../../core', () => ({ log: vi.fn() }));

import { execSync } from 'child_process';
import { getHeadTreeHash, hasUncommittedChanges } from '../commitOperations';

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
