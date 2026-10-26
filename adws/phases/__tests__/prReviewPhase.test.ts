/**
 * A PR review runs under the issue's own adwId, so the top-level state it finds still records the
 * finished SDLC run's owner. These tests run the real initializePRReviewWorkflow and chain the real
 * resolver and cron filter behind it: the review must replace that owner with itself, or the cron
 * reads the live review as dead and takes it over.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'fs';
import { join } from 'path';

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
import { AgentStateManager } from '../../core/agentState';
import { resetLogAdwId } from '../../core/logger';
import { AGENTS_STATE_DIR, LOGS_DIR, GRACE_PERIOD_MS } from '../../core/config';
import { resolveIssueWorkflowStage } from '../../triggers/cronStageResolver';
import { evaluateIssue } from '../../triggers/cronIssueFilter';
import { makeIssue, OLD_DATE } from '../../triggers/__tests__/cronIssueFilterFixtures';
import { ISSUE_NUMBER, PR_NUMBER, TARGET_BRANCH, WORKTREE_PATH, PR_REVIEW_SCRIPT, BOUNDARY, boundaryFor, seedFinishedSdlcRun } from './prReviewPhase.helpers';

// Distinct from the other PR review suites' run ids: files run in parallel and share the agents state directory.
const ADW_ID = 'prreview-owner-unit';
const TEN_MINUTES_MS = 10 * 60_000;
const ISSUE_COMMENTS = [{ body: `**ADW ID:** \`${ADW_ID}\`` }];

beforeEach(() => {
  vi.mocked(getProcessStartTime).mockReset();
  vi.mocked(acquireIssueSpawnLock).mockReset().mockReturnValue(true);
  vi.mocked(readSpawnLockRecord).mockReset().mockReturnValue(null);
  seedFinishedSdlcRun(ADW_ID);
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
