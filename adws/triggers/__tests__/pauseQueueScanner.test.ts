import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
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

vi.mock('../../core', () => ({
  log: vi.fn(),
  PROBE_INTERVAL_CYCLES: 1,
  MAX_UNKNOWN_PROBE_FAILURES: 3,
  resolveClaudeCodePath: () => 'claude',
  AGENTS_STATE_DIR: '/tmp/agents-test',
}));

vi.mock('../../core/pauseQueue', () => ({
  readPauseQueue: vi.fn(),
  removeFromPauseQueue: vi.fn(),
  updatePauseQueueEntry: vi.fn(),
}));

vi.mock('../../github', () => ({
  getRepoInfo: vi.fn(() => ({ owner: 'test-owner', repo: 'test-repo' })),
  activateGitHubAppAuth: vi.fn(),
}));

vi.mock('../../phases/phaseCommentHelpers', () => ({
  postIssueStageComment: vi.fn(),
}));

vi.mock('../../providers/repoContext', () => ({
  createRepoContext: vi.fn(() => ({})),
}));

vi.mock('../../providers/types', () => ({
  Platform: { GitHub: 'github' },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import * as childProcess from 'child_process';
import * as fs from 'fs';
import { removeFromPauseQueue, updatePauseQueueEntry } from '../../core/pauseQueue';
import { postIssueStageComment } from '../../phases/phaseCommentHelpers';
import { resumeWorkflow } from '../pauseQueueScanner';
import type { PausedWorkflow } from '../../core/pauseQueue';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

/** Creates a fake ChildProcess EventEmitter with the minimal interface spawn returns. */
function makeFakeChild() {
  const emitter = new EventEmitter() as EventEmitter & {
    pid: number;
    unref: ReturnType<typeof vi.fn>;
  };
  emitter.pid = 9999;
  emitter.unref = vi.fn();
  return emitter;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resumeWorkflow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // Default: worktree exists
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.openSync).mockReturnValue(42 as unknown as ReturnType<typeof fs.openSync>);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('spawn cwd is pinned to process.cwd(), NOT entry.worktreePath', async () => {
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);

    const entry = makeEntry({ worktreePath: '/some/external/worktree' });
    const promise = resumeWorkflow(entry);
    await vi.runAllTimersAsync();
    await promise;

    const spawnCall = vi.mocked(childProcess.spawn).mock.calls[0];
    const opts = spawnCall[2] as { cwd: string };
    expect(opts.cwd).toBe(process.cwd());
    expect(opts.cwd).not.toBe(entry.worktreePath);
  });

  it('early child exit: does not remove from queue and increments probeFailures', async () => {
    const child = makeFakeChild();
    vi.mocked(childProcess.spawn).mockReturnValue(child as unknown as ReturnType<typeof childProcess.spawn>);

    const entry = makeEntry({ probeFailures: 0 });
    const promise = resumeWorkflow(entry);

    // Emit exit before readiness timeout fires
    child.emit('exit', 1, null);

    await promise;

    expect(removeFromPauseQueue).not.toHaveBeenCalled();
    expect(postIssueStageComment).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'resumed',
      expect.anything(),
    );
    expect(updatePauseQueueEntry).toHaveBeenCalledWith(
      entry.adwId,
      expect.objectContaining({ probeFailures: 1 }),
    );
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
      expect.anything(),
      entry.issueNumber,
      'resumed',
      expect.objectContaining({ adwId: entry.adwId }),
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
