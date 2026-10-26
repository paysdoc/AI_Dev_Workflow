/**
 * A PR review runs under the issue's own adwId, so the top-level state it finds still records the
 * finished SDLC run's owner. These tests run the real initializePRReviewWorkflow and chain the real
 * resolver and cron filter behind it: the review must replace that owner with itself, or the cron
 * reads the live review as dead and takes it over.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { Platform } from '@paysdoc/devplatform';

// Pins the start token so the assertions are exact on every platform, as workflowInit.test.ts does.
vi.mock('../../core/processLiveness', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/processLiveness')>()),
  getProcessStartTime: vi.fn(),
}));

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

vi.mock('../../core/projectConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/projectConfig')>();
  return { ...actual, loadProjectConfig: vi.fn(actual.loadProjectConfig) };
});

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
import { runApplicationTypeGate, buildApplicationTypeGateDeps } from '../applicationTypeGate';
import { APPLICATION_TYPE_PROFILES } from '../../core/applicationType';
import { getDefaultProjectConfig, loadProjectConfig, type ProjectConfig } from '../../core/projectConfig';
import { getProcessStartTime } from '../../core/processLiveness';
import { acquireIssueSpawnLock, readSpawnLockRecord } from '../../triggers/spawnGate';
import { ExitSignal } from './applicationTypeGate.helpers';
import { AgentStateManager } from '../../core/agentState';
import { resetLogAdwId } from '../../core/logger';
import { AGENTS_STATE_DIR, LOGS_DIR, GRACE_PERIOD_MS } from '../../core/config';
import { resolveIssueWorkflowStage } from '../../triggers/cronStageResolver';
import { evaluateIssue } from '../../triggers/cronIssueFilter';
import { makeIssue, OLD_DATE } from '../../triggers/__tests__/cronIssueFilterFixtures';
import type { LaunchBoundary } from '../../core';

const ADW_ID = 'prreview-owner-unit';
const BRANCH = 'bugfix-issue-9600-pr-review-owner';
const ISSUE_NUMBER = 9600;
const PR_NUMBER = 96;
const TEN_MINUTES_MS = 10 * 60_000;
const FINISHED_RUN = { pid: 2147483646, pidStartedAt: 'finished-sdlc-run', lastSeenAt: '2026-01-01T00:00:00.000Z' } as const;
const ISSUE_COMMENTS = [{ body: `**ADW ID:** \`${ADW_ID}\`` }];
const TARGET_BRANCH = 'trunk';
const WORKTREE_PATH = '/tmp/adw-pr-review-owner-unit';
const PR_REVIEW_SCRIPT = 'adws/adwPrReview.tsx';
const SDLC_SCRIPT = 'adws/adwSdlc.tsx';

function boundaryFor(linkedIssueNumber: number | undefined): LaunchBoundary {
  return {
    repoId: { owner: 'acme', repo: 'widget', platform: Platform.GitHub },
    providers: {
      codeHost: {
        fetchPullRequest: () => ({
          number: PR_NUMBER,
          title: 'Tidy the retry budget',
          body: '',
          state: 'OPEN',
          sourceBranch: BRANCH,
          targetBranch: TARGET_BRANCH,
          url: '',
          linkedIssueNumber,
        }),
        fetchReviewComments: () => [],
        getAuthenticatedUser: () => 'adw-bot',
      },
    },
    gitContext: { owner: 'acme', repo: 'widget', ensureWorktree: () => WORKTREE_PATH },
  } as unknown as LaunchBoundary;
}

const BOUNDARY = boundaryFor(ISSUE_NUMBER);

/** What the SDLC run leaves for the PR review to find: awaiting_merge, its own dead owner, and one recorded phase. */
function seedFinishedSdlcRun(): void {
  AgentStateManager.writeTopLevelState(ADW_ID, {
    adwId: ADW_ID,
    issueNumber: ISSUE_NUMBER,
    workflowStage: 'awaiting_merge',
    orchestratorScript: SDLC_SCRIPT,
    branchName: BRANCH,
    ...FINISHED_RUN,
    // A recorded phase is what lets init run with no unaddressed comments instead of exiting.
    phases: { stepDef: { status: 'completed', startedAt: FINISHED_RUN.lastSeenAt, completedAt: FINISHED_RUN.lastSeenAt } },
  });
}

beforeEach(() => {
  vi.mocked(getProcessStartTime).mockReset();
  vi.mocked(acquireIssueSpawnLock).mockReset().mockReturnValue(true);
  vi.mocked(readSpawnLockRecord).mockReset().mockReturnValue(null);
  seedFinishedSdlcRun();
});

afterEach(() => {
  rmSync(join(AGENTS_STATE_DIR, ADW_ID), { recursive: true, force: true });
  rmSync(join(LOGS_DIR, ADW_ID), { recursive: true, force: true });
  resetLogAdwId();
});

describe('initializePRReviewWorkflow records the PR review as the issue\'s owner', () => {
  it('replaces the finished SDLC run\'s owner with this run and leaves the stage alone', async () => {
    vi.mocked(getProcessStartTime).mockReturnValue('pr-review-start');
    const startedAt = Date.now();

    await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY);

    const state = AgentStateManager.readTopLevelState(ADW_ID);
    expect(state?.pid).toBe(process.pid);
    expect(state?.pidStartedAt).toBe('pr-review-start');
    expect(Date.parse(state?.lastSeenAt ?? '')).toBeGreaterThanOrEqual(startedAt);
    expect(state?.orchestratorScript).toBe(PR_REVIEW_SCRIPT);
    expect(state?.workflowStage).toBe('awaiting_merge');
  });

  it('drops a park the issue\'s earlier run left, since a starting run is no longer parked', async () => {
    AgentStateManager.writeTopLevelState(ADW_ID, { parkReason: 'pre_existing_regression' });

    await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY);

    expect(AgentStateManager.readTopLevelState(ADW_ID)).not.toHaveProperty('parkReason');
  });

  it('never pairs this pid with the finished run\'s start time', async () => {
    vi.mocked(getProcessStartTime).mockReturnValue(null);

    await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY);

    const state = AgentStateManager.readTopLevelState(ADW_ID);
    expect(state?.pid).toBe(process.pid);
    expect(state?.pidStartedAt).toBeUndefined();
  });

  it('reads as live to the cron ten minutes into pr_review_build_running, so the cron leaves it to run', async () => {
    vi.mocked(getProcessStartTime).mockReturnValue('pr-review-start');
    await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY);
    // What runPhase writes when the build phase starts.
    AgentStateManager.writeTopLevelState(ADW_ID, {
      workflowStage: 'pr_review_build_running',
      phases: { pr_review_build: { status: 'running', startedAt: new Date(Date.now() - TEN_MINUTES_MS).toISOString() } },
    });

    const resolution = resolveIssueWorkflowStage(
      ISSUE_COMMENTS,
      (adwId) => AgentStateManager.readTopLevelState(adwId),
      (pid, pidStartedAt) => pid === process.pid && pidStartedAt === 'pr-review-start',
    );
    const result = evaluateIssue(
      makeIssue({ number: ISSUE_NUMBER, comments: ISSUE_COMMENTS, createdAt: OLD_DATE, updatedAt: OLD_DATE }),
      Date.now(),
      { spawns: new Set() },
      GRACE_PERIOD_MS,
      () => resolution,
    );

    expect(resolution.ownerDead).toBe(false);
    expect(result).toEqual({ eligible: false, reason: 'active' });
  });
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

describe('initializePRReviewWorkflow: the application-type gate', () => {
  const mockGate = vi.mocked(runApplicationTypeGate);
  const mockBuildGateDeps = vi.mocked(buildApplicationTypeGateDeps);
  const mockLoadProjectConfig = vi.mocked(loadProjectConfig);

  beforeEach(() => {
    mockGate.mockClear();
    mockBuildGateDeps.mockClear();
    mockLoadProjectConfig.mockClear();
  });

  it('records the PR review as the orchestrator before the gate runs, so that a park inside init resumes the PR review on "## Retry"', async () => {
    mockGate.mockImplementationOnce(() => {
      throw new Error('the gate parked the workflow');
    });

    await expect(initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY)).rejects.toThrow('the gate parked the workflow');

    expect(AgentStateManager.readTopLevelState(ADW_ID)?.orchestratorScript).toBe(PR_REVIEW_SCRIPT);
  });

  it('hands the gate the run, the PR worktree and the PR\'s target branch as the default branch', async () => {
    const config = await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY);

    expect(mockGate).toHaveBeenCalledTimes(1);
    expect(mockGate.mock.calls[0][0]).toMatchObject({
      adwId: ADW_ID,
      issueNumber: ISSUE_NUMBER,
      orchestratorStatePath: config.base.orchestratorStatePath,
      worktreePath: WORKTREE_PATH,
      defaultBranch: TARGET_BRANCH,
    });
  });

  it('hands the gate issue number 0 when the PR links no issue, as the base configuration carries it', async () => {
    const config = await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, boundaryFor(undefined));

    expect(config.base.issueNumber).toBe(0);
    expect(mockGate.mock.calls[0][0]).toMatchObject({ issueNumber: 0 });
  });

  it('hands the gate the config read from the PR worktree', async () => {
    const loaded = { ...getDefaultProjectConfig(), projectMd: 'read from the PR worktree' };
    mockLoadProjectConfig.mockReturnValueOnce(loaded);

    await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY);

    expect(mockLoadProjectConfig).toHaveBeenCalledWith(WORKTREE_PATH);
    expect(mockGate.mock.calls[0][1]).toBe(loaded);
  });

  it('builds the gate its real dependencies from the launch GitContext', async () => {
    const deps = { marker: 'gate deps' } as unknown as ReturnType<typeof buildApplicationTypeGateDeps>;
    mockBuildGateDeps.mockReturnValueOnce(deps);

    await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY);

    expect(mockBuildGateDeps).toHaveBeenCalledWith(BOUNDARY.gitContext);
    expect(mockGate.mock.calls[0][2]).toBe(deps);
  });

  it('puts the profile the gate resolved, and the config it returned, on the base configuration', async () => {
    const reloaded = { ...getDefaultProjectConfig(), applicationType: 'web' };
    mockGate.mockReturnValueOnce({ projectConfig: reloaded, applicationProfile: APPLICATION_TYPE_PROFILES.web });

    const config = await initializePRReviewWorkflow(PR_NUMBER, ADW_ID, BOUNDARY);

    expect(config.base.applicationProfile).toBe(APPLICATION_TYPE_PROFILES.web);
    expect(config.base.projectConfig).toBe(reloaded);
  });
});
