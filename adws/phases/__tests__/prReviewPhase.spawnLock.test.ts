/**
 * The PR review takes the issue's spawn lock before it records itself as the owner. Run against the real
 * initializePRReviewWorkflow, so a review that loses the lock must leave the finished run's owner untouched.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, rmSync } from 'fs';
import { join } from 'path';

// A real lock file would be taken under the Vitest worker's pid and refuse the next test that reviews the same PR.
vi.mock('../../triggers/spawnGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../triggers/spawnGate')>()),
  acquireIssueSpawnLock: vi.fn(),
  readSpawnLockRecord: vi.fn(),
  releaseIssueSpawnLock: vi.fn(),
}));

// The merge poll's wait is 30 s of real sleeps; one retry with no pause is enough to see that a refused claim waits.
vi.mock('../orchestratorLock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../orchestratorLock')>()),
  MERGE_POLL_LOCK_WAIT: { attempts: 2, retryMs: 0 },
}));

// With no RepoContext no PR comment is posted.
vi.mock('../../core/workspaceBinding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/workspaceBinding')>()),
  bindWorkspaceContext: vi.fn().mockReturnValue(undefined),
}));

// The worktree is a path that holds no .adw/, so the real gate would park.
vi.mock('../applicationTypeGate', async (importOriginal) => {
  const { APPLICATION_TYPE_PROFILES } = await import('../../core/applicationType');
  return {
    ...(await importOriginal<typeof import('../applicationTypeGate')>()),
    runApplicationTypeGate: vi.fn((_config: unknown, projectConfig: ProjectConfig) => ({ projectConfig, applicationProfile: APPLICATION_TYPE_PROFILES.cli })),
    buildApplicationTypeGateDeps: vi.fn(() => ({})),
  };
});

import { initializePRReviewWorkflow } from '../prReviewPhase';
import type { ProjectConfig } from '../../core/projectConfig';
import { acquireIssueSpawnLock, readSpawnLockRecord } from '../../triggers/spawnGate';
import { ExitSignal } from './applicationTypeGate.helpers';
import { AgentStateManager } from '../../core/agentState';
import { resetLogAdwId } from '../../core/logger';
import { AGENTS_STATE_DIR, LOGS_DIR } from '../../core/config';
import { ISSUE_NUMBER, PR_NUMBER, FINISHED_RUN, SDLC_SCRIPT, BOUNDARY, boundaryFor, seedFinishedSdlcRun } from './prReviewPhase.helpers';

// Distinct from prReviewPhase.test.ts's run id: files run in parallel and share the agents state directory.
const ADW_ID = 'prreview-spawn-lock-unit';

beforeEach(() => {
  vi.mocked(acquireIssueSpawnLock).mockReset().mockReturnValue(true);
  vi.mocked(readSpawnLockRecord).mockReset().mockReturnValue(null);
  seedFinishedSdlcRun(ADW_ID);
});

afterEach(() => {
  rmSync(join(AGENTS_STATE_DIR, ADW_ID), { recursive: true, force: true });
  rmSync(join(LOGS_DIR, ADW_ID), { recursive: true, force: true });
  resetLogAdwId();
});

describe('initializePRReviewWorkflow: the spawn lock is taken before the review records itself as the owner', () => {
  const executionLogPath = join(AGENTS_STATE_DIR, ADW_ID, 'pr-review-orchestrator', 'execution.log');
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitSignal(code);
    });
  });

  afterEach(() => exit.mockRestore());

  it('takes the issue\'s spawn lock under the boundary\'s repository before it records itself as the owner', async () => {
    const writeTopLevelState = vi.spyOn(AgentStateManager, 'writeTopLevelState');
    try {
      await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY);

      expect(acquireIssueSpawnLock).toHaveBeenCalledWith(BOUNDARY.repoId, ISSUE_NUMBER, process.pid);
      expect(vi.mocked(acquireIssueSpawnLock).mock.invocationCallOrder[0]).toBeLessThan(writeTopLevelState.mock.invocationCallOrder[0]);
    } finally {
      writeTopLevelState.mockRestore();
    }
  });

  it('locks a PR that links no issue as issue 0, the number the base configuration carries and the lifecycle locks', async () => {
    const boundary = boundaryFor(undefined);

    const config = await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, boundary);

    expect(acquireIssueSpawnLock).toHaveBeenCalledWith(boundary.repoId, 0, process.pid);
    expect(config.base.issueNumber).toBe(0);
  });

  it('a PR review that loses the spawn lock exits 0 and leaves the finished run\'s owner in the state', async () => {
    vi.mocked(acquireIssueSpawnLock).mockReturnValue(false);
    vi.mocked(readSpawnLockRecord).mockReturnValue({ pid: 4242, pidStartedAt: 'holder-start' });

    await expect(initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY)).rejects.toThrow('process.exit(0)');

    expect(exit).toHaveBeenCalledWith(0);
    expect(acquireIssueSpawnLock).toHaveBeenCalledTimes(2);
    expect(AgentStateManager.readTopLevelState(ADW_ID)).toMatchObject({ ...FINISHED_RUN, orchestratorScript: SDLC_SCRIPT });
    expect(readFileSync(executionLogPath, 'utf-8')).toContain('Spawn lock for issue #9600 is held by pid 4242; exiting without running a phase');
  });

  it('a PR review that takes the lock of a phase_timeout workflow counts one resume', async () => {
    AgentStateManager.writeTopLevelState(ADW_ID, { workflowStage: 'phase_timeout', resumeAttempts: 1 });

    await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY);

    expect(AgentStateManager.readTopLevelState(ADW_ID)?.resumeAttempts).toBe(2);
  });
});
