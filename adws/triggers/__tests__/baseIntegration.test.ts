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
import { baseMovedPast, bringBaseIn, commitsMissingFrom } from '../baseIntegration';
import { makeGitContext, makeScriptedRepository, type ScriptedRepository } from './fixtures/autoMergeHandlerHarness';
import type { ExecFn } from '@paysdoc/devplatform/git';
import { Platform } from '@paysdoc/devplatform';

const BASE_BRANCH = 'main';
const WORKTREE = '/worktrees/feature-issue-42';
const SHARED_FILE = 'src/shared.ts';

const mockedAgent = vi.mocked(runClaudeAgentWithCommand);

beforeEach(() => {
  mockedAgent.mockReset();
  mockedAgent.mockResolvedValue({ success: true, output: '' });
  resetFrameworkIdentityMemo();
  vi.mocked(readLocalRepoIdentity).mockReturnValue({ owner: 'paysdoc', repo: 'AI_Dev_Workflow', platform: Platform.GitHub });
});

function bringIn(exec: ExecFn, hasConflicts = false) {
  const ctx = makeGitContext(exec);
  return bringBaseIn({
    attempt: 1,
    hasConflicts,
    adwId: 'test-adw-id',
    specPath: '',
    baseBranch: BASE_BRANCH,
    logsDir: '/logs/test-adw-id',
    cwd: WORKTREE,
    ctx,
  });
}

const indexOfCall = (repo: ScriptedRepository, ...words: string[]): number =>
  repo.calls.findIndex((call) => words.every((word) => call.argv.includes(word)));

describe('bringBaseIn', () => {
  it('reports the branch as current, after one clean merge and no agent, when it already holds the base tip', async () => {
    const repo = makeScriptedRepository({ ownCommits: ['Change the shared constant'] });

    const integration = await bringIn(repo.exec);

    expect(integration).toEqual({ kind: 'current' });
    const merges = repo.calls.filter((call) => call.argv[1] === 'merge').map((call) => call.argv);
    expect(merges).toEqual([['git', 'merge', '--no-edit', `origin/${BASE_BRANCH}`]]);
    expect(mockedAgent).not.toHaveBeenCalled();
    expect(repo.sinceReads).toEqual([]);
  });

  it('merges the base in cleanly and lists the merged-in commits the way git log --oneline prints them', async () => {
    const repo = makeScriptedRepository({
      ownCommits: ['Change the shared constant'],
      behind: [
        { subject: 'Add the changelog', authoredAt: '2026-10-22T12:00:00+02:00' },
        { subject: 'Raise the order limit', authoredAt: '2026-10-21T09:30:00+02:00' },
      ],
    });

    const integration = await bringIn(repo.exec);

    expect(integration).toEqual({
      kind: 'brought_in',
      mergedCommits: repo.onelineOf('Add the changelog', 'Raise the order limit'),
      conflictedFiles: [],
    });
    expect(mockedAgent).not.toHaveBeenCalled();
  });

  it('reads the log before and after the merge from one day before the earliest pending author date', async () => {
    const repo = makeScriptedRepository({
      behind: [
        { subject: 'Add the changelog', authoredAt: '2026-10-22T12:00:00+02:00' },
        { subject: 'Raise the order limit', authoredAt: '2026-10-21T09:30:00+02:00' },
      ],
    });

    await bringIn(repo.exec);

    expect(repo.sinceReads).toEqual(['2026-10-20T07:30:00Z', '2026-10-20T07:30:00Z']);
    const sinceReads = repo.calls.map((call, index) => ({ call, index })).filter(({ call }) => call.argv[2]?.startsWith('--since='));
    expect(sinceReads[0].index).toBeLessThan(indexOfCall(repo, 'merge', '--no-edit'));
    expect(sinceReads[1].index).toBeGreaterThan(indexOfCall(repo, 'merge', '--no-edit'));
    expect(sinceReads.every(({ call }) => call.argv.includes('--oneline') && call.argv.includes('--no-merges'))).toBe(true);
  });

  it('lists no commit, and reads no log, when only merge commits are pending and the merge still moves HEAD', async () => {
    const repo = makeScriptedRepository({ behind: [{ subject: 'Merge branch of the base into itself', isMerge: true }] });

    const integration = await bringIn(repo.exec);

    expect(integration).toEqual({ kind: 'brought_in', mergedCommits: [], conflictedFiles: [] });
    expect(repo.sinceReads).toEqual([]);
  });

  it('names each conflicted path once, reading them after the failed merge and before /resolve_conflict runs', async () => {
    const repo = makeScriptedRepository({
      behind: [{ subject: 'Change the shared constant on dev', conflictsIn: SHARED_FILE }, { subject: 'Add the changelog' }],
    });
    let callsWhenTheAgentStarted = -1;
    mockedAgent.mockImplementation(async () => {
      callsWhenTheAgentStarted = repo.calls.length;
      repo.mergeBaseByAgent();
      return { success: true, output: '' };
    });

    const integration = await bringIn(repo.exec, true);

    expect(integration).toEqual({
      kind: 'brought_in',
      mergedCommits: repo.onelineOf('Change the shared constant on dev', 'Add the changelog'),
      conflictedFiles: [SHARED_FILE],
    });
    const failedMerge = indexOfCall(repo, 'merge', '--no-edit');
    const conflictRead = indexOfCall(repo, 'diff', '--name-only');
    expect(failedMerge).toBeGreaterThanOrEqual(0);
    expect(conflictRead).toBeGreaterThan(failedMerge);
    expect(conflictRead).toBeLessThan(callsWhenTheAgentStarted);
    expect(mockedAgent).toHaveBeenCalledTimes(1);
    expect(mockedAgent.mock.calls[0]?.[0]).toBe('/resolve_conflict');
  });

  it('is unresolved when /resolve_conflict fails', async () => {
    const repo = makeScriptedRepository({ behind: [{ subject: 'Change the shared constant on dev', conflictsIn: SHARED_FILE }] });
    mockedAgent.mockResolvedValue({ success: false, output: 'Agent failed to resolve conflict' });

    const integration = await bringIn(repo.exec, true);

    expect(integration).toEqual({ kind: 'unresolved' });
  });

  it('aborts the merge and is unresolved when a merge that the check found clean fails', async () => {
    const repo = makeScriptedRepository({ behind: [{ subject: 'Add the changelog' }] });
    const failingMerge: ExecFn = (argv, options) => {
      if (argv[1] === 'merge' && argv.includes('--no-edit')) throw new Error('fatal: refusing to merge unrelated histories');
      return repo.exec(argv, options);
    };

    const integration = await bringIn(failingMerge);

    expect(integration).toEqual({ kind: 'unresolved' });
    expect(indexOfCall(repo, 'merge', '--abort')).toBeGreaterThanOrEqual(0);
    expect(mockedAgent).not.toHaveBeenCalled();
  });

  it('is unresolved, without merging, when HEAD cannot be read', async () => {
    const repo = makeScriptedRepository({ behind: [{ subject: 'Add the changelog' }] });
    const unreadable: ExecFn = (argv, options) => {
      if (argv[1] === 'rev-parse') throw new Error('fatal: not a git repository');
      return repo.exec(argv, options);
    };

    const integration = await bringIn(unreadable);

    expect(integration).toEqual({ kind: 'unresolved' });
    expect(indexOfCall(repo, 'merge')).toBe(-1);
  });
});

describe('commitsMissingFrom', () => {
  it('lists the commits origin/<base> holds that the ref lacks, each as "<author date> <subject>"', () => {
    const repo = makeScriptedRepository({ behind: [{ subject: 'Add the changelog', authoredAt: '2026-10-22T12:00:00+02:00' }] });

    expect(commitsMissingFrom('HEAD', BASE_BRANCH, WORKTREE, makeGitContext(repo.exec))).toEqual(['2026-10-22T12:00:00+02:00 Add the changelog']);
    expect(repo.calls[0]?.argv).toEqual(['git', 'log', `HEAD..origin/${BASE_BRANCH}`, '--format=%aI %s', '--no-merges']);
  });

  it('is empty when the ref holds the tip, and when the read fails', () => {
    const holdsTip = makeScriptedRepository();
    const unreadable: ExecFn = () => {
      throw new Error('fatal: bad revision');
    };

    expect(commitsMissingFrom('HEAD', BASE_BRANCH, WORKTREE, makeGitContext(holdsTip.exec))).toEqual([]);
    expect(commitsMissingFrom('HEAD', BASE_BRANCH, WORKTREE, makeGitContext(unreadable))).toEqual([]);
  });
});

describe('baseMovedPast', () => {
  it('fetches the base branch first, then reports whether it holds commits HEAD lacks', () => {
    const repo = makeScriptedRepository({ behind: [{ subject: 'Add the changelog' }] });

    expect(baseMovedPast(BASE_BRANCH, WORKTREE, makeGitContext(repo.exec))).toBe(true);
    expect(repo.calls[0]?.argv).toEqual(['git', 'fetch', 'origin', BASE_BRANCH]);
    expect(repo.calls[1]?.argv[1]).toBe('log');
  });

  it('is false when HEAD holds the base tip', () => {
    const repo = makeScriptedRepository();

    expect(baseMovedPast(BASE_BRANCH, WORKTREE, makeGitContext(repo.exec))).toBe(false);
  });

  it('is false, as no evidence that the base moved, when the fetch fails', () => {
    const repo = makeScriptedRepository({ behind: [{ subject: 'Add the changelog' }] });
    repo.failBaseFetches();

    expect(baseMovedPast(BASE_BRANCH, WORKTREE, makeGitContext(repo.exec))).toBe(false);
    expect(repo.calls.some((call) => call.argv[1] === 'log')).toBe(false);
  });
});
