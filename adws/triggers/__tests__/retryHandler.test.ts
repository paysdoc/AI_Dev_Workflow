import { describe, it, expect, vi } from 'vitest';
import { handleRetryDirective, decideRetryAction, type RetryAction, type RetryHandlerDeps } from '../retryHandler';
import { log } from '../../core/logger';
import type { AgentState } from '../../types/agentTypes';
import type { PausedWorkflow } from '../../core/pauseQueue';

vi.mock('../../core/logger', () => ({ log: vi.fn() }));

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    adwId: 'test-adw-id',
    issueNumber: 42,
    agentName: 'sdlc-orchestrator',
    execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
    workflowStage: 'merge_blocked',
    ...overrides,
  };
}

function makeDeps(state: AgentState | null = makeState(), overrides: Partial<RetryHandlerDeps> = {}): RetryHandlerDeps {
  return {
    readTopLevelState: vi.fn().mockReturnValue(state),
    writeTopLevelState: vi.fn(),
    findPauseQueueEntry: vi.fn().mockReturnValue(null),
    removeFromPauseQueue: vi.fn(),
    acquireIssueSpawnLock: vi.fn().mockReturnValue(true),
    releaseIssueSpawnLock: vi.fn(),
    spawnDetached: vi.fn(),
    postStageComment: vi.fn(),
    targetRepoArgs: ['--target-repo', 'acme/widgets'],
    ...overrides,
  };
}

function makePauseQueueEntry(overrides: Partial<PausedWorkflow> = {}): PausedWorkflow {
  return {
    adwId: 'test-adw-id',
    issueNumber: 42,
    orchestratorScript: 'adws/adwChore.tsx',
    pausedAtPhase: 'build',
    pauseReason: 'rate_limited',
    pausedAt: '2026-01-01T00:00:00Z',
    worktreePath: '/tmp/adw-fixture-worktree',
    branchName: 'feature-issue-42-test-adw-id',
    ...overrides,
  };
}

const ADW_COMMENT = { body: '**ADW ID:** `test-adw-id`' };

describe('handleRetryDirective', () => {
  it('resets merge_blocked → awaiting_merge and clears retry counter, returns true', () => {
    const deps = makeDeps(makeState({ workflowStage: 'merge_blocked', mergeRetryCount: 2 }));

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(true);
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', {
      workflowStage: 'awaiting_merge',
      mergeRetryCount: 0,
    });
  });

  it('does not write and returns false when workflowStage is awaiting_merge', () => {
    const deps = makeDeps(makeState({ workflowStage: 'awaiting_merge' }));

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('does not write and returns false when workflowStage is completed', () => {
    const deps = makeDeps(makeState({ workflowStage: 'completed' }));

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('does not write and returns false when workflowStage is abandoned', () => {
    const deps = makeDeps(makeState({ workflowStage: 'abandoned' }));

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('does not read/write and returns false when comments have no adw-id', () => {
    const deps = makeDeps();

    const result = handleRetryDirective(42, [{ body: 'no adw id here' }], deps);

    expect(result).toBe(false);
    expect(deps.readTopLevelState).not.toHaveBeenCalled();
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('does not write and returns false when readTopLevelState returns null', () => {
    const deps = makeDeps(null);

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('does not write and returns false when comments are empty', () => {
    const deps = makeDeps();

    const result = handleRetryDirective(42, [], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('re-arms human_gated → phase_timeout with resumeAttempts:0 and returns true', () => {
    const deps = makeDeps(makeState({ workflowStage: 'human_gated', resumeAttempts: 3 }));

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(true);
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', {
      workflowStage: 'phase_timeout',
      resumeAttempts: 0,
    });
  });

  it('does not write and returns false when workflowStage is phase_timeout', () => {
    const deps = makeDeps(makeState({ workflowStage: 'phase_timeout' }));

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('re-arms review_failed → phase_timeout with resumeAttempts:0 and returns true', () => {
    const deps = makeDeps(makeState({ workflowStage: 'review_failed', resumeAttempts: 2 }));

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(true);
    expect(deps.writeTopLevelState).toHaveBeenCalledWith('test-adw-id', {
      workflowStage: 'phase_timeout',
      resumeAttempts: 0,
    });
  });

  it('does not write and returns false when workflowStage is review_passed', () => {
    const deps = makeDeps(makeState({ workflowStage: 'review_passed' }));

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('merge_blocked touches none of the paused-path seams (regression pin)', () => {
    const deps = makeDeps(makeState({ workflowStage: 'merge_blocked', mergeRetryCount: 1 }));

    handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(deps.findPauseQueueEntry).not.toHaveBeenCalled();
    expect(deps.removeFromPauseQueue).not.toHaveBeenCalled();
    expect(deps.acquireIssueSpawnLock).not.toHaveBeenCalled();
    expect(deps.spawnDetached).not.toHaveBeenCalled();
    expect(deps.postStageComment).not.toHaveBeenCalled();
  });
});

describe('decideRetryAction', () => {
  const cases: Array<[string | undefined, RetryAction]> = [
    ['merge_blocked', { kind: 'reset_merge_blocked' }],
    ['human_gated', { kind: 'rearm_phase_timeout', from: 'human_gated' }],
    ['review_failed', { kind: 'rearm_phase_timeout', from: 'review_failed' }],
    ['paused', { kind: 'resume_paused' }],
    ['paused_auth', { kind: 'noop', reason: 'paused_auth' }],
    ['starting', { kind: 'noop', reason: 'active' }],
    ['resuming', { kind: 'noop', reason: 'active' }],
    ['build_running', { kind: 'noop', reason: 'active' }],
    ['plan_running', { kind: 'noop', reason: 'active' }],
    ['stepDef_running', { kind: 'noop', reason: 'active' }],
    ['completed', { kind: 'noop', reason: 'not_retriable' }],
    ['abandoned', { kind: 'noop', reason: 'not_retriable' }],
    ['awaiting_merge', { kind: 'noop', reason: 'not_retriable' }],
    ['phase_timeout', { kind: 'noop', reason: 'not_retriable' }],
    ['review_passed', { kind: 'noop', reason: 'not_retriable' }],
    ['build_completed', { kind: 'noop', reason: 'not_retriable' }],
    [undefined, { kind: 'noop', reason: 'no_state' }],
    ['', { kind: 'noop', reason: 'no_state' }],
  ];

  for (const [stage, expected] of cases) {
    it(`maps ${JSON.stringify(stage)} to ${JSON.stringify(expected)}`, () => {
      expect(decideRetryAction(stage)).toEqual(expected);
    });
  }
});

describe('handleRetryDirective — paused', () => {
  it('with a live queue entry: removes it before spawning, spawns once, posts the resumed comment, writes no state', () => {
    const state = makeState({ workflowStage: 'paused', orchestratorScript: 'adws/adwChore.tsx', issueNumber: 42 });
    const entry = makePauseQueueEntry({ pausedAtPhase: 'build' });
    const deps = makeDeps(state, { findPauseQueueEntry: vi.fn().mockReturnValue(entry) });

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(true);
    expect(deps.removeFromPauseQueue).toHaveBeenCalledOnce();
    expect(deps.removeFromPauseQueue).toHaveBeenCalledWith('test-adw-id');
    expect(deps.spawnDetached).toHaveBeenCalledOnce();
    expect(deps.spawnDetached).toHaveBeenCalledWith('bunx', ['tsx', 'adws/adwChore.tsx', '42', 'test-adw-id', '--target-repo', 'acme/widgets']);
    expect(deps.postStageComment).toHaveBeenCalledOnce();
    expect(deps.postStageComment).toHaveBeenCalledWith(42, 'resumed', expect.objectContaining({
      adwId: 'test-adw-id',
      issueNumber: 42,
      pausedAtPhase: 'build',
    }));
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
  });

  it('with no queue entry: still spawns once, removal is a harmless no-op, comment posted without pausedAtPhase', () => {
    const state = makeState({ workflowStage: 'paused', orchestratorScript: 'adws/adwChore.tsx', issueNumber: 42 });
    const deps = makeDeps(state);

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(true);
    expect(deps.removeFromPauseQueue).toHaveBeenCalledOnce();
    expect(deps.removeFromPauseQueue).toHaveBeenCalledWith('test-adw-id');
    expect(deps.spawnDetached).toHaveBeenCalledOnce();
    expect(deps.postStageComment).toHaveBeenCalledWith(42, 'resumed', expect.objectContaining({
      adwId: 'test-adw-id',
      issueNumber: 42,
      pausedAtPhase: undefined,
    }));
  });

  it('spawns DEFAULT_RESUME_SCRIPT (adws/adwSdlc.tsx) when orchestratorScript is absent', () => {
    const state = makeState({ workflowStage: 'paused', issueNumber: 42 });
    const deps = makeDeps(state);

    handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(deps.spawnDetached).toHaveBeenCalledWith('bunx', ['tsx', 'adws/adwSdlc.tsx', '42', 'test-adw-id', '--target-repo', 'acme/widgets']);
  });

  it('spawns the PR-review orchestrator when the state names it', () => {
    const state = makeState({ workflowStage: 'paused', orchestratorScript: 'adws/adwPrReview.tsx', issueNumber: 42 });
    const deps = makeDeps(state);

    handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(deps.spawnDetached).toHaveBeenCalledWith('bunx', ['tsx', 'adws/adwPrReview.tsx', '42', 'test-adw-id', '--target-repo', 'acme/widgets']);
  });

  it('appends no flags after the adwId when targetRepoArgs is empty (webhook self-host)', () => {
    const state = makeState({ workflowStage: 'paused', orchestratorScript: 'adws/adwChore.tsx', issueNumber: 42 });
    const deps = makeDeps(state, { targetRepoArgs: [] });

    handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(deps.spawnDetached).toHaveBeenCalledWith('bunx', ['tsx', 'adws/adwChore.tsx', '42', 'test-adw-id']);
  });

  it('appends all four target-repo flags in order when the caller supplies a clone url', () => {
    const state = makeState({ workflowStage: 'paused', orchestratorScript: 'adws/adwChore.tsx', issueNumber: 42 });
    const targetRepoArgs = ['--target-repo', 'acme/widgets', '--clone-url', 'https://example.invalid/acme/widgets.git'];
    const deps = makeDeps(state, { targetRepoArgs });

    handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(deps.spawnDetached).toHaveBeenCalledWith('bunx', ['tsx', 'adws/adwChore.tsx', '42', 'test-adw-id', ...targetRepoArgs]);
  });

  it('held spawn lock: no removal, no spawn, no comment, no release, returns false', () => {
    const state = makeState({ workflowStage: 'paused', issueNumber: 42 });
    const deps = makeDeps(state, { acquireIssueSpawnLock: vi.fn().mockReturnValue(false) });

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.removeFromPauseQueue).not.toHaveBeenCalled();
    expect(deps.spawnDetached).not.toHaveBeenCalled();
    expect(deps.postStageComment).not.toHaveBeenCalled();
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });

  it('happy path orders acquire → remove → spawn → release → comment', () => {
    const state = makeState({ workflowStage: 'paused', issueNumber: 42 });
    const deps = makeDeps(state);

    handleRetryDirective(42, [ADW_COMMENT], deps);

    const acquireOrder = vi.mocked(deps.acquireIssueSpawnLock).mock.invocationCallOrder[0];
    const removeOrder = vi.mocked(deps.removeFromPauseQueue).mock.invocationCallOrder[0];
    const spawnOrder = vi.mocked(deps.spawnDetached).mock.invocationCallOrder[0];
    const releaseOrder = vi.mocked(deps.releaseIssueSpawnLock).mock.invocationCallOrder[0];
    const commentOrder = vi.mocked(deps.postStageComment).mock.invocationCallOrder[0];

    expect(acquireOrder).toBeLessThan(removeOrder);
    expect(removeOrder).toBeLessThan(spawnOrder);
    expect(spawnOrder).toBeLessThan(releaseOrder);
    expect(releaseOrder).toBeLessThan(commentOrder);
  });

  it('releases the lock and skips the comment when spawnDetached throws', () => {
    const state = makeState({ workflowStage: 'paused', issueNumber: 42 });
    const deps = makeDeps(state, {
      spawnDetached: vi.fn().mockImplementation(() => { throw new Error('boom'); }),
    });

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(deps.postStageComment).not.toHaveBeenCalled();
  });

  it('no-ops before any lock when the top-level state belongs to a different issue', () => {
    const state = makeState({ workflowStage: 'paused', issueNumber: 99 });
    const deps = makeDeps(state);

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.acquireIssueSpawnLock).not.toHaveBeenCalled();
    expect(deps.spawnDetached).not.toHaveBeenCalled();
  });

  it('no-ops before any lock when the top-level state has a null issue number', () => {
    const state = makeState({ workflowStage: 'paused', issueNumber: null });
    const deps = makeDeps(state);

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.acquireIssueSpawnLock).not.toHaveBeenCalled();
    expect(deps.spawnDetached).not.toHaveBeenCalled();
  });
});

describe('handleRetryDirective — paused_auth', () => {
  it('no-ops and logs that the auth queue scanner owns recovery', () => {
    vi.mocked(log).mockClear();
    const state = makeState({ workflowStage: 'paused_auth', issueNumber: 42 });
    const deps = makeDeps(state);

    const result = handleRetryDirective(42, [ADW_COMMENT], deps);

    expect(result).toBe(false);
    expect(deps.writeTopLevelState).not.toHaveBeenCalled();
    expect(deps.removeFromPauseQueue).not.toHaveBeenCalled();
    expect(deps.spawnDetached).not.toHaveBeenCalled();
    expect(deps.postStageComment).not.toHaveBeenCalled();

    const messages = vi.mocked(log).mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => /paused_auth/.test(m) && /auth queue/i.test(m))).toBe(true);
  });
});

describe('handleRetryDirective — active stages', () => {
  const activeStages = ['starting', 'resuming', 'build_running', 'plan_running', 'stepDef_running'];

  for (const stage of activeStages) {
    it(`no-ops for "${stage}" and logs that a running orchestrator cannot be duplicated`, () => {
      vi.mocked(log).mockClear();
      const state = makeState({ workflowStage: stage, issueNumber: 42 });
      const deps = makeDeps(state);

      const result = handleRetryDirective(42, [ADW_COMMENT], deps);

      expect(result).toBe(false);
      expect(deps.writeTopLevelState).not.toHaveBeenCalled();
      expect(deps.findPauseQueueEntry).not.toHaveBeenCalled();
      expect(deps.removeFromPauseQueue).not.toHaveBeenCalled();
      expect(deps.acquireIssueSpawnLock).not.toHaveBeenCalled();
      expect(deps.spawnDetached).not.toHaveBeenCalled();
      expect(deps.postStageComment).not.toHaveBeenCalled();

      const messages = vi.mocked(log).mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => /running orchestrator cannot be duplicated/.test(m))).toBe(true);
    });
  }
});
