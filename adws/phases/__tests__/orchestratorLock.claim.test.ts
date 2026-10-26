import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../triggers/spawnGate', () => ({
  acquireIssueSpawnLock: vi.fn(),
  releaseIssueSpawnLock: vi.fn(),
  readSpawnLockRecord: vi.fn(),
}));

vi.mock('../../core/heartbeat', () => ({
  startHeartbeat: vi.fn(),
  stopHeartbeat: vi.fn(),
}));

vi.mock('../../core/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/logger')>()),
  log: vi.fn(),
}));

import { acquireIssueSpawnLock, releaseIssueSpawnLock, readSpawnLockRecord } from '../../triggers/spawnGate';
import { startHeartbeat, stopHeartbeat } from '../../core/heartbeat';
import { log } from '../../core/logger';
import { getProcessStartTime } from '../../core/processLiveness';
import { AgentStateManager } from '../../core/agentState';
import { claimIssueSpawnLock, runWithOrchestratorLifecycle, type SpawnLockClaim } from '../orchestratorLock';
import type { AgentState } from '../../types/agentTypes';
import type { WorkflowConfig } from '../workflowInit';
import type { RepoIdentifier } from '@paysdoc/devplatform';
import { Platform } from '@paysdoc/devplatform';

const mockAcquire = vi.mocked(acquireIssueSpawnLock);
const mockRelease = vi.mocked(releaseIssueSpawnLock);
const mockReadLockRecord = vi.mocked(readSpawnLockRecord);
const mockStart = vi.mocked(startHeartbeat);
const mockStop = vi.mocked(stopHeartbeat);
const mockLog = vi.mocked(log);
const mockAppendLog = vi.spyOn(AgentStateManager, 'appendLog');
const mockInitializeState = vi.spyOn(AgentStateManager, 'initializeState');
const mockReadTopLevelState = vi.spyOn(AgentStateManager, 'readTopLevelState');
const mockWriteTopLevelState = vi.spyOn(AgentStateManager, 'writeTopLevelState');

const FAKE_HANDLE = { adwId: 'test-adw-id', timer: null as unknown as ReturnType<typeof setInterval> };
const FAKE_REPO: RepoIdentifier = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub };
const ORCHESTRATOR_STATE_PATH = '/tmp/agents/test-adw-id/sdlc-orchestrator';

const fakeConfig = {
  issueNumber: 42,
  adwId: 'test-adw-id',
  targetRepo: { owner: 'acme', repo: 'widgets' },
  orchestratorStatePath: ORCHESTRATOR_STATE_PATH,
} as unknown as WorkflowConfig;

const CLAIM: SpawnLockClaim = { repoId: FAKE_REPO, issueNumber: 42, adwId: 'test-adw-id', orchestratorName: 'sdlc-orchestrator' };

beforeEach(() => {
  vi.clearAllMocks();
  mockAcquire.mockReturnValue(true);
  mockStart.mockReturnValue(FAKE_HANDLE);
  mockReadLockRecord.mockReturnValue(null);
  mockAppendLog.mockImplementation(() => {});
  mockInitializeState.mockReturnValue(ORCHESTRATOR_STATE_PATH);
  mockReadTopLevelState.mockReturnValue(null);
  mockWriteTopLevelState.mockImplementation(() => {});
});

describe('claimIssueSpawnLock', () => {
  const sleep = vi.fn(async (_ms: number) => {});
  const stoppedAt = (workflowStage: string, resumeAttempts?: number): AgentState =>
    ({ workflowStage, ...(resumeAttempts === undefined ? {} : { resumeAttempts }) }) as AgentState;

  it('takes the issue\'s lock under this process and writes no refusal', async () => {
    const result = await claimIssueSpawnLock(CLAIM);

    expect(result).toBe(true);
    expect(mockAcquire).toHaveBeenCalledOnce();
    expect(mockAcquire).toHaveBeenCalledWith(FAKE_REPO, 42, process.pid);
    expect(mockAppendLog).not.toHaveBeenCalled();
  });

  it('counts one resume when the workflow it took the lock of stopped at phase_timeout', async () => {
    mockReadTopLevelState.mockReturnValue(stoppedAt('phase_timeout', 2));

    await claimIssueSpawnLock(CLAIM);

    expect(mockWriteTopLevelState).toHaveBeenCalledOnce();
    expect(mockWriteTopLevelState).toHaveBeenCalledWith('test-adw-id', { resumeAttempts: 3 });
  });

  it('counts the first resume of a phase_timeout workflow that records none', async () => {
    mockReadTopLevelState.mockReturnValue(stoppedAt('phase_timeout'));

    await claimIssueSpawnLock(CLAIM);

    expect(mockWriteTopLevelState).toHaveBeenCalledWith('test-adw-id', { resumeAttempts: 1 });
  });

  it.each(['starting', 'abandoned', 'build_running', 'awaiting_merge'])('counts no resume for a workflow at %s', async (stage) => {
    mockReadTopLevelState.mockReturnValue(stoppedAt(stage, 2));

    await claimIssueSpawnLock(CLAIM);

    expect(mockWriteTopLevelState).not.toHaveBeenCalled();
  });

  it('reads no workflow state for a launch with no adwId yet', async () => {
    const result = await claimIssueSpawnLock({ ...CLAIM, adwId: null });

    expect(result).toBe(true);
    expect(mockReadTopLevelState).not.toHaveBeenCalled();
  });

  it('refuses with the holder named in the execution log, and writes nothing to the top-level state', async () => {
    mockAcquire.mockReturnValue(false);
    mockReadLockRecord.mockReturnValue({ pid: 41399, pidStartedAt: 'cron-start' });

    const result = await claimIssueSpawnLock(CLAIM);

    expect(result).toBe(false);
    expect(mockInitializeState).toHaveBeenCalledWith('test-adw-id', 'sdlc-orchestrator');
    expect(mockAppendLog).toHaveBeenCalledOnce();
    expect(mockAppendLog).toHaveBeenCalledWith(ORCHESTRATOR_STATE_PATH, 'Spawn lock for issue #42 is held by pid 41399; exiting without running a phase');
    expect(mockReadTopLevelState).not.toHaveBeenCalled();
    expect(mockWriteTopLevelState).not.toHaveBeenCalled();
  });

  it('keeps the refusal on the console for a launch with no adwId yet', async () => {
    mockAcquire.mockReturnValue(false);
    mockReadLockRecord.mockReturnValue({ pid: 41399, pidStartedAt: 'cron-start' });

    const result = await claimIssueSpawnLock({ ...CLAIM, adwId: null });

    expect(result).toBe(false);
    expect(mockLog).toHaveBeenCalledWith('Spawn lock for issue #42 is held by pid 41399; exiting without running a phase', 'warn');
    expect(mockAppendLog).not.toHaveBeenCalled();
    expect(mockInitializeState).not.toHaveBeenCalled();
  });

  it('waits out a refused lock per the lock wait, then counts the resume', async () => {
    mockAcquire.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true);
    mockReadTopLevelState.mockReturnValue(stoppedAt('phase_timeout', 1));

    const result = await claimIssueSpawnLock(CLAIM, { attempts: 5, retryMs: 2_000, sleep });

    expect(result).toBe(true);
    expect(mockAcquire).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(mockAppendLog).not.toHaveBeenCalled();
    expect(mockWriteTopLevelState).toHaveBeenCalledOnce();
    expect(mockWriteTopLevelState).toHaveBeenCalledWith('test-adw-id', { resumeAttempts: 2 });
  });

  it('gives up after the last attempt of the wait, logging the refusal once and counting nothing', async () => {
    mockAcquire.mockReturnValue(false);
    mockReadTopLevelState.mockReturnValue(stoppedAt('phase_timeout', 1));

    const result = await claimIssueSpawnLock(CLAIM, { attempts: 3, retryMs: 2_000, sleep });

    expect(result).toBe(false);
    expect(mockAcquire).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(mockAppendLog).toHaveBeenCalledOnce();
    expect(mockWriteTopLevelState).not.toHaveBeenCalled();
  });
});

describe('runWithOrchestratorLifecycle under a lock this process already holds', () => {
  const holdsLock = (pidStartedAt: string) => mockReadLockRecord.mockReturnValue({ pid: process.pid, pidStartedAt });

  it('runs the workflow without taking the lock again, then releases it', async () => {
    holdsLock(getProcessStartTime(process.pid) ?? '');
    const calls: string[] = [];
    mockStart.mockImplementation(() => { calls.push('startHeartbeat'); return FAKE_HANDLE; });
    mockStop.mockImplementation(() => { calls.push('stopHeartbeat'); });
    mockRelease.mockImplementation(() => { calls.push('release'); });

    const result = await runWithOrchestratorLifecycle(fakeConfig, async () => { calls.push('fn'); });

    expect(result).toBe(true);
    expect(mockAcquire).not.toHaveBeenCalled();
    expect(calls).toEqual(['startHeartbeat', 'fn', 'stopHeartbeat', 'release']);
  });

  it('takes the lock itself when the record names this pid with another start time', async () => {
    holdsLock('an-earlier-process');

    const result = await runWithOrchestratorLifecycle(fakeConfig, async () => {});

    expect(result).toBe(true);
    expect(mockAcquire).toHaveBeenCalledOnce();
  });
});
