import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core', () => ({
  log: vi.fn(),
  MAX_AUTO_MERGE_ATTEMPTS: 3,
}));

vi.mock('../../agents', () => ({
  runClaudeAgentWithCommand: vi.fn().mockResolvedValue({ success: true, output: '' }),
}));

vi.mock('../../core/localRepoIdentity', () => ({ readLocalRepoIdentity: vi.fn() }));

import { runClaudeAgentWithCommand } from '../../agents';
import { readLocalRepoIdentity } from '../../core/localRepoIdentity';
import { getModelForCommand, getEffortForCommand } from '../../core/modelRouting';
import { resetFrameworkIdentityMemo } from '../../core/selfHostLaunch';
import { mergeWithConflictResolution } from '../autoMergeHandler';
import { makeSpyExec, makeGitContext } from './fixtures/autoMergeHandlerHarness';
import type { ExecFn } from '@paysdoc/devplatform/git';
import { Platform, type CodeHost, type ForgeActionResult } from '@paysdoc/devplatform';

const HEAD_BRANCH = 'feature-issue-42';
const BASE_BRANCH = 'main';
const WORKTREE = '/worktrees/feature-issue-42';
const ADW_ID = 'test-adw-id';
const LOGS_DIR = '/logs/test-adw-id';
const SPEC_PATH = '';
const MAX_ATTEMPTS = 3;

const NOT_MERGEABLE = 'Pull request acme/widgets#7 is not mergeable: the merge commit cannot be cleanly created.';

const mockedMergePullRequest = vi.fn<(prNumber: number) => ForgeActionResult>();
const fakeCodeHost: Pick<CodeHost, 'mergePullRequest'> = { mergePullRequest: mockedMergePullRequest };
const mockedAgent = vi.mocked(runClaudeAgentWithCommand);
const noWait = vi.fn<(ms: number) => Promise<void>>();

beforeEach(() => {
  mockedMergePullRequest.mockReset();
  mockedAgent.mockReset();
  noWait.mockReset();
  mockedMergePullRequest.mockReturnValue({ success: true });
  mockedAgent.mockResolvedValue({ success: true, output: '' });
  noWait.mockResolvedValue(undefined);
  resetFrameworkIdentityMemo();
  vi.mocked(readLocalRepoIdentity).mockReturnValue({ owner: 'paysdoc', repo: 'AI_Dev_Workflow', platform: Platform.GitHub });
});

describe('mergeWithConflictResolution', () => {
  it('invokes resolveConflictsViaAgent when the dry-run reports conflicts', async () => {
    const { exec } = makeSpyExec('', true);
    const ctx = makeGitContext(exec);

    await mergeWithConflictResolution(7, fakeCodeHost, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx, noWait);

    expect(mockedAgent).toHaveBeenCalledWith(
      '/resolve_conflict',
      expect.any(Array),
      'conflict-resolver',
      expect.any(String),
      getModelForCommand('/resolve_conflict'),
      getEffortForCommand('/resolve_conflict'),
      undefined,
      undefined,
      WORKTREE,
      undefined,
      undefined,
      undefined,
      { selfHost: false, adwId: ADW_ID, gitContext: ctx },
    );
  });

  it("starts /resolve_conflict as self-host when the pull request is the framework repository's own", async () => {
    const ctx = makeGitContext(makeSpyExec('', true).exec, 'paysdoc', 'AI_Dev_Workflow');

    await mergeWithConflictResolution(7, fakeCodeHost, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx, noWait);

    expect(mockedAgent.mock.calls[0]?.[12]).toEqual({ selfHost: true, adwId: ADW_ID, gitContext: ctx });
  });

  it('does not break out of the retry loop when gh returns "not mergeable" (loop continues)', async () => {
    const { exec } = makeSpyExec('');
    const ctx = makeGitContext(exec);
    mockedMergePullRequest
      .mockReturnValueOnce({ success: false, error: NOT_MERGEABLE })
      .mockReturnValueOnce({ success: true });

    const result = await mergeWithConflictResolution(7, fakeCodeHost, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx, noWait);

    expect(result.success).toBe(true);
    expect(mockedMergePullRequest).toHaveBeenCalledTimes(2);
    expect(noWait).toHaveBeenCalledTimes(1);
    expect(noWait).toHaveBeenCalledWith(3000);
    expect(mockedAgent).not.toHaveBeenCalled();
  });

  it('remote-base-diverged-from-local-worktree: resolveConflictsViaAgent is invoked after sync reveals conflict', async () => {
    const { exec } = makeSpyExec('', true);
    const ctx = makeGitContext(exec);

    const result = await mergeWithConflictResolution(7, fakeCodeHost, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx, noWait);

    expect(result.success).toBe(true);
    expect(mockedAgent).toHaveBeenCalledWith(
      '/resolve_conflict',
      expect.any(Array),
      'conflict-resolver',
      expect.any(String),
      getModelForCommand('/resolve_conflict'),
      getEffortForCommand('/resolve_conflict'),
      undefined,
      undefined,
      WORKTREE,
      undefined,
      undefined,
      undefined,
      { selfHost: false, adwId: ADW_ID, gitContext: ctx },
    );
  });

  it('returns failure with last error when the agent fails on every attempt', async () => {
    const { exec } = makeSpyExec('', true);
    const ctx = makeGitContext(exec);
    mockedAgent.mockResolvedValue({ success: false, output: 'Agent failed to resolve conflict' });

    const result = await mergeWithConflictResolution(7, fakeCodeHost, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx, noWait);

    expect(result).toMatchObject({ success: false, mergeAttempts: 0, conflictResolutionRan: true, localMergeCheck: 'conflicts' });
    expect(mockedAgent).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  describe('when the local merge check is clean but GitHub refuses the merge', () => {
    const BASE_MODIFIED = 'GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)';

    it.each([BASE_MODIFIED, 'Pull Request has merge conflicts', NOT_MERGEABLE])(
      'treats "%s" as stale: retries after 3 s and 6 s and never runs /resolve_conflict',
      async (staleError) => {
        const ctx = makeGitContext(makeSpyExec('').exec);
        mockedMergePullRequest
          .mockReturnValueOnce({ success: false, error: staleError })
          .mockReturnValueOnce({ success: false, error: staleError })
          .mockReturnValueOnce({ success: true });

        const result = await mergeWithConflictResolution(7, fakeCodeHost, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx, noWait);

        expect(result).toMatchObject({ success: true, mergeAttempts: 3, conflictResolutionRan: false, localMergeCheck: 'clean' });
        expect(mockedAgent).not.toHaveBeenCalled();
        expect(mockedMergePullRequest).toHaveBeenCalledTimes(3);
        expect(noWait.mock.calls).toEqual([[3000], [6000]]);
      },
    );

    it('stops after 5 merge calls once the 3, 6, 12 and 24 s retries are spent, reporting the last error', async () => {
      const ctx = makeGitContext(makeSpyExec('').exec);
      mockedMergePullRequest.mockReturnValue({ success: false, error: BASE_MODIFIED });

      const result = await mergeWithConflictResolution(7, fakeCodeHost, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx, noWait);

      expect(result).toEqual({
        success: false,
        error: BASE_MODIFIED,
        mergeAttempts: 5,
        conflictResolutionRan: false,
        localMergeCheck: 'clean',
      });
      expect(mockedMergePullRequest).toHaveBeenCalledTimes(5);
      expect(noWait.mock.calls).toEqual([[3000], [6000], [12000], [24000]]);
      expect(mockedAgent).not.toHaveBeenCalled();
    });

    it('re-checks the local merge against a fresh fetch of the base branch after every failed merge', async () => {
      const { exec, calls } = makeSpyExec('');
      const ctx = makeGitContext(exec);
      mockedMergePullRequest
        .mockReturnValueOnce({ success: false, error: BASE_MODIFIED })
        .mockReturnValueOnce({ success: true });

      await mergeWithConflictResolution(7, fakeCodeHost, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx, noWait);

      const baseFetches = calls.filter((c) => c.argv[1] === 'fetch' && c.argv[3] === BASE_BRANCH);
      const dryRunMerges = calls.filter((c) => c.argv[1] === 'merge' && c.argv.includes('--no-commit'));
      expect(baseFetches).toHaveLength(2);
      expect(dryRunMerges).toHaveLength(2);
    });

    it('waits on real timers when no wait is injected: 3 s before the second merge call, then 6 s before the third', async () => {
      vi.useFakeTimers();
      try {
        const ctx = makeGitContext(makeSpyExec('').exec);
        mockedMergePullRequest
          .mockReturnValueOnce({ success: false, error: BASE_MODIFIED })
          .mockReturnValueOnce({ success: false, error: BASE_MODIFIED })
          .mockReturnValueOnce({ success: true });

        const merging = mergeWithConflictResolution(7, fakeCodeHost, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx);

        await vi.advanceTimersByTimeAsync(2_999);
        expect(mockedMergePullRequest).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(mockedMergePullRequest).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(5_999);
        expect(mockedMergePullRequest).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);

        await expect(merging).resolves.toMatchObject({ success: true, mergeAttempts: 3 });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('runs /resolve_conflict when the local merge check finds conflicts after a failed merge', async () => {
    let conflicting = false;
    const ctx = makeGitContext(makeSpyExec('', () => conflicting).exec);
    mockedMergePullRequest
      .mockImplementationOnce(() => {
        conflicting = true;
        return { success: false, error: 'Pull Request has merge conflicts' };
      })
      .mockReturnValueOnce({ success: true });
    mockedAgent.mockImplementation(async () => {
      conflicting = false;
      return { success: true, output: '' };
    });

    const result = await mergeWithConflictResolution(7, fakeCodeHost, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx, noWait);

    expect(result).toMatchObject({ success: true, mergeAttempts: 2, conflictResolutionRan: true });
    expect(mockedAgent).toHaveBeenCalledTimes(1);
    expect(mockedAgent.mock.calls[0]?.[0]).toBe('/resolve_conflict');
    expect(mockedMergePullRequest).toHaveBeenCalledTimes(2);
    expect(noWait).not.toHaveBeenCalled();
  });

  it('treats an unavailable local merge check as stale, not as a conflict, when the base branch cannot be fetched', async () => {
    const { exec: baseExec } = makeSpyExec('');
    const exec: ExecFn = (argv, options) => {
      if (argv[1] === 'fetch' && argv[3] === BASE_BRANCH) throw new Error('fatal: unable to access origin');
      return baseExec(argv, options);
    };
    const ctx = makeGitContext(exec);
    mockedMergePullRequest.mockReturnValue({ success: false, error: 'Pull Request has merge conflicts' });

    const result = await mergeWithConflictResolution(7, fakeCodeHost, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx, noWait);

    expect(result).toMatchObject({ success: false, mergeAttempts: 5, conflictResolutionRan: false, localMergeCheck: 'unavailable' });
    expect(mockedAgent).not.toHaveBeenCalled();
    expect(mockedMergePullRequest).toHaveBeenCalledTimes(5);
  });

  it('begins with git fetch and git reset for the head branch before any git merge call', async () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = makeGitContext(exec);

    await mergeWithConflictResolution(7, fakeCodeHost, HEAD_BRANCH, BASE_BRANCH, WORKTREE, ADW_ID, LOGS_DIR, SPEC_PATH, ctx, noWait);

    expect(calls[0].argv).toEqual(['git', 'fetch', 'origin', HEAD_BRANCH]);
    expect(calls[1].argv).toEqual(['git', 'reset', '--hard', `origin/${HEAD_BRANCH}`]);
    const firstMergeIdx = calls.findIndex((c) => c.argv[1] === 'merge');
    expect(firstMergeIdx).toBeGreaterThan(1);
  });
});
