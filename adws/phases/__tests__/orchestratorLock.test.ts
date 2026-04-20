import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../triggers/spawnGate', () => ({
  acquireIssueSpawnLock: vi.fn(),
  releaseIssueSpawnLock: vi.fn(),
}));

vi.mock('../../core/heartbeat', () => ({
  startHeartbeat: vi.fn(),
  stopHeartbeat: vi.fn(),
}));

import { acquireIssueSpawnLock, releaseIssueSpawnLock } from '../../triggers/spawnGate';
import { startHeartbeat, stopHeartbeat } from '../../core/heartbeat';
import { runWithOrchestratorLifecycle, runWithRawOrchestratorLifecycle } from '../orchestratorLock';
import type { WorkflowConfig } from '../workflowInit';
import type { RepoInfo } from '../../github/githubApi';

const mockAcquire = vi.mocked(acquireIssueSpawnLock);
const mockRelease = vi.mocked(releaseIssueSpawnLock);
const mockStart = vi.mocked(startHeartbeat);
const mockStop = vi.mocked(stopHeartbeat);

const FAKE_HANDLE = { adwId: 'test-adw-id', timer: null as unknown as ReturnType<typeof setInterval> };
const FAKE_REPO: RepoInfo = { owner: 'acme', repo: 'widgets' };

const fakeConfig = {
  issueNumber: 42,
  adwId: 'test-adw-id',
  targetRepo: { owner: 'acme', repo: 'widgets' },
} as unknown as WorkflowConfig;

beforeEach(() => {
  vi.clearAllMocks();
  mockAcquire.mockReturnValue(true);
  mockStart.mockReturnValue(FAKE_HANDLE);
});

// ─── runWithOrchestratorLifecycle ─────────────────────────────────────────────

describe('runWithOrchestratorLifecycle', () => {
  it('returns false and does not start heartbeat when acquireIssueSpawnLock returns false', async () => {
    mockAcquire.mockReturnValue(false);
    const calls: string[] = [];
    mockAcquire.mockImplementation(() => { calls.push('acquire'); return false; });

    const result = await runWithOrchestratorLifecycle(fakeConfig, async () => { calls.push('fn'); });

    expect(result).toBe(false);
    expect(calls).toEqual(['acquire']);
    expect(mockStart).not.toHaveBeenCalled();
    expect(mockStop).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('invokes start/stop heartbeat and release in order when fn resolves', async () => {
    const calls: string[] = [];
    mockAcquire.mockImplementation(() => { calls.push('acquire'); return true; });
    mockStart.mockImplementation(() => { calls.push('startHeartbeat'); return FAKE_HANDLE; });
    mockStop.mockImplementation(() => { calls.push('stopHeartbeat'); });
    mockRelease.mockImplementation(() => { calls.push('release'); });

    const result = await runWithOrchestratorLifecycle(fakeConfig, async () => { calls.push('fn'); });

    expect(result).toBe(true);
    expect(calls).toEqual(['acquire', 'startHeartbeat', 'fn', 'stopHeartbeat', 'release']);
  });

  it('still stops heartbeat and releases lock when fn throws', async () => {
    const calls: string[] = [];
    mockAcquire.mockImplementation(() => { calls.push('acquire'); return true; });
    mockStart.mockImplementation(() => { calls.push('startHeartbeat'); return FAKE_HANDLE; });
    mockStop.mockImplementation(() => { calls.push('stopHeartbeat'); });
    mockRelease.mockImplementation(() => { calls.push('release'); });

    const thrownError = new Error('phase failed');

    await expect(
      runWithOrchestratorLifecycle(fakeConfig, async () => { calls.push('fn'); throw thrownError; }),
    ).rejects.toThrow('phase failed');

    expect(calls).toEqual(['acquire', 'startHeartbeat', 'fn', 'stopHeartbeat', 'release']);
  });

  it('passes config.issueNumber and process.pid to acquireIssueSpawnLock, and config.adwId to startHeartbeat', async () => {
    await runWithOrchestratorLifecycle(fakeConfig, async () => {});

    expect(mockAcquire).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'acme', repo: 'widgets' }),
      42,
      process.pid,
    );
    expect(mockStart).toHaveBeenCalledWith('test-adw-id', expect.any(Number));
    expect(mockStop).toHaveBeenCalledWith(FAKE_HANDLE);
  });
});

// ─── runWithRawOrchestratorLifecycle ─────────────────────────────────────────

describe('runWithRawOrchestratorLifecycle', () => {
  it('returns false and does not start heartbeat when acquireIssueSpawnLock returns false', async () => {
    const calls: string[] = [];
    mockAcquire.mockImplementation(() => { calls.push('acquire'); return false; });

    const result = await runWithRawOrchestratorLifecycle(FAKE_REPO, 42, 'test-adw-id', async () => { calls.push('fn'); });

    expect(result).toBe(false);
    expect(calls).toEqual(['acquire']);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('invokes start/stop heartbeat and release in order when fn resolves', async () => {
    const calls: string[] = [];
    mockAcquire.mockImplementation(() => { calls.push('acquire'); return true; });
    mockStart.mockImplementation(() => { calls.push('startHeartbeat'); return FAKE_HANDLE; });
    mockStop.mockImplementation(() => { calls.push('stopHeartbeat'); });
    mockRelease.mockImplementation(() => { calls.push('release'); });

    const result = await runWithRawOrchestratorLifecycle(FAKE_REPO, 42, 'test-adw-id', async () => { calls.push('fn'); });

    expect(result).toBe(true);
    expect(calls).toEqual(['acquire', 'startHeartbeat', 'fn', 'stopHeartbeat', 'release']);
  });

  it('still stops heartbeat and releases lock when fn throws', async () => {
    const calls: string[] = [];
    mockAcquire.mockImplementation(() => { calls.push('acquire'); return true; });
    mockStart.mockImplementation(() => { calls.push('startHeartbeat'); return FAKE_HANDLE; });
    mockStop.mockImplementation(() => { calls.push('stopHeartbeat'); });
    mockRelease.mockImplementation(() => { calls.push('release'); });

    const thrownError = new Error('merge failed');

    await expect(
      runWithRawOrchestratorLifecycle(FAKE_REPO, 42, 'test-adw-id', async () => { calls.push('fn'); throw thrownError; }),
    ).rejects.toThrow('merge failed');

    expect(calls).toEqual(['acquire', 'startHeartbeat', 'fn', 'stopHeartbeat', 'release']);
  });
});
