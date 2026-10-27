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
import { resetFrameworkIdentityMemo } from '../../core/selfHostLaunch';
import type { PostMergeFailure, PostMergeVerdict } from '../../core/postMergeVerdict';
import { mergeWithConflictResolution } from '../autoMergeHandler';
import { makeGitContext, makeScriptedRepository, type BaseCommit, type ScriptedRepository } from './fixtures/autoMergeHandlerHarness';
import type { ExecFn } from '@paysdoc/devplatform/git';
import { Platform, type CodeHost, type ForgeActionResult } from '@paysdoc/devplatform';

const HEAD_BRANCH = 'feature-issue-42';
const BASE_BRANCH = 'main';
const WORKTREE = '/worktrees/feature-issue-42';
const SHARED_FILE = 'src/shared.ts';
const BASE_MODIFIED = 'GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)';

const CHANGELOG: BaseCommit = { subject: 'Add the changelog' };
const ORDER_LIMIT: BaseCommit = { subject: 'Raise the order limit' };
const SHARED_CONSTANT: BaseCommit = { subject: 'Change the shared constant on dev', conflictsIn: SHARED_FILE };

const GREEN: PostMergeVerdict = { kind: 'green' };
const FAILURE: PostMergeFailure = { title: '@adw-42 Orders: Orders over the limit are refused', detail: 'expected status 422, got 201' };
const RED: PostMergeVerdict = { kind: 'red', failures: [FAILURE] };

const mockedMergePullRequest = vi.fn<(prNumber: number) => ForgeActionResult>();
const fakeCodeHost: Pick<CodeHost, 'mergePullRequest'> = { mergePullRequest: mockedMergePullRequest };
const mockedAgent = vi.mocked(runClaudeAgentWithCommand);
const noWait = vi.fn<(ms: number) => Promise<void>>();
const rerun = vi.fn<() => Promise<PostMergeVerdict>>();

beforeEach(() => {
  mockedMergePullRequest.mockReset();
  mockedAgent.mockReset();
  noWait.mockReset();
  rerun.mockReset();
  mockedMergePullRequest.mockReturnValue({ success: true });
  mockedAgent.mockResolvedValue({ success: true, output: '' });
  noWait.mockResolvedValue(undefined);
  rerun.mockResolvedValue(GREEN);
  resetFrameworkIdentityMemo();
  vi.mocked(readLocalRepoIdentity).mockReturnValue({ owner: 'paysdoc', repo: 'AI_Dev_Workflow', platform: Platform.GitHub });
});

function merge(exec: ExecFn) {
  return mergeWithConflictResolution(7, fakeCodeHost, HEAD_BRANCH, BASE_BRANCH, WORKTREE, 'test-adw-id', '/logs/test-adw-id', '', makeGitContext(exec), rerun, noWait);
}

/** Records what happened, in order, besides what the repository itself records. */
function narrated(repo: ScriptedRepository, events: string[]): ExecFn {
  return (argv, options) => {
    if (argv[1] === 'push') events.push('push');
    if (argv[1] === 'merge' && argv.includes('--no-edit')) events.push('merge in');
    return repo.exec(argv, options);
  };
}

const baseFetches = (repo: ScriptedRepository): number => repo.calls.filter((call) => call.argv[1] === 'fetch' && call.argv[3] === BASE_BRANCH).length;

describe('mergeWithConflictResolution, for a branch that does not hold the tip of the base branch', () => {
  it('merges the base in, pushes, re-runs the scenarios once, checks that the base did not move, and only then asks the forge to merge', async () => {
    const repo = makeScriptedRepository({ behind: [CHANGELOG, ORDER_LIMIT] });
    const events: string[] = [];
    rerun.mockImplementation(async () => {
      events.push('re-run');
      return GREEN;
    });
    mockedMergePullRequest.mockImplementation(() => {
      events.push('merge call');
      return { success: true };
    });

    const result = await merge(narrated(repo, events));

    expect(events).toEqual(['merge in', 'push', 're-run', 'merge call']);
    expect(result).toEqual({ success: true, mergeAttempts: 1, conflictResolutionRan: false, localMergeCheck: 'clean' });
    expect(result).not.toHaveProperty('postMergeRed');
    expect(rerun).toHaveBeenCalledTimes(1);
    expect(mockedAgent).not.toHaveBeenCalled();
    expect(baseFetches(repo)).toBe(2);
  });

  it('merges nothing when the re-run is red, and hands the merged-in commits and the failures to the caller', async () => {
    const repo = makeScriptedRepository({ behind: [CHANGELOG, ORDER_LIMIT] });
    rerun.mockResolvedValue(RED);

    const result = await merge(repo.exec);

    expect(result).toEqual({
      success: false,
      error: `the scenarios failed on the branch merged with origin/${BASE_BRANCH}`,
      mergeAttempts: 0,
      conflictResolutionRan: false,
      localMergeCheck: 'clean',
      postMergeRed: { mergedCommits: repo.onelineOf(CHANGELOG.subject, ORDER_LIMIT.subject), conflictedFiles: [], failures: [FAILURE] },
    });
    expect(mockedMergePullRequest).not.toHaveBeenCalled();
    expect(rerun).toHaveBeenCalledTimes(1);
    expect(mockedAgent).not.toHaveBeenCalled();
  });

  it('re-runs the scenarios after /resolve_conflict too, and names each conflicted file once when they are red', async () => {
    const repo = makeScriptedRepository({ behind: [SHARED_CONSTANT, CHANGELOG] });
    mockedAgent.mockImplementation(async () => {
      repo.mergeBaseByAgent();
      return { success: true, output: '' };
    });
    rerun.mockResolvedValue(RED);

    const result = await merge(repo.exec);

    expect(result).toMatchObject({
      success: false,
      conflictResolutionRan: true,
      localMergeCheck: 'conflicts',
      postMergeRed: { mergedCommits: repo.onelineOf(SHARED_CONSTANT.subject, CHANGELOG.subject), conflictedFiles: [SHARED_FILE], failures: [FAILURE] },
    });
    expect(mockedMergePullRequest).not.toHaveBeenCalled();
    expect(mockedAgent).toHaveBeenCalledTimes(1);
  });

  it('merges after a green re-run that followed /resolve_conflict', async () => {
    const repo = makeScriptedRepository({ behind: [SHARED_CONSTANT] });
    mockedAgent.mockImplementation(async () => {
      repo.mergeBaseByAgent();
      return { success: true, output: '' };
    });

    const result = await merge(repo.exec);

    expect(result).toEqual({ success: true, mergeAttempts: 1, conflictResolutionRan: true, localMergeCheck: 'conflicts' });
    expect(rerun).toHaveBeenCalledTimes(1);
  });
});

describe('mergeWithConflictResolution, for a branch that holds the tip of the base branch', () => {
  it('merges without a re-run, as before', async () => {
    const repo = makeScriptedRepository({ ownCommits: ['Change the shared constant'] });

    const result = await merge(repo.exec);

    expect(result).toEqual({ success: true, mergeAttempts: 1, conflictResolutionRan: false, localMergeCheck: 'clean' });
    expect(rerun).not.toHaveBeenCalled();
    expect(mockedAgent).not.toHaveBeenCalled();
  });
});

describe('mergeWithConflictResolution, when the merge-in cannot be pushed', () => {
  it('re-runs on the next attempt although HEAD no longer moves, and keeps the commits of both attempts', async () => {
    const repo = makeScriptedRepository({ behind: [CHANGELOG], failPushes: 1 });
    let landed = false;
    const landsOneCommitAtTheFirstPush: ExecFn = (argv, options) => {
      if (argv[1] === 'push' && !landed) {
        landed = true;
        repo.landOnBase(ORDER_LIMIT);
      }
      return repo.exec(argv, options);
    };
    rerun.mockResolvedValue(RED);

    const result = await merge(landsOneCommitAtTheFirstPush);

    expect(result.postMergeRed?.mergedCommits).toEqual(repo.onelineOf(CHANGELOG.subject, ORDER_LIMIT.subject));
    expect(rerun).toHaveBeenCalledTimes(1);
  });

  it('re-runs once, on the attempt whose push succeeds, even when the base did not move in between', async () => {
    const repo = makeScriptedRepository({ behind: [CHANGELOG], failPushes: 1 });

    const result = await merge(repo.exec);

    expect(result).toMatchObject({ success: true, mergeAttempts: 1 });
    expect(rerun).toHaveBeenCalledTimes(1);
    expect(repo.calls.filter((call) => call.argv[1] === 'push')).toHaveLength(2);
  });
});

describe('mergeWithConflictResolution, when the base branch moves on', () => {
  it('does not merge on the proof of the earlier run: the next attempt brings the new commits in and re-runs', async () => {
    const repo = makeScriptedRepository({ behind: [CHANGELOG] });
    const events: string[] = [];
    rerun
      .mockImplementationOnce(async () => {
        events.push('re-run');
        repo.landOnBase(ORDER_LIMIT);
        return GREEN;
      })
      .mockImplementationOnce(async () => {
        events.push('re-run');
        return GREEN;
      });
    mockedMergePullRequest.mockImplementation(() => {
      events.push('merge call');
      return { success: true };
    });

    const result = await merge(narrated(repo, events));

    expect(events).toEqual(['merge in', 'push', 're-run', 'merge in', 'push', 're-run', 'merge call']);
    expect(result).toEqual({ success: true, mergeAttempts: 1, conflictResolutionRan: false, localMergeCheck: 'clean' });
    expect(rerun).toHaveBeenCalledTimes(2);
  });

  it('returns to the loop, without waiting, when the forge refuses a merge and the base holds commits the branch lacks', async () => {
    const repo = makeScriptedRepository();
    const events: string[] = [];
    mockedMergePullRequest
      .mockImplementationOnce(() => {
        events.push('merge call');
        repo.landOnBase(CHANGELOG);
        return { success: false, error: BASE_MODIFIED };
      })
      .mockImplementationOnce(() => {
        events.push('merge call');
        return { success: true };
      });
    rerun.mockImplementation(async () => {
      events.push('re-run');
      return GREEN;
    });

    const result = await merge(narrated(repo, events));

    expect(events).toEqual(['merge in', 'push', 'merge call', 'merge in', 'push', 're-run', 'merge call']);
    expect(result).toMatchObject({ success: true, mergeAttempts: 2, localMergeCheck: 'clean' });
    expect(noWait).not.toHaveBeenCalled();
    expect(rerun).toHaveBeenCalledTimes(1);
  });

  it('gives up with the moving base as the reason when it moves on during every attempt, and parks nothing', async () => {
    const repo = makeScriptedRepository({ behind: [CHANGELOG] });
    let landed = 0;
    rerun.mockImplementation(async () => {
      landed += 1;
      repo.landOnBase({ subject: `Another commit on the base ${landed}` });
      return GREEN;
    });

    const result = await merge(repo.exec);

    expect(result).toEqual({
      success: false,
      error: `origin/${BASE_BRANCH} moved on while the scenarios were re-run`,
      mergeAttempts: 0,
      conflictResolutionRan: false,
      localMergeCheck: 'clean',
    });
    expect(result).not.toHaveProperty('postMergeRed');
    expect(rerun).toHaveBeenCalledTimes(3);
    expect(mockedMergePullRequest).not.toHaveBeenCalled();
  });
});

describe('mergeWithConflictResolution, when the base branch cannot be fetched', () => {
  it('merges nothing in and re-runs nothing, and asks the forge five times as before', async () => {
    const repo = makeScriptedRepository({ behind: [CHANGELOG] });
    repo.failBaseFetches();
    mockedMergePullRequest.mockReturnValue({ success: false, error: 'Pull Request has merge conflicts' });

    const result = await merge(repo.exec);

    expect(result).toMatchObject({ success: false, mergeAttempts: 5, conflictResolutionRan: false, localMergeCheck: 'unavailable' });
    expect(mockedMergePullRequest).toHaveBeenCalledTimes(5);
    expect(rerun).not.toHaveBeenCalled();
    expect(repo.calls.some((call) => call.argv[1] === 'merge' && call.argv.includes('--no-edit'))).toBe(false);
    expect(noWait.mock.calls).toEqual([[3000], [6000], [12000], [24000]]);
  });
});
