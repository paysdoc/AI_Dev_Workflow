import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    openSync: vi.fn(() => 42),
    closeSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  openSync: vi.fn(() => 42),
  closeSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

const { fakeBoundary, mockBuildLaunchBoundary } = vi.hoisted(() => {
  const fakeBoundary = {
    gitContext: {},
    repoId: { owner: 'owner', repo: 'repo', platform: 'github' },
    providers: { issueTracker: {}, codeHost: {} },
  };
  return { fakeBoundary, mockBuildLaunchBoundary: vi.fn(() => fakeBoundary) };
});

vi.mock('../../core', () => ({
  log: vi.fn(),
  PROBE_INTERVAL_CYCLES: 1,
  MAX_UNKNOWN_PROBE_FAILURES: 3,
  resolveClaudeCodePath: () => 'claude',
  AGENTS_STATE_DIR: '/tmp/agents-test',
  REPO_ROOT: '/tmp/repo-root-test',
  parseTargetRepoArgs: (args: string[]) => {
    const i = args.indexOf('--target-repo');
    if (i === -1 || !args[i + 1]) return null;
    const [owner, repo] = args[i + 1].split('/');
    return { owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git` };
  },
  buildLaunchBoundary: mockBuildLaunchBoundary,
}));

vi.mock('../../core/pauseQueue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../core/pauseQueue')>()),
  readPauseQueue: vi.fn(),
  removeFromPauseQueue: vi.fn(),
  updatePauseQueueEntry: vi.fn(),
  appendToPauseQueue: vi.fn(),
}));

vi.mock('../../core/localRepoIdentity', () => ({
  readLocalRepoIdentity: vi.fn(() => ({ owner: 'test-owner', repo: 'test-repo', platform: 'github' })),
}));

vi.mock('../../phases/phaseCommentHelpers', () => ({
  postIssueStageComment: vi.fn(),
}));

vi.mock('../spawnGate', () => ({
  acquireIssueSpawnLock: vi.fn(() => true),
  releaseIssueSpawnLock: vi.fn(),
}));

vi.mock('../../core/agentState', () => ({
  AgentStateManager: {
    readTopLevelState: vi.fn(),
    writeTopLevelState: vi.fn(),
  },
}));

import * as childProcess from 'child_process';
import * as fs from 'fs';
import { readPauseQueue, removeFromPauseQueue, updatePauseQueueEntry, appendToPauseQueue } from '../../core/pauseQueue';
import { postIssueStageComment } from '../../phases/phaseCommentHelpers';
import { acquireIssueSpawnLock, releaseIssueSpawnLock } from '../spawnGate';
import { AgentStateManager } from '../../core/agentState';
import { scanPauseQueue } from '../pauseQueueScanner';
import { resumeWorkflow } from '../pauseQueueResume';
import { resetsAtIsoFromEpochSeconds, type PausedWorkflow } from '../../core/pauseQueue';
import type { AgentState } from '../../types/agentTypes';
import type { ProbeClassification } from '../rateLimitProbe';
import type { ScanningCronIdentity } from '../pauseQueueDecider';
import { INCIDENT_RESETS_AT, INCIDENT_RATE_LIMIT_TYPE } from '../../core/__tests__/fixtures/rateLimitIncident';

const NOW = new Date('2026-09-22T12:06:00Z');
const FUTURE = resetsAtIsoFromEpochSeconds(INCIDENT_RESETS_AT);
const PAST = new Date(NOW.getTime() - 60_000).toISOString();

// OWNER_CRON owns makeEntry's default `--target-repo owner/repo`. OTHER_CRON owns nothing
// makeEntry seeds by default — a stand-in for a second host process (paysdoc/devplatform in
// the 2026-09-22 incident). SELF_HOST_CRON is the identity the mocked readLocalRepoIdentity
// returns, so a target-less entry's `resolveEntryRepoInfo` fallback lines up with it.
const OWNER_CRON: ScanningCronIdentity = { repoId: { owner: 'owner', repo: 'repo' }, selfHost: false };
const OTHER_CRON: ScanningCronIdentity = { repoId: { owner: 'paysdoc', repo: 'devplatform' }, selfHost: false };
const SELF_HOST_CRON: ScanningCronIdentity = { repoId: { owner: 'test-owner', repo: 'test-repo' }, selfHost: true };

const deps = { scanningCron: OWNER_CRON, now: () => NOW };
const legacyDeps = { scanningCron: SELF_HOST_CRON, now: () => NOW };

function makeEntry(overrides: Partial<PausedWorkflow> = {}): PausedWorkflow {
  return {
    adwId: 'test-adw-123',
    issueNumber: 42,
    orchestratorScript: 'adws/adwSdlc.tsx',
    pausedAtPhase: 'plan',
    pauseReason: 'rate_limited',
    pausedAt: '2026-04-18T12:45:00Z',
    worktreePath: '/tmp/fake-worktree',
    branchName: 'fix/test-branch',
    extraArgs: ['--target-repo', 'owner/repo'],
    probeFailures: 0,
    ...overrides,
  };
}

function makeFakeChild() {
  const emitter = new EventEmitter() as EventEmitter & {
    pid: number;
    unref: ReturnType<typeof vi.fn>;
  };
  emitter.pid = 9999;
  emitter.unref = vi.fn();
  return emitter;
}

/**
 * An in-memory stand-in for `agents/paused_queue.json`, so the remove-before-spawn seam
 * tests can observe "what the file holds right now" rather than only asserting on mock
 * call arguments. `seedQueue` sets the starting state; `readPauseQueue`/`removeFromPauseQueue`/
 * `appendToPauseQueue`/`updatePauseQueueEntry` all read and write the same variable, mirroring
 * the real module's dedupe-by-adwId and no-op-when-absent semantics. A test that instead calls
 * `.mockReturnValue(...)`/`.mockReturnValueOnce(...)` on one of these mocks overrides this
 * default implementation for that call, exactly as before this queue was introduced.
 */
let queue: PausedWorkflow[] = [];

function seedQueue(entries: PausedWorkflow[]): void {
  queue = [...entries];
}

function installQueueMocks(): void {
  vi.mocked(readPauseQueue).mockImplementation(() => queue);
  vi.mocked(removeFromPauseQueue).mockImplementation((adwId: string) => {
    queue = queue.filter((e) => e.adwId !== adwId);
  });
  vi.mocked(appendToPauseQueue).mockImplementation((entry: PausedWorkflow) => {
    if (queue.some((e) => e.adwId === entry.adwId)) return;
    queue = [...queue, entry];
  });
  vi.mocked(updatePauseQueueEntry).mockImplementation((adwId: string, updates: Partial<PausedWorkflow>) => {
    queue = queue.map((e) => (e.adwId === adwId ? { ...e, ...updates } : e));
  });
}

describe('resumeWorkflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    queue = [];
    installQueueMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.openSync).mockReturnValue(42 as unknown as ReturnType<typeof fs.openSync>);
    // Default: canonical claim passes (lock free, state matches default makeEntry adwId)
    vi.mocked(acquireIssueSpawnLock).mockReturnValue(true);
    vi.mocked(AgentStateManager.readTopLevelState).mockReturnValue({
      adwId: 'test-adw-123',
    } as unknown as AgentState);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("worktree gone: removes from queue and posts an error comment through the entry's own boundary", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const entry = makeEntry({ worktreePath: '/tmp/missing-worktree' });
    await resumeWorkflow(entry);

    expect(removeFromPauseQueue).toHaveBeenCalledWith(entry.adwId);
    expect(postIssueStageComment).toHaveBeenCalledWith(
      fakeBoundary.providers,
      entry.issueNumber,
      'error',
      expect.objectContaining({ errorMessage: expect.stringContaining('worktree no longer exists') }),
    );
  });

  it("builds the boundary from the entry's own --target-repo args, not the cron host's cwd (the bug-fix proof)", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const entry = makeEntry({ extraArgs: ['--target-repo', 'acme/webapp'] });
    await resumeWorkflow(entry);

    expect(mockBuildLaunchBoundary).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'webapp',
      cloneUrl: 'https://github.com/acme/webapp.git',
    });
  });

  it('a throwing buildLaunchBoundary is swallowed — logs a warning instead of crashing the scan', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockBuildLaunchBoundary.mockImplementationOnce(() => {
      throw new Error('no resolvable token for acme/webapp');
    });

    const entry = makeEntry();

    await expect(resumeWorkflow(entry)).resolves.toBeUndefined();
    expect(postIssueStageComment).not.toHaveBeenCalled();
  });

  it('spawn stdio includes a log file fd (not the string "ignore")', async () => {
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);

    const entry = makeEntry();
    const promise = resumeWorkflow(entry);

    // Advance past readiness window so the happy path completes
    await vi.runAllTimersAsync();
    await promise;

    expect(fs.openSync).toHaveBeenCalledWith(
      expect.stringContaining(`paused_queue_logs/${entry.adwId}.resume.log`),
      'a',
    );

    const spawnCall = vi.mocked(childProcess.spawn).mock.calls[0];
    const opts = spawnCall[2] as { stdio: unknown };
    expect(Array.isArray(opts.stdio)).toBe(true);
    const stdioArr = opts.stdio as unknown[];
    expect(typeof stdioArr[1]).toBe('number');
    expect(typeof stdioArr[2]).toBe('number');
  });

  it('spawn cwd is pinned to REPO_ROOT, NOT entry.worktreePath', async () => {
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);

    const entry = makeEntry({ worktreePath: '/some/external/worktree' });
    const promise = resumeWorkflow(entry);
    await vi.runAllTimersAsync();
    await promise;

    const spawnCall = vi.mocked(childProcess.spawn).mock.calls[0];
    const opts = spawnCall[2] as { cwd: string };
    expect(opts.cwd).toBe('/tmp/repo-root-test');
    expect(opts.cwd).not.toBe(entry.worktreePath);
  });

  it('early child exit: re-appends the entry with probeFailures incremented', async () => {
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);

    const entry = makeEntry({ probeFailures: 0 });
    seedQueue([entry]);
    const promise = resumeWorkflow(entry, { now: () => NOW });

    // Emit exit before readiness timeout fires
    child.emit('exit', 1, null);

    await promise;

    expect(removeFromPauseQueue).toHaveBeenCalledWith(entry.adwId);
    expect(appendToPauseQueue).toHaveBeenCalledWith(
      expect.objectContaining({ adwId: entry.adwId, probeFailures: 1, lastProbeAt: NOW.toISOString() }),
    );
    expect(updatePauseQueueEntry).not.toHaveBeenCalled();
    expect(postIssueStageComment).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'resumed',
      expect.anything(),
    );
    expect(readPauseQueue()).toHaveLength(1);
    expect(readPauseQueue()[0]).toMatchObject({ adwId: entry.adwId, probeFailures: 1 });
  });

  it("an 'error' event before the readiness timer fires re-appends the entry with probeFailures incremented", async () => {
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);

    const entry = makeEntry({ probeFailures: 1 });
    seedQueue([entry]);
    const promise = resumeWorkflow(entry, { now: () => NOW });

    child.emit('error', new Error('spawn EACCES'));

    await promise;

    expect(appendToPauseQueue).toHaveBeenCalledWith(
      expect.objectContaining({ adwId: entry.adwId, probeFailures: 2, lastProbeAt: NOW.toISOString() }),
    );
    expect(readPauseQueue()).toHaveLength(1);
  });

  it('a spawn seam that throws synchronously resolves (never rejects), re-appends the entry with a strike, and closes the log fd', async () => {
    const entry = makeEntry({ probeFailures: 0 });
    seedQueue([entry]);
    const spawnSeam = vi.fn(() => {
      throw new Error('spawn ENOENT');
    });

    await expect(resumeWorkflow(entry, { spawn: spawnSeam, now: () => NOW })).resolves.toBeUndefined();

    expect(appendToPauseQueue).toHaveBeenCalledWith(
      expect.objectContaining({ adwId: entry.adwId, probeFailures: 1 }),
    );
    expect(fs.closeSync).toHaveBeenCalledWith(42);
  });

  it('a legacy entry with probeFailures absent whose spawn fails is re-appended with 1', async () => {
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);

    const entry = makeEntry({ probeFailures: undefined });
    seedQueue([entry]);
    const promise = resumeWorkflow(entry, { now: () => NOW });
    child.emit('exit', 1, null);
    await promise;

    expect(appendToPauseQueue).toHaveBeenCalledWith(expect.objectContaining({ probeFailures: 1 }));
  });

  it('re-appending after the entry is already back in the queue does not duplicate it (adwId dedupe)', async () => {
    const entry = makeEntry({ probeFailures: 0 });
    seedQueue([entry]);
    const spawnSeam = vi.fn(() => {
      // Simulate a concurrent re-append racing this resume (e.g. another process).
      seedQueue([entry]);
      throw new Error('spawn ENOENT');
    });

    await resumeWorkflow(entry, { spawn: spawnSeam, now: () => NOW });

    expect(readPauseQueue().filter((e) => e.adwId === entry.adwId)).toHaveLength(1);
  });

  it('removes the entry before the spawn seam is invoked — the queue is already empty at the moment of the spawn', async () => {
    const entry = makeEntry();
    seedQueue([entry]);
    const child = makeFakeChild();
    let seenAtSpawn: string[] = [];
    const spawnSeam = vi.fn(() => {
      seenAtSpawn = readPauseQueue().map((e) => e.adwId);
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });

    const promise = resumeWorkflow(entry, { spawn: spawnSeam, now: () => NOW });
    await vi.runAllTimersAsync();
    await promise;

    expect(seenAtSpawn).not.toContain(entry.adwId);
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(readPauseQueue()).toEqual([]);
    expect(postIssueStageComment).toHaveBeenCalledWith(
      fakeBoundary.providers,
      entry.issueNumber,
      'resumed',
      expect.objectContaining({ adwId: entry.adwId }),
    );
    expect(child.unref).toHaveBeenCalledOnce();

    // The ordering is the contract: removeFromPauseQueue must run strictly before the spawn seam.
    const removeOrder = vi.mocked(removeFromPauseQueue).mock.invocationCallOrder[0];
    const spawnOrder = spawnSeam.mock.invocationCallOrder[0];
    expect(removeOrder).toBeLessThan(spawnOrder);
  });

  it('happy path: removes from queue and posts resumed comment after readiness window', async () => {
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);

    const entry = makeEntry();
    const promise = resumeWorkflow(entry);

    // No early exit — advance past readiness window
    await vi.runAllTimersAsync();
    await promise;

    expect(removeFromPauseQueue).toHaveBeenCalledOnce();
    expect(removeFromPauseQueue).toHaveBeenCalledWith(entry.adwId);
    expect(postIssueStageComment).toHaveBeenCalledWith(
      fakeBoundary.providers,
      entry.issueNumber,
      'resumed',
      expect.objectContaining({ adwId: entry.adwId }),
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it('resume with matching claim proceeds to spawn and commits side-effects', async () => {
    vi.mocked(acquireIssueSpawnLock).mockReturnValue(true);
    vi.mocked(AgentStateManager.readTopLevelState).mockReturnValue({
      adwId: 'test-adw-123',
    } as unknown as AgentState);
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);

    const entry = makeEntry({ adwId: 'test-adw-123' });
    const promise = resumeWorkflow(entry);
    await vi.runAllTimersAsync();
    await promise;

    expect(acquireIssueSpawnLock).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'owner', repo: 'repo' }),
      entry.issueNumber,
      process.pid,
    );
    expect(releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(childProcess.spawn).toHaveBeenCalledOnce();
    expect(removeFromPauseQueue).toHaveBeenCalledWith(entry.adwId);
    expect(postIssueStageComment).toHaveBeenCalledWith(
      fakeBoundary.providers,
      entry.issueNumber,
      'resumed',
      expect.objectContaining({ adwId: entry.adwId }),
    );
  });

  it('aborts when top-level state adwId diverges from the entry adwId', async () => {
    vi.mocked(acquireIssueSpawnLock).mockReturnValue(true);
    vi.mocked(AgentStateManager.readTopLevelState).mockReturnValue({
      adwId: 'someone-else-adw',
    } as unknown as AgentState);

    const entry = makeEntry({ adwId: 'test-adw-123' });
    await resumeWorkflow(entry);

    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(removeFromPauseQueue).toHaveBeenCalledWith(entry.adwId);
    expect(postIssueStageComment).toHaveBeenCalledWith(
      fakeBoundary.providers,
      entry.issueNumber,
      'error',
      expect.objectContaining({
        errorMessage: expect.stringContaining('canonical claim diverged'),
      }),
    );
  });

  it('aborts when top-level state file is missing', async () => {
    vi.mocked(acquireIssueSpawnLock).mockReturnValue(true);
    vi.mocked(AgentStateManager.readTopLevelState).mockReturnValue(null);

    const entry = makeEntry({ adwId: 'test-adw-123' });
    await resumeWorkflow(entry);

    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(removeFromPauseQueue).toHaveBeenCalledWith(entry.adwId);
    expect(postIssueStageComment).toHaveBeenCalledWith(
      fakeBoundary.providers,
      entry.issueNumber,
      'error',
      expect.objectContaining({
        errorMessage: expect.stringContaining('missing state file'),
      }),
    );
  });

  it('aborts when spawn lock is already held by another live process, and neither removes nor strikes the entry', async () => {
    vi.mocked(acquireIssueSpawnLock).mockReturnValue(false);

    const entry = makeEntry();
    seedQueue([entry]);
    await resumeWorkflow(entry, { now: () => NOW });

    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(AgentStateManager.readTopLevelState).not.toHaveBeenCalled();
    expect(releaseIssueSpawnLock).not.toHaveBeenCalled();
    expect(removeFromPauseQueue).not.toHaveBeenCalled();
    expect(appendToPauseQueue).not.toHaveBeenCalled();
    expect(updatePauseQueueEntry).not.toHaveBeenCalled();
    expect(postIssueStageComment).not.toHaveBeenCalled();
    expect(readPauseQueue()).toEqual([entry]);
  });

  it('uses the target repo from extraArgs for spawn-lock, not the cwd-resolved repo', async () => {
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);

    // entry carries --target-repo owner/repo; getRepoInfo() returns test-owner/test-repo (the cwd fallback)
    const entry = makeEntry({ extraArgs: ['--target-repo', 'owner/repo'] });
    const promise = resumeWorkflow(entry);
    await vi.runAllTimersAsync();
    await promise;

    expect(acquireIssueSpawnLock).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'owner', repo: 'repo' }),
      entry.issueNumber,
      process.pid,
    );
  });

  it('falls back to getRepoInfo() when entry has no extraArgs (framework self-hosting workflow)', async () => {
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);

    vi.mocked(AgentStateManager.readTopLevelState).mockReturnValue({
      adwId: 'test-adw-123',
    } as unknown as AgentState);

    const entry = makeEntry({ extraArgs: undefined });
    const promise = resumeWorkflow(entry);
    await vi.runAllTimersAsync();
    await promise;

    // Falls back to getRepoInfo() which returns { owner: 'test-owner', repo: 'test-repo' }
    expect(acquireIssueSpawnLock).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'test-owner', repo: 'test-repo' }),
      entry.issueNumber,
      process.pid,
    );
  });
});

describe('scanPauseQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    queue = [];
    installQueueMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.openSync).mockReturnValue(42 as unknown as ReturnType<typeof fs.openSync>);
    vi.mocked(acquireIssueSpawnLock).mockReturnValue(true);
    vi.mocked(AgentStateManager.readTopLevelState).mockReturnValue({
      adwId: 'test-adw-123',
    } as unknown as AgentState);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a "limited" outcome does not touch probeFailures, remove the entry, or post a comment', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', probeFailures: 2 });
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const probe: () => ProbeClassification = () => ({ verdict: 'limited' });

    await scanPauseQueue(1, probe, { scanningCron: OWNER_CRON });

    expect(updatePauseQueueEntry).toHaveBeenCalledOnce();
    const [adwId, updates] = vi.mocked(updatePauseQueueEntry).mock.calls[0];
    expect(adwId).toBe(entry.adwId);
    expect(updates).toHaveProperty('lastProbeAt');
    expect(updates).not.toHaveProperty('probeFailures');
    expect(removeFromPauseQueue).not.toHaveBeenCalled();
    expect(postIssueStageComment).not.toHaveBeenCalled();
  });

  it('an "unknown" outcome below the cap increments probeFailures without removing the entry', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', probeFailures: 0 });
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const probe: () => ProbeClassification = () => ({ verdict: 'unknown' });

    await scanPauseQueue(1, probe, { scanningCron: OWNER_CRON });

    expect(updatePauseQueueEntry).toHaveBeenCalledWith(
      entry.adwId,
      expect.objectContaining({ probeFailures: 1 }),
    );
    expect(removeFromPauseQueue).not.toHaveBeenCalled();
  });

  it('an "unknown" outcome at the failure cap drops the entry and posts the manual-restart comment', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', probeFailures: 2 });
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const probe: () => ProbeClassification = () => ({ verdict: 'unknown' });

    await scanPauseQueue(1, probe, { scanningCron: OWNER_CRON });

    expect(removeFromPauseQueue).toHaveBeenCalledWith(entry.adwId);
    expect(postIssueStageComment).toHaveBeenCalledWith(
      fakeBoundary.providers,
      entry.issueNumber,
      'error',
      expect.objectContaining({ errorMessage: expect.stringContaining('failed to resume after 3 probe attempts') }),
    );
  });

  it('a "failed" outcome below the cap increments probeFailures without removing the entry', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', probeFailures: 0 });
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const probe: () => ProbeClassification = () => ({ verdict: 'failed' });

    await scanPauseQueue(1, probe, { scanningCron: OWNER_CRON });

    expect(updatePauseQueueEntry).toHaveBeenCalledWith(
      entry.adwId,
      expect.objectContaining({ probeFailures: 1 }),
    );
    expect(removeFromPauseQueue).not.toHaveBeenCalled();
  });

  it('a "failed" outcome at the cap drops the entry and posts the manual-restart comment', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', probeFailures: 2 });
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const probe: () => ProbeClassification = () => ({ verdict: 'failed' });

    await scanPauseQueue(1, probe, { scanningCron: OWNER_CRON });

    expect(removeFromPauseQueue).toHaveBeenCalledWith(entry.adwId);
    expect(postIssueStageComment).toHaveBeenCalledWith(
      fakeBoundary.providers,
      entry.issueNumber,
      'error',
      expect.objectContaining({ errorMessage: expect.stringContaining('failed to resume after 3 probe attempts') }),
    );
  });

  it('a "clear" outcome resumes the queued workflow', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123' });
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);
    const probe: () => ProbeClassification = () => ({ verdict: 'clear' });

    const promise = scanPauseQueue(1, probe, { scanningCron: OWNER_CRON });
    await vi.runAllTimersAsync();
    await promise;

    expect(childProcess.spawn).toHaveBeenCalledOnce();
    expect(removeFromPauseQueue).toHaveBeenCalledWith(entry.adwId);
  });

  it('probes exactly once per scan regardless of queue size', async () => {
    const entryA = makeEntry({ adwId: 'test-adw-123', issueNumber: 1 });
    const entryB = makeEntry({ adwId: 'test-adw-456', issueNumber: 2 });
    vi.mocked(readPauseQueue).mockReturnValue([entryA, entryB]);
    const probe = vi.fn<() => ProbeClassification>(() => ({ verdict: 'limited' }));

    await scanPauseQueue(1, probe, { scanningCron: OWNER_CRON });

    expect(probe).toHaveBeenCalledOnce();
    expect(updatePauseQueueEntry).toHaveBeenCalledTimes(2);
  });

  it('does not invoke the probe when every entry is still before its reset time', async () => {
    const entryA = makeEntry({ adwId: 'test-adw-123', issueNumber: 1, resetsAt: FUTURE });
    const entryB = makeEntry({ adwId: 'test-adw-456', issueNumber: 2, resetsAt: FUTURE });
    vi.mocked(readPauseQueue).mockReturnValue([entryA, entryB]);
    const probe = vi.fn<() => ProbeClassification>(() => ({ verdict: 'clear' }));

    await scanPauseQueue(1, probe, deps);

    expect(probe).not.toHaveBeenCalled();
    expect(updatePauseQueueEntry).not.toHaveBeenCalled();
    expect(removeFromPauseQueue).not.toHaveBeenCalled();
    expect(postIssueStageComment).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('probes once when at least one entry is due and leaves the still-waiting entry untouched', async () => {
    const waiting = makeEntry({ adwId: 'waiting-adw', issueNumber: 1, resetsAt: FUTURE });
    const due = makeEntry({ adwId: 'due-adw', issueNumber: 2, resetsAt: PAST });
    const legacy = makeEntry({ adwId: 'legacy-adw', issueNumber: 3, resetsAt: undefined });
    vi.mocked(readPauseQueue).mockReturnValue([waiting, due, legacy]);
    const probe = vi.fn<() => ProbeClassification>(() => ({ verdict: 'limited' }));

    await scanPauseQueue(1, probe, deps);

    expect(probe).toHaveBeenCalledOnce();
    expect(updatePauseQueueEntry).toHaveBeenCalledTimes(2);
    expect(updatePauseQueueEntry).toHaveBeenCalledWith('due-adw', { lastProbeAt: NOW.toISOString() });
    expect(updatePauseQueueEntry).toHaveBeenCalledWith('legacy-adw', { lastProbeAt: NOW.toISOString() });
    expect(updatePauseQueueEntry).not.toHaveBeenCalledWith('waiting-adw', expect.anything());
  });

  it('a limited probe that reports a reset time refreshes the entry and never increments probeFailures', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', probeFailures: 2, resetsAt: PAST });
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const probe: () => ProbeClassification = () => ({ verdict: 'limited', rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT });

    await scanPauseQueue(1, probe, deps);

    expect(updatePauseQueueEntry).toHaveBeenCalledWith('test-adw-123', {
      lastProbeAt: NOW.toISOString(),
      resetsAt: FUTURE,
      rateLimitType: INCIDENT_RATE_LIMIT_TYPE,
    });
    expect(removeFromPauseQueue).not.toHaveBeenCalled();
    expect(postIssueStageComment).not.toHaveBeenCalled();
  });

  it('a limited probe on a legacy entry gains the reported reset time', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', resetsAt: undefined });
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const probe: () => ProbeClassification = () => ({ verdict: 'limited', rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT });

    await scanPauseQueue(1, probe, deps);

    expect(updatePauseQueueEntry).toHaveBeenCalledWith('test-adw-123', {
      lastProbeAt: NOW.toISOString(),
      resetsAt: FUTURE,
      rateLimitType: INCIDENT_RATE_LIMIT_TYPE,
    });
  });

  it('a limited probe naming a limit type but reporting no reset time writes only lastProbeAt', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', resetsAt: undefined });
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const probe: () => ProbeClassification = () => ({ verdict: 'limited', rateLimitType: INCIDENT_RATE_LIMIT_TYPE });

    await scanPauseQueue(1, probe, deps);

    expect(updatePauseQueueEntry).toHaveBeenCalledWith('test-adw-123', { lastProbeAt: NOW.toISOString() });
  });

  it('a clear probe after the reset time resumes the workflow', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', resetsAt: PAST });
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);
    const probe: () => ProbeClassification = () => ({ verdict: 'clear' });

    const promise = scanPauseQueue(1, probe, deps);
    await vi.runAllTimersAsync();
    await promise;

    expect(childProcess.spawn).toHaveBeenCalledOnce();
    expect(removeFromPauseQueue).toHaveBeenCalledWith('test-adw-123');
  });

  it('eviction names ## Retry, keeps the manual-restart phrase, and writes no top-level state', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', probeFailures: 2 });
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const probe: () => ProbeClassification = () => ({ verdict: 'failed' });

    await scanPauseQueue(1, probe, deps);

    expect(removeFromPauseQueue).toHaveBeenCalledWith('test-adw-123');
    expect(postIssueStageComment).toHaveBeenCalledWith(
      fakeBoundary.providers,
      entry.issueNumber,
      'error',
      expect.objectContaining({
        errorMessage: expect.stringMatching(/failed to resume after 3 probe attempts[\s\S]*## Retry/),
      }),
    );
    expect(AgentStateManager.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('eviction on an unknown verdict mentions the result could not be classified', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', probeFailures: 2 });
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const probe: () => ProbeClassification = () => ({ verdict: 'unknown' });

    await scanPauseQueue(1, probe, deps);

    expect(postIssueStageComment).toHaveBeenCalledWith(
      fakeBoundary.providers,
      entry.issueNumber,
      'error',
      expect.objectContaining({ errorMessage: expect.stringContaining('could not be classified') }),
    );
  });

  it('a legacy JSON entry (no probeFailures, no new fields) is handled exactly as before, under the self-host cron', async () => {
    const entry = JSON.parse(
      '{"adwId":"legacy-1","issueNumber":7,"orchestratorScript":"adws/adwSdlc.tsx","pausedAtPhase":"plan","pauseReason":"rate_limited","pausedAt":"2026-04-18T12:45:00Z","worktreePath":"/tmp/w","branchName":"b"}',
    ) as PausedWorkflow;
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const probe = vi.fn<() => ProbeClassification>(() => ({ verdict: 'unknown' }));

    await scanPauseQueue(1, probe, legacyDeps);

    expect(updatePauseQueueEntry).toHaveBeenCalledWith('legacy-1', expect.objectContaining({ probeFailures: 1 }));
    expect(probe).toHaveBeenCalledOnce();
  });

  it('uses the injected clock for lastProbeAt', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', resetsAt: undefined });
    vi.mocked(readPauseQueue).mockReturnValue([entry]);
    const probe: () => ProbeClassification = () => ({ verdict: 'limited' });

    await scanPauseQueue(1, probe, deps);

    expect(updatePauseQueueEntry).toHaveBeenCalledWith('test-adw-123', { lastProbeAt: NOW.toISOString() });
  });

  it('a non-owning cron scan calls no probe and writes nothing, because nothing in the queue is owned', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', probeFailures: 0 });
    seedQueue([entry]);
    const probe = vi.fn<() => ProbeClassification>(() => ({ verdict: 'failed' }));

    await scanPauseQueue(1, probe, { scanningCron: OTHER_CRON, now: () => NOW });

    expect(probe).not.toHaveBeenCalled();
    expect(updatePauseQueueEntry).not.toHaveBeenCalled();
    expect(removeFromPauseQueue).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(postIssueStageComment).not.toHaveBeenCalled();
  });

  it('a mixed queue probes once and only the owned entry is struck — the foreign entry is untouched', async () => {
    const owned = makeEntry({ adwId: 'owned-adw', issueNumber: 1, probeFailures: 0 });
    const foreign = makeEntry({ adwId: 'foreign-adw', issueNumber: 2, extraArgs: ['--target-repo', 'paysdoc/devplatform'], probeFailures: 0 });
    seedQueue([owned, foreign]);
    const probe = vi.fn<() => ProbeClassification>(() => ({ verdict: 'failed' }));

    await scanPauseQueue(1, probe, { scanningCron: OWNER_CRON, now: () => NOW });

    expect(probe).toHaveBeenCalledOnce();
    expect(updatePauseQueueEntry).toHaveBeenCalledOnce();
    expect(updatePauseQueueEntry).toHaveBeenCalledWith('owned-adw', expect.objectContaining({ probeFailures: 1 }));
    expect(updatePauseQueueEntry).not.toHaveBeenCalledWith('foreign-adw', expect.anything());
  });

  it('a due foreign entry never triggers the probe while the owned entry still waits for its reset time', async () => {
    const owned = makeEntry({ adwId: 'owned-adw', issueNumber: 1, resetsAt: FUTURE });
    const foreign = makeEntry({ adwId: 'foreign-adw', issueNumber: 2, extraArgs: ['--target-repo', 'paysdoc/devplatform'] });
    seedQueue([owned, foreign]);
    const probe = vi.fn<() => ProbeClassification>(() => ({ verdict: 'failed' }));

    await scanPauseQueue(1, probe, { scanningCron: OWNER_CRON, now: () => NOW });

    expect(probe).not.toHaveBeenCalled();
    expect(updatePauseQueueEntry).not.toHaveBeenCalled();
    expect(removeFromPauseQueue).not.toHaveBeenCalled();
  });

  it('a legacy entry with no extraArgs is resumed by the self-host cron on a clear probe', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', extraArgs: undefined });
    seedQueue([entry]);
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);
    const probe: () => ProbeClassification = () => ({ verdict: 'clear' });

    const promise = scanPauseQueue(1, probe, legacyDeps);
    await vi.runAllTimersAsync();
    await promise;

    expect(childProcess.spawn).toHaveBeenCalledOnce();
    expect(readPauseQueue()).toEqual([]);
  });

  it('a legacy entry with no extraArgs is left alone by a --target-repo cron', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123', extraArgs: undefined });
    seedQueue([entry]);
    const probe = vi.fn<() => ProbeClassification>(() => ({ verdict: 'clear' }));

    await scanPauseQueue(1, probe, deps);

    expect(probe).not.toHaveBeenCalled();
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(readPauseQueue()).toEqual([entry]);
  });

  it('a clear probe over a mixed queue spawns exactly the owned entry, leaving the foreign one queued', async () => {
    const owned = makeEntry({ adwId: 'owned-adw', issueNumber: 1 });
    const foreign = makeEntry({ adwId: 'foreign-adw', issueNumber: 2, extraArgs: ['--target-repo', 'paysdoc/devplatform'] });
    seedQueue([owned, foreign]);
    vi.mocked(AgentStateManager.readTopLevelState).mockReturnValue({ adwId: 'owned-adw' } as unknown as AgentState);
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);
    const probe: () => ProbeClassification = () => ({ verdict: 'clear' });

    const promise = scanPauseQueue(1, probe, { scanningCron: OWNER_CRON, now: () => NOW });
    await vi.runAllTimersAsync();
    await promise;

    expect(childProcess.spawn).toHaveBeenCalledOnce();
    const remaining = readPauseQueue();
    expect(remaining.map((e) => e.adwId)).toEqual(['foreign-adw']);
  });

  it('through the scanner, the queue no longer holds the entry at the moment the spawn seam is invoked', async () => {
    const entry = makeEntry({ adwId: 'test-adw-123' });
    seedQueue([entry]);
    const child = makeFakeChild();
    let seenAtSpawn: string[] = [];
    const spawnSeam = vi.fn(() => {
      seenAtSpawn = readPauseQueue().map((e) => e.adwId);
      return child as unknown as ReturnType<typeof childProcess.spawn>;
    });

    const promise = scanPauseQueue(1, () => ({ verdict: 'clear' }), { ...deps, spawn: spawnSeam });
    await vi.runAllTimersAsync();
    await promise;

    expect(seenAtSpawn).not.toContain(entry.adwId);
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(readPauseQueue()).toEqual([]);
  });
});
