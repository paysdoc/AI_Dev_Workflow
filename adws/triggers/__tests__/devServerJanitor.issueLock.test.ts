import { describe, it, expect, vi } from 'vitest';
import {
  discoverTargetRepoWorktrees,
  runJanitorPass,
  DEFAULT_DEPS,
  type JanitorDeps,
} from '../devServerJanitor';
import { isIssueLockHeldByLiveProcess } from '../spawnGate';
import type { AgentState } from '../../types/agentTypes';
import { OLD, makeDeps } from './fixtures/devServerJanitorDeps';

vi.mock('../spawnGate', async importOriginal => ({
  ...(await importOriginal<typeof import('../spawnGate')>()),
  isIssueLockHeldByLiveProcess: vi.fn(),
}));

describe('discoverTargetRepoWorktrees: owner and repository', () => {
  it('names the owner and the repository each candidate was found in', () => {
    const deps = makeDeps({
      readdirTargetRepos: vi.fn()
        .mockReturnValueOnce(['owner1', 'owner2'])
        .mockReturnValueOnce(['repo1'])
        .mockReturnValueOnce(['repo2']),
      listWorktrees: vi.fn()
        .mockReturnValueOnce(['/repos/owner1/repo1/.worktrees/feature-issue-1-some-slug'])
        .mockReturnValueOnce(['/repos/owner2/repo2/.worktrees/bugfix-issue-2-other-slug']),
    });

    expect(discoverTargetRepoWorktrees(deps)).toEqual([
      { worktreePath: '/repos/owner1/repo1/.worktrees/feature-issue-1-some-slug', dirName: 'feature-issue-1-some-slug', owner: 'owner1', repo: 'repo1' },
      { worktreePath: '/repos/owner2/repo2/.worktrees/bugfix-issue-2-other-slug', dirName: 'bugfix-issue-2-other-slug', owner: 'owner2', repo: 'repo2' },
    ]);
  });
});

describe('runJanitorPass: a worktree whose issue lock a live process holds', () => {
  const wtPath = '/repos/owner/repo/.worktrees/feature-issue-7-merge-me';
  const adwId = 'm3rg3d-merge-me';
  const awaitingMerge: Partial<AgentState> = { issueNumber: 7, lastSeenAt: new Date().toISOString(), workflowStage: 'awaiting_merge' };

  function worldOf(overrides: Partial<JanitorDeps> = {}): JanitorDeps {
    return makeDeps({
      readdirTargetRepos: vi.fn().mockReturnValueOnce(['owner']).mockReturnValueOnce(['repo']),
      listWorktrees: vi.fn().mockReturnValue([wtPath]),
      listAdwStateDirs: vi.fn().mockReturnValue([adwId]),
      readTopLevelStateRaw: vi.fn().mockReturnValue(awaitingMerge),
      readTopLevelState: vi.fn().mockReturnValue(awaitingMerge),
      isAgentProcessRunning: vi.fn().mockReturnValue(false),
      getWorktreeAgeMs: vi.fn().mockReturnValue(OLD),
      ...overrides,
    });
  }

  it('is left alone however old it is and whatever stage the workflow records, since the merge orchestrator runs scenarios in a worktree that is awaiting_merge', async () => {
    const deps = worldOf({ isIssueLockHeldByLiveProcess: vi.fn().mockReturnValue(true) });

    await runJanitorPass(deps);

    expect(deps.isIssueLockHeldByLiveProcess).toHaveBeenCalledWith('owner', 'repo', 7);
    expect(deps.killProcessesInDirectory).not.toHaveBeenCalled();
  });

  it('is left alone before the stage, the liveness of the recorded orchestrator and the age are read, and says so', async () => {
    const deps = worldOf({ isIssueLockHeldByLiveProcess: vi.fn().mockReturnValue(true) });

    await runJanitorPass(deps);

    expect(deps.readTopLevelState).not.toHaveBeenCalled();
    expect(deps.isAgentProcessRunning).not.toHaveBeenCalled();
    expect(deps.getWorktreeAgeMs).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining(wtPath), 'info');
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('#7'), 'info');
  });

  it('is cleaned as before when no live process holds the lock: the same workflow, the same age, the same processes', async () => {
    const deps = worldOf({ isIssueLockHeldByLiveProcess: vi.fn().mockReturnValue(false) });

    await runJanitorPass(deps);

    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(wtPath);
  });

  it('asks about the lock only for a worktree that has processes in it', async () => {
    const deps = worldOf({ hasProcessesInDirectory: vi.fn().mockReturnValue(false), isIssueLockHeldByLiveProcess: vi.fn().mockReturnValue(true) });

    await runJanitorPass(deps);

    expect(deps.isIssueLockHeldByLiveProcess).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalledWith(expect.stringContaining('lock'), 'info');
  });

  it('asks about no lock for a worktree whose name carries no issue number, which is judged on its age alone', async () => {
    const unnamed = '/repos/owner/repo/.worktrees/manually-created-dir';
    const deps = worldOf({ listWorktrees: vi.fn().mockReturnValue([unnamed]), isIssueLockHeldByLiveProcess: vi.fn().mockReturnValue(true) });

    await runJanitorPass(deps);

    expect(deps.isIssueLockHeldByLiveProcess).not.toHaveBeenCalled();
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(unnamed);
  });

  it('asks about the lock of the repository the worktree belongs to, and spares only the worktree whose issue is locked', async () => {
    const lockedWt = '/repos/acme/app/.worktrees/feature-issue-7-merge-me';
    const otherWt = '/repos/acme/app/.worktrees/feature-issue-8-orphaned';
    const heldFor = (owner: string, repo: string, issueNumber: number): boolean => owner === 'acme' && repo === 'app' && issueNumber === 7;
    const deps = worldOf({
      readdirTargetRepos: vi.fn().mockReturnValueOnce(['acme']).mockReturnValueOnce(['app']),
      listWorktrees: vi.fn().mockReturnValue([lockedWt, otherWt]),
      listAdwStateDirs: vi.fn().mockReturnValue([]),
      readTopLevelStateRaw: vi.fn().mockReturnValue(null),
      readTopLevelState: vi.fn().mockReturnValue(null),
      isIssueLockHeldByLiveProcess: vi.fn(heldFor),
    });

    await runJanitorPass(deps);

    expect(deps.killProcessesInDirectory).toHaveBeenCalledTimes(1);
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(otherWt);
  });

  it('logs a lock that cannot be read as an error for that worktree, and goes on with the next one', async () => {
    const nextWt = '/repos/owner/repo/.worktrees/feature-issue-9-next';
    const isHeld = vi.fn().mockImplementationOnce(() => { throw new Error('EACCES'); }).mockReturnValue(false);
    const deps = worldOf({
      listWorktrees: vi.fn().mockReturnValue([wtPath, nextWt]),
      listAdwStateDirs: vi.fn().mockReturnValue([]),
      readTopLevelStateRaw: vi.fn().mockReturnValue(null),
      readTopLevelState: vi.fn().mockReturnValue(null),
      isIssueLockHeldByLiveProcess: isHeld,
    });

    await runJanitorPass(deps);

    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining(wtPath), 'warn');
    expect(deps.killProcessesInDirectory).toHaveBeenCalledWith(nextWt);
    expect(deps.killProcessesInDirectory).not.toHaveBeenCalledWith(wtPath);
  });
});

describe('DEFAULT_DEPS.isIssueLockHeldByLiveProcess', () => {
  it('asks the spawn gate about the repository by owner and name and the issue, leaving the caller as the janitor itself, so that a lock the cron leaked cannot shield an orphan', () => {
    vi.mocked(isIssueLockHeldByLiveProcess).mockReturnValueOnce(true);

    expect(DEFAULT_DEPS.isIssueLockHeldByLiveProcess('acme', 'app', 7)).toBe(true);
    expect(isIssueLockHeldByLiveProcess).toHaveBeenCalledWith({ owner: 'acme', repo: 'app' }, 7);
  });
});
