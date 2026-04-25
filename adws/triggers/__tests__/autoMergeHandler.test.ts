import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../core', () => ({
  log: vi.fn(),
  MAX_AUTO_MERGE_ATTEMPTS: 3,
}));

vi.mock('../../github', () => ({
  mergePR: vi.fn(),
}));

vi.mock('../../agents', () => ({
  runClaudeAgentWithCommand: vi.fn().mockResolvedValue({ success: true, output: '' }),
}));

import { mergePR } from '../../github';
import { runClaudeAgentWithCommand } from '../../agents';
import { isMergeConflictError, mergeWithConflictResolution } from '../autoMergeHandler';

const REPO_INFO = { owner: 'acme', repo: 'widgets' };
const HEAD_BRANCH = 'feature-issue-42';
const BASE_BRANCH = 'main';
const WORKTREE = '/worktrees/feature-issue-42';
const ADW_ID = 'test-adw-id';
const LOGS_DIR = '/logs/test-adw-id';
const SPEC_PATH = '';
const MAX_ATTEMPTS = 3;

const NOT_MERGEABLE = 'Pull request acme/widgets#7 is not mergeable: the merge commit cannot be cleanly created.';

const mockedExecSync = vi.mocked(execSync);
const mockedMergePR = vi.mocked(mergePR);
const mockedAgent = vi.mocked(runClaudeAgentWithCommand);

function makeConflictingExecSync(): void {
  mockedExecSync.mockImplementation((cmd) => {
    const c = String(cmd);
    if (c.includes('merge --no-commit --no-ff')) throw Object.assign(new Error('CONFLICT (content)'), { status: 1 });
    if (c.includes('--no-edit')) throw Object.assign(new Error('CONFLICT'), { status: 1 });
    return '';
  });
}

beforeEach(() => {
  mockedExecSync.mockReset();
  mockedMergePR.mockReset();
  mockedAgent.mockReset();
  mockedExecSync.mockReturnValue('');
  mockedMergePR.mockReturnValue({ success: true });
  mockedAgent.mockResolvedValue({ success: true, output: '' });
});

// ─────────────────────────────────────────────────────────────────────────
// isMergeConflictError — keyword contract
// ─────────────────────────────────────────────────────────────────────────

describe('isMergeConflictError', () => {
  it('returns true for the GitHub "not mergeable: the merge commit cannot be cleanly created" string', () => {
    expect(isMergeConflictError(NOT_MERGEABLE)).toBe(true);
  });

  it('returns true for "merge conflict" substring', () => {
    expect(isMergeConflictError('merge conflict in file.txt')).toBe(true);
  });

  it('returns true for "dirty" substring', () => {
    expect(isMergeConflictError('working tree dirty')).toBe(true);
  });

  it('returns true for "behind" substring', () => {
    expect(isMergeConflictError('branch is behind')).toBe(true);
  });

  it('returns true for bare "conflict" substring', () => {
    expect(isMergeConflictError('conflict detected')).toBe(true);
  });

  it('returns false for an unrelated error', () => {
    expect(isMergeConflictError('HTTP 500: server error')).toBe(false);
  });

  it('returns true for uppercase input (lowercase invariance)', () => {
    expect(isMergeConflictError('IS NOT MERGEABLE')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// mergeWithConflictResolution — orchestration
// ─────────────────────────────────────────────────────────────────────────

describe('mergeWithConflictResolution', () => {
  it('invokes resolveConflictsViaAgent when the dry-run reports conflicts', async () => {
    makeConflictingExecSync();

    await mergeWithConflictResolution(7, REPO_INFO, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH);

    expect(mockedAgent).toHaveBeenCalledWith(
      '/resolve_conflict',
      expect.any(Array),
      'conflict-resolver',
      expect.any(String),
      'sonnet',
      undefined,
      undefined,
      undefined,
      WORKTREE,
    );
  });

  it('does not break out of the retry loop when gh returns "not mergeable" (loop continues)', async () => {
    // does not break — loop continues until attempt 2 succeeds
    mockedMergePR
      .mockReturnValueOnce({ success: false, error: NOT_MERGEABLE })
      .mockReturnValueOnce({ success: true });

    const result = await mergeWithConflictResolution(7, REPO_INFO, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH);

    expect(result.success).toBe(true);
    expect(mockedMergePR).toHaveBeenCalledTimes(2); // does not break after first failure
  });

  it('remote-base-diverged-from-local-worktree: resolveConflictsViaAgent is invoked after sync reveals conflict', async () => {
    // remote-base-diverged-from-local-worktree scenario:
    // After syncWorktreeToOriginHead pulls new commits from origin/<headBranch>,
    // the dry-run detects a conflict that was invisible before the sync.
    makeConflictingExecSync();

    const result = await mergeWithConflictResolution(7, REPO_INFO, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH);

    expect(result.success).toBe(true);
    expect(mockedAgent).toHaveBeenCalledWith(
      '/resolve_conflict',
      expect.any(Array),
      'conflict-resolver',
      expect.any(String),
      'sonnet',
      undefined,
      undefined,
      undefined,
      WORKTREE,
    );
  });

  it('returns failure with last error when the agent fails on every attempt', async () => {
    makeConflictingExecSync();
    mockedAgent.mockResolvedValue({ success: false, output: 'Agent failed to resolve conflict' });

    const result = await mergeWithConflictResolution(7, REPO_INFO, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH);

    expect(result.success).toBe(false);
    expect(mockedAgent).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('begins with git fetch and git reset for the head branch before any git merge call', async () => {
    const calls: string[] = [];
    mockedExecSync.mockImplementation((cmd) => {
      calls.push(String(cmd));
      return '';
    });

    await mergeWithConflictResolution(7, REPO_INFO, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH);

    expect(calls[0]).toContain(`git fetch origin "${HEAD_BRANCH}"`);
    expect(calls[1]).toContain(`git reset --hard "origin/${HEAD_BRANCH}"`);
    const firstMergeIdx = calls.findIndex((c) => c.includes('git merge'));
    expect(firstMergeIdx).toBeGreaterThan(1);
  });
});
