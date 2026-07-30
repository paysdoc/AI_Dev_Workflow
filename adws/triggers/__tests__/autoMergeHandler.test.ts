import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../../github/gitContextFactory', () => ({
  gitContextForRepo: vi.fn(),
}));

import { mergePR } from '../../github';
import { runClaudeAgentWithCommand } from '../../agents';
import { isMergeConflictError, mergeWithConflictResolution } from '../autoMergeHandler';
import { GitContext } from '../../gitContext/gitContext';
import type { ExecFn } from '../../gitContext/types';

const REPO_INFO = { owner: 'acme', repo: 'widgets' };
const HEAD_BRANCH = 'feature-issue-42';
const BASE_BRANCH = 'main';
const WORKTREE = '/worktrees/feature-issue-42';
const ADW_ID = 'test-adw-id';
const LOGS_DIR = '/logs/test-adw-id';
const SPEC_PATH = '';
const MAX_ATTEMPTS = 3;

const NOT_MERGEABLE = 'Pull request acme/widgets#7 is not mergeable: the merge commit cannot be cleanly created.';

const mockedMergePR = vi.mocked(mergePR);
const mockedAgent = vi.mocked(runClaudeAgentWithCommand);

interface SpyCall {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

function makeSpyExec(
  stdout = '',
  conflictOnMerge = false,
): { exec: ExecFn; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const exec: ExecFn = (command, options) => {
    calls.push({ command, cwd: options.cwd, env: options.env });
    if (conflictOnMerge && command.includes('git merge') && (command.includes('--no-commit') || command.includes('--no-edit'))) {
      throw Object.assign(new Error('CONFLICT (content)'), { status: 1 });
    }
    return stdout;
  };
  return { exec, calls };
}

function makeGitContext(exec: ExecFn): GitContext {
  return new GitContext(
    {
      owner: 'acme',
      repo: 'widgets',
      selfHost: false,
      token: 'test-token',
      gitIdentity: {
        authorName: 'ADW Bot',
        authorEmail: 'bot@adw.dev',
        committerName: 'ADW Bot',
        committerEmail: 'bot@adw.dev',
      },
      frameworkRepoRoot: '/srv/adw/framework',
      targetReposDir: '/srv/adw/repos',
    },
    { exec },
  );
}

beforeEach(() => {
  mockedMergePR.mockReset();
  mockedAgent.mockReset();
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
    const { exec } = makeSpyExec('', true);
    const ctx = makeGitContext(exec);

    await mergeWithConflictResolution(7, REPO_INFO, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx);

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
      undefined,
      undefined,
      undefined,
      { selfHost: false, adwId: ADW_ID },
    );
  });

  it('does not break out of the retry loop when gh returns "not mergeable" (loop continues)', async () => {
    const { exec } = makeSpyExec('');
    const ctx = makeGitContext(exec);
    mockedMergePR
      .mockReturnValueOnce({ success: false, error: NOT_MERGEABLE })
      .mockReturnValueOnce({ success: true });

    const result = await mergeWithConflictResolution(7, REPO_INFO, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx);

    expect(result.success).toBe(true);
    expect(mockedMergePR).toHaveBeenCalledTimes(2);
  });

  it('remote-base-diverged-from-local-worktree: resolveConflictsViaAgent is invoked after sync reveals conflict', async () => {
    const { exec } = makeSpyExec('', true);
    const ctx = makeGitContext(exec);

    const result = await mergeWithConflictResolution(7, REPO_INFO, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx);

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
      undefined,
      undefined,
      undefined,
      { selfHost: false, adwId: ADW_ID },
    );
  });

  it('returns failure with last error when the agent fails on every attempt', async () => {
    const { exec } = makeSpyExec('', true);
    const ctx = makeGitContext(exec);
    mockedAgent.mockResolvedValue({ success: false, output: 'Agent failed to resolve conflict' });

    const result = await mergeWithConflictResolution(7, REPO_INFO, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx);

    expect(result.success).toBe(false);
    expect(mockedAgent).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('begins with git fetch and git reset for the head branch before any git merge call', async () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = makeGitContext(exec);

    await mergeWithConflictResolution(7, REPO_INFO, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx);

    const commands = calls.map((c) => c.command);
    expect(commands[0]).toContain(`git fetch origin "${HEAD_BRANCH}"`);
    expect(commands[1]).toContain(`git reset --hard "origin/${HEAD_BRANCH}"`);
    const firstMergeIdx = commands.findIndex((c) => c.includes('git merge'));
    expect(firstMergeIdx).toBeGreaterThan(1);
  });
});
