// All I/O is injected via TakeoverDeps — no real execSync/mockExecSync, gh CLI, or git subprocess is used.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateCandidate } from '../takeoverHandler';
import type { TakeoverDeps, CandidateDecision } from '../takeoverHandler';
import type { RepoInfo } from '../../github/githubApi';
import type { AgentState } from '../../types/agentTypes';

const REPO: RepoInfo = { owner: 'acme', repo: 'widgets' };
const ADW_ID = 'test-adwid-123';

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    adwId: ADW_ID,
    issueNumber: 42,
    agentName: 'orchestrator',
    execution: { status: 'running', startedAt: '2026-01-01T00:00:00Z' },
    workflowStage: 'build_running',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<TakeoverDeps> = {}): TakeoverDeps {
  return {
    acquireIssueSpawnLock: vi.fn().mockReturnValue(true),
    releaseIssueSpawnLock: vi.fn(),
    readSpawnLockRecord: vi.fn().mockReturnValue(null),
    resolveAdwId: vi.fn().mockReturnValue(ADW_ID),
    readTopLevelState: vi.fn().mockReturnValue(null),
    isProcessLive: vi.fn().mockReturnValue(false),
    killProcess: vi.fn(),
    resetWorktree: vi.fn(),
    deriveStageFromRemote: vi.fn().mockReturnValue('abandoned'),
    getWorktreePath: vi.fn().mockReturnValue('/worktrees/feature-branch'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Branch 1: defer_live_holder ─────────────────────────────────────────────

describe('defer_live_holder', () => {
  it('returns defer_live_holder when the lock is held by a live process', () => {
    const deps = makeDeps({
      acquireIssueSpawnLock: vi.fn().mockReturnValue(false),
      readSpawnLockRecord: vi.fn().mockReturnValue({ pid: 9999, pidStartedAt: 'live-era' }),
    });
    const decision = evaluateCandidate({ issueNumber: 107, repoInfo: REPO }, deps);

    expect(decision).toEqual({ kind: 'defer_live_holder', holderPid: 9999 });
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
    expect(deps.killProcess).not.toHaveBeenCalled();
  });

  it('returns holderPid 0 when lock is held but readSpawnLockRecord returns null', () => {
    const deps = makeDeps({
      acquireIssueSpawnLock: vi.fn().mockReturnValue(false),
      readSpawnLockRecord: vi.fn().mockReturnValue(null),
    });
    const decision = evaluateCandidate({ issueNumber: 107, repoInfo: REPO }, deps);
    expect(decision).toEqual({ kind: 'defer_live_holder', holderPid: 0 });
  });
});

// ─── Branch 2: spawn_fresh — no adwId ────────────────────────────────────────

describe('spawn_fresh — no adwId', () => {
  it('returns spawn_fresh when resolveAdwId returns null', () => {
    const deps = makeDeps({ resolveAdwId: vi.fn().mockReturnValue(null) });
    const decision = evaluateCandidate({ issueNumber: 101, repoInfo: REPO }, deps);

    expect(decision).toEqual({ kind: 'spawn_fresh' });
    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });

  it('returns spawn_fresh when adwId resolves but state file is null', () => {
    const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(null) });
    const decision = evaluateCandidate({ issueNumber: 101, repoInfo: REPO }, deps);

    expect(decision).toEqual({ kind: 'spawn_fresh' });
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });
});

// ─── Branch 3: skip_terminal — completed / discarded ─────────────────────────

describe('skip_terminal', () => {
  it('returns skip_terminal for completed stage and releases lock', () => {
    const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'completed' })) });
    const decision = evaluateCandidate({ issueNumber: 102, repoInfo: REPO }, deps);

    expect(decision).toEqual({ kind: 'skip_terminal', adwId: ADW_ID, terminalStage: 'completed' });
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
    expect(deps.killProcess).not.toHaveBeenCalled();
  });

  it('returns skip_terminal for discarded stage and releases lock', () => {
    const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'discarded' })) });
    const decision = evaluateCandidate({ issueNumber: 103, repoInfo: REPO }, deps);

    expect(decision).toEqual({ kind: 'skip_terminal', adwId: ADW_ID, terminalStage: 'discarded' });
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
  });

  it('returns skip_terminal for completed even when state has a live PID (terminal wins)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'completed', pid: 12345, pidStartedAt: 'live-era' })),
      isProcessLive: vi.fn().mockReturnValue(true),
    });
    const decision = evaluateCandidate({ issueNumber: 102, repoInfo: REPO }, deps);
    expect(decision.kind).toBe('skip_terminal');
    expect(deps.killProcess).not.toHaveBeenCalled();
  });
});

// ─── Branch 4: paused — no-op (scanPauseQueue sole resumer) ──────────────────

describe('paused no-op', () => {
  it('returns skip_terminal with terminalStage paused and releases lock', () => {
    const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'paused' })) });
    const decision = evaluateCandidate({ issueNumber: 109, repoInfo: REPO }, deps);

    expect(decision).toEqual({ kind: 'skip_terminal', adwId: ADW_ID, terminalStage: 'paused' });
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
    expect(deps.killProcess).not.toHaveBeenCalled();
  });

  it('paused with a live PID still produces no-op (not take_over)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'paused', pid: 55555, pidStartedAt: 'live-era' })),
      isProcessLive: vi.fn().mockReturnValue(true),
    });
    const decision = evaluateCandidate({ issueNumber: 109, repoInfo: REPO }, deps);
    expect(decision.kind).toBe('skip_terminal');
    expect(deps.killProcess).not.toHaveBeenCalled();
  });
});

// ─── Branch 5: abandoned → take_over_adwId ────────────────────────────────────

describe('take_over_adwId from abandoned', () => {
  it('returns take_over_adwId carrying the adwId and derived stage', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-104-x' })),
      deriveStageFromRemote: vi.fn().mockReturnValue('awaiting_merge'),
    });
    const decision = evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps) as Extract<CandidateDecision, { kind: 'take_over_adwId' }>;

    expect(decision.kind).toBe('take_over_adwId');
    expect(decision.adwId).toBe(ADW_ID);
    expect(decision.derivedStage).toBe('awaiting_merge');
  });

  it('calls resetWorktree before deriveStageFromRemote (order enforced)', () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-104-x' })),
      resetWorktree: vi.fn().mockImplementation(() => callOrder.push('reset')),
      deriveStageFromRemote: vi.fn().mockImplementation(() => { callOrder.push('reconcile'); return 'awaiting_merge'; }),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(callOrder).toEqual(['reset', 'reconcile']);
  });

  it('passes the branchName from state to resetWorktree', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-104-whatever' })),
      getWorktreePath: vi.fn().mockReturnValue('/wt/feature-issue-104-whatever'),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(deps.resetWorktree).toHaveBeenCalledWith('/wt/feature-issue-104-whatever', 'feature-issue-104-whatever');
  });

  it('acquireIssueSpawnLock is called before resetWorktree', () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      acquireIssueSpawnLock: vi.fn().mockImplementation(() => { callOrder.push('acquire'); return true; }),
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' })),
      resetWorktree: vi.fn().mockImplementation(() => callOrder.push('reset')),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(callOrder.indexOf('acquire')).toBeLessThan(callOrder.indexOf('reset'));
  });

  it('skips resetWorktree when state has no branchName but still calls remoteReconcile', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: undefined })),
      deriveStageFromRemote: vi.fn().mockReturnValue('abandoned'),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).toHaveBeenCalledOnce();
  });

  it('lock is NOT released on take_over_adwId (caller keeps it for spawn)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' })),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });
});

// ─── Branch 6 & 7: *_running ─────────────────────────────────────────────────

describe('take_over_adwId from *_running with dead PID', () => {
  it('returns take_over_adwId and does not call killProcess when PID is dead', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({
        workflowStage: 'build_running',
        branchName: 'feature-branch',
        pid: 99999,
        pidStartedAt: 'crashed-era',
      })),
      isProcessLive: vi.fn().mockReturnValue(false),
    });
    const decision = evaluateCandidate({ issueNumber: 105, repoInfo: REPO }, deps);

    expect(decision.kind).toBe('take_over_adwId');
    expect(deps.killProcess).not.toHaveBeenCalled();
    expect(deps.resetWorktree).toHaveBeenCalledOnce();
    expect(deps.deriveStageFromRemote).toHaveBeenCalledOnce();
  });

  it('worktreeReset runs before remoteReconcile on running-dead-PID path', () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'build_running', branchName: 'b', pid: 1, pidStartedAt: 'old' })),
      isProcessLive: vi.fn().mockReturnValue(false),
      resetWorktree: vi.fn().mockImplementation(() => callOrder.push('reset')),
      deriveStageFromRemote: vi.fn().mockImplementation(() => { callOrder.push('reconcile'); return 'abandoned'; }),
    });
    evaluateCandidate({ issueNumber: 105, repoInfo: REPO }, deps);
    expect(callOrder).toEqual(['reset', 'reconcile']);
  });

  it('handles starting stage with dead PID as take_over_adwId', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'starting', branchName: 'b', pid: 1, pidStartedAt: 'old' })),
      isProcessLive: vi.fn().mockReturnValue(false),
    });
    const decision = evaluateCandidate({ issueNumber: 105, repoInfo: REPO }, deps);
    expect(decision.kind).toBe('take_over_adwId');
  });

  it('handles no pid field as dead — proceeds to take_over', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'build_running', branchName: 'b', pid: undefined, pidStartedAt: undefined })),
    });
    const decision = evaluateCandidate({ issueNumber: 105, repoInfo: REPO }, deps);
    expect(decision.kind).toBe('take_over_adwId');
    expect(deps.killProcess).not.toHaveBeenCalled();
  });
});

describe('take_over_adwId from *_running with live PID not holding lock', () => {
  it('issues SIGKILL then proceeds to take_over_adwId', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({
        workflowStage: 'test_running',
        branchName: 'feature-branch',
        pid: 12345,
        pidStartedAt: 'Sat Apr 20 10:00:00 2026',
      })),
      isProcessLive: vi.fn().mockReturnValue(true),
    });
    const decision = evaluateCandidate({ issueNumber: 106, repoInfo: REPO }, deps);

    expect(deps.killProcess).toHaveBeenCalledWith(12345);
    expect(decision.kind).toBe('take_over_adwId');
  });

  it('SIGKILL fires before worktreeReset (order enforced)', () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({
        workflowStage: 'test_running',
        branchName: 'feature-branch',
        pid: 12345,
        pidStartedAt: 'live-start',
      })),
      isProcessLive: vi.fn().mockReturnValue(true),
      killProcess: vi.fn().mockImplementation(() => callOrder.push('kill')),
      resetWorktree: vi.fn().mockImplementation(() => callOrder.push('reset')),
      deriveStageFromRemote: vi.fn().mockImplementation(() => { callOrder.push('reconcile'); return 'abandoned'; }),
    });
    evaluateCandidate({ issueNumber: 106, repoInfo: REPO }, deps);
    expect(callOrder).toEqual(['kill', 'reset', 'reconcile']);
  });

  it('ESRCH from killProcess does not prevent take_over_adwId decision', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({
        workflowStage: 'test_running',
        branchName: 'b',
        pid: 12345,
        pidStartedAt: 'live-start',
      })),
      isProcessLive: vi.fn().mockReturnValue(true),
      killProcess: vi.fn().mockImplementation(() => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); }),
    });
    const decision = evaluateCandidate({ issueNumber: 106, repoInfo: REPO }, deps);
    expect(decision.kind).toBe('take_over_adwId');
  });
});

// ─── Branch 8: defensive fallthrough ─────────────────────────────────────────

describe('defensive fallthrough', () => {
  it('returns spawn_fresh for an unknown/unrecognised stage', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'some_unknown_future_stage' as never })),
    });
    const decision = evaluateCandidate({ issueNumber: 99, repoInfo: REPO }, deps);
    expect(decision).toEqual({ kind: 'spawn_fresh' });
  });
});

// ─── paused — no side effects ─────────────────────────────────────────────────

describe('paused — no side effects', () => {
  it('records no worktreeReset, remoteReconcile, or kill calls', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'paused' })),
    });
    evaluateCandidate({ issueNumber: 109, repoInfo: REPO }, deps);

    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
    expect(deps.killProcess).not.toHaveBeenCalled();
  });
});

// ─── Lock is held on spawn_fresh / take_over (caller keeps for spawn) ─────────

describe('lock handoff semantics', () => {
  it('does not release lock on spawn_fresh (caller keeps lock for spawn)', () => {
    const deps = makeDeps({ resolveAdwId: vi.fn().mockReturnValue(null) });
    evaluateCandidate({ issueNumber: 200, repoInfo: REPO }, deps);
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });
});
