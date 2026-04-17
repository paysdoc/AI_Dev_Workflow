import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execWithRetry } from '../utils';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../logger', () => ({
  log: vi.fn(),
}));

vi.mock('../environment', () => ({
  LOGS_DIR: '/tmp/test-logs',
}));

// Disable Atomics.wait so tests don't actually sleep
vi.stubGlobal('Atomics', {
  wait: vi.fn(),
});

import { execSync } from 'child_process';
const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  mockExecSync.mockReset();
});

describe('execWithRetry — non-retryable pattern detection', () => {
  it('throws immediately on "is not mergeable" error without retrying', () => {
    const err = new Error('GraphQL: is not mergeable');
    mockExecSync.mockImplementation(() => { throw err; });

    expect(() => execWithRetry('gh pr merge 1')).toThrow('is not mergeable');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on "No commits between" error without retrying', () => {
    const err = new Error('pull request create failed: No commits between main and feature');
    mockExecSync.mockImplementation(() => { throw err; });

    expect(() => execWithRetry('gh pr create')).toThrow('No commits between');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on "already exists" error without retrying', () => {
    const err = new Error('a pull request for branch "feature-x" already exists');
    mockExecSync.mockImplementation(() => { throw err; });

    expect(() => execWithRetry('gh pr create')).toThrow('already exists');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('matches non-retryable pattern as substring of longer message', () => {
    const err = new Error('Command failed: gh pr merge 42\nis not mergeable: conflicts exist');
    mockExecSync.mockImplementation(() => { throw err; });

    expect(() => execWithRetry('gh pr merge 42')).toThrow();
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  // Auth error non-retryable patterns (issue #434)
  it('throws immediately on "gh auth login" error without retrying', () => {
    const err = new Error('To authenticate, please run: gh auth login');
    mockExecSync.mockImplementation(() => { throw err; });

    expect(() => execWithRetry('gh pr review 1 --approve')).toThrow('gh auth login');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on "HTTP 401" error without retrying', () => {
    const err = new Error('HTTP 401: Unauthorized');
    mockExecSync.mockImplementation(() => { throw err; });

    expect(() => execWithRetry('gh pr review 1 --approve')).toThrow('HTTP 401');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on "Bad credentials" error without retrying', () => {
    const err = new Error('GraphQL: Bad credentials (401)');
    mockExecSync.mockImplementation(() => { throw err; });

    expect(() => execWithRetry('gh pr review 1 --approve')).toThrow('Bad credentials');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on "authentication" error without retrying', () => {
    const err = new Error('authentication required: token expired');
    mockExecSync.mockImplementation(() => { throw err; });

    expect(() => execWithRetry('gh pr review 1 --approve')).toThrow('authentication');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on "GH_TOKEN" error without retrying', () => {
    const err = new Error('GH_TOKEN not found or invalid');
    mockExecSync.mockImplementation(() => { throw err; });

    expect(() => execWithRetry('gh pr review 1 --approve')).toThrow('GH_TOKEN');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });
});

describe('execWithRetry — transient error retries', () => {
  it('retries transient errors up to maxAttempts (default 3)', () => {
    const transientErr = new Error('network timeout');
    mockExecSync
      .mockImplementationOnce(() => { throw transientErr; })
      .mockImplementationOnce(() => { throw transientErr; })
      .mockImplementationOnce(() => { throw transientErr; });

    expect(() => execWithRetry('gh pr list')).toThrow('network timeout');
    expect(mockExecSync).toHaveBeenCalledTimes(3);
  });

  it('returns output when command succeeds after transient failures', () => {
    const transientErr = new Error('network timeout');
    mockExecSync
      .mockImplementationOnce(() => { throw transientErr; })
      .mockImplementationOnce(() => { throw transientErr; })
      .mockReturnValueOnce('success output\n');

    const result = execWithRetry('gh pr list');
    expect(result).toBe('success output');
    expect(mockExecSync).toHaveBeenCalledTimes(3);
  });

  it('respects custom maxAttempts option', () => {
    const transientErr = new Error('network timeout');
    mockExecSync.mockImplementation(() => { throw transientErr; });

    expect(() => execWithRetry('gh pr list', { maxAttempts: 2 })).toThrow();
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });
});

describe('execWithRetry — successful execution', () => {
  it('returns trimmed stdout on first attempt', () => {
    mockExecSync.mockReturnValueOnce('  hello world  \n');

    const result = execWithRetry('echo hello');
    expect(result).toBe('hello world');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });
});
