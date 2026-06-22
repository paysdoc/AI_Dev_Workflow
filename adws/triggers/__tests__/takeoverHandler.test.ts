// All I/O is injected via TakeoverDeps — no real execSync/mockExecSync, gh CLI, or git subprocess is used.
import * as path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateCandidate } from '../takeoverHandler';
import type { TakeoverDeps, CandidateDecision } from '../takeoverHandler';
import type { RepoInfo } from '../../github/githubApi';
import type { AgentState } from '../../types/agentTypes';
import type { WorktreeProbe } from '../../vcs/worktreeReuseGate';
import { GitContext } from '../../gitContext';

const REPO: RepoInfo = { owner: 'acme', repo: 'widgets' };
const ADW_ID = 'test-adwid-123';

function healthyProbe(overrides: Partial<WorktreeProbe> = {}): WorktreeProbe {
  return {
    registration: 'healthy',
    indexLock: 'absent',
    interruptedOp: 'none',
    headOnExpectedBranch: true,
    liveOwner: false,
    ...overrides,
  };
}

function unhealthyProbe(reason: 'interrupted_rebase' | 'live_owner' | 'wrong_head' = 'interrupted_rebase'): WorktreeProbe {
  if (reason === 'live_owner') return healthyProbe({ liveOwner: true });
  if (reason === 'wrong_head') return healthyProbe({ headOnExpectedBranch: false });
  return healthyProbe({ interruptedOp: 'rebase' });
}

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
    writeTopLevelState: vi.fn(),
    commentOnIssue: vi.fn(),
    // Default probe is healthy so active-path and other existing tests are unaffected.
    probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    clearOrphanedIndexLock: vi.fn(),
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

// ─── Branch 4b: paused_auth — no-op (scanAuthQueue sole resumer) ─────────────

describe('paused_auth no-op', () => {
  it('returns skip_terminal with terminalStage paused_auth and releases lock', () => {
    const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'paused_auth' })) });
    const decision = evaluateCandidate({ issueNumber: 110, repoInfo: REPO }, deps);

    expect(decision).toEqual({ kind: 'skip_terminal', adwId: ADW_ID, terminalStage: 'paused_auth' });
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
    expect(deps.killProcess).not.toHaveBeenCalled();
  });

  it('paused_auth with a live PID still produces no-op (not take_over)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'paused_auth', pid: 66666, pidStartedAt: 'live-era' })),
      isProcessLive: vi.fn().mockReturnValue(true),
    });
    const decision = evaluateCandidate({ issueNumber: 110, repoInfo: REPO }, deps);
    expect(decision.kind).toBe('skip_terminal');
    expect(deps.killProcess).not.toHaveBeenCalled();
  });
});

// ─── Branch 5: abandoned → take_over_adwId (via reuse gate) ──────────────────

describe('take_over_adwId from abandoned', () => {
  // ─ healthy probe → reuse in place ─

  it('healthy probe → returns take_over_adwId carrying the adwId and derived stage', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-104-x' })),
      deriveStageFromRemote: vi.fn().mockReturnValue('awaiting_merge'),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    const decision = evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps) as Extract<CandidateDecision, { kind: 'take_over_adwId' }>;

    expect(decision.kind).toBe('take_over_adwId');
    expect(decision.adwId).toBe(ADW_ID);
    expect(decision.derivedStage).toBe('awaiting_merge');
  });

  it('healthy probe → resetWorktree NOT called (uncommitted work preserved)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-104-x' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).toHaveBeenCalledOnce();
  });

  it('healthy probe → probeWorktree called with worktree path and branchName', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-104-x' })),
      getWorktreePath: vi.fn().mockReturnValue('/wt/feature-issue-104-x'),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(deps.probeWorktree).toHaveBeenCalledWith('/wt/feature-issue-104-x', 'feature-issue-104-x', undefined, undefined);
  });

  it('healthy probe with orphaned lock → clearOrphanedIndexLock called; resetWorktree NOT called', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' })),
      getWorktreePath: vi.fn().mockReturnValue('/wt/feature-branch'),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe({ indexLock: 'orphaned' })),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(deps.clearOrphanedIndexLock).toHaveBeenCalledWith('/wt/feature-branch');
    expect(deps.resetWorktree).not.toHaveBeenCalled();
  });

  it('healthy probe with absent lock → clearOrphanedIndexLock NOT called', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe({ indexLock: 'absent' })),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(deps.clearOrphanedIndexLock).not.toHaveBeenCalled();
  });

  // ─ unhealthy probe → reset from remote ─

  it('unhealthy probe → resetWorktree called before deriveStageFromRemote', () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-104-x' })),
      probeWorktree: vi.fn().mockReturnValue(unhealthyProbe('interrupted_rebase')),
      resetWorktree: vi.fn().mockImplementation(() => callOrder.push('reset')),
      deriveStageFromRemote: vi.fn().mockImplementation(() => { callOrder.push('reconcile'); return 'awaiting_merge'; }),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(callOrder).toEqual(['reset', 'reconcile']);
  });

  it('unhealthy probe → passes the branchName to resetWorktree', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-104-whatever' })),
      getWorktreePath: vi.fn().mockReturnValue('/wt/feature-issue-104-whatever'),
      probeWorktree: vi.fn().mockReturnValue(unhealthyProbe()),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(deps.resetWorktree).toHaveBeenCalledWith('/wt/feature-issue-104-whatever', 'feature-issue-104-whatever');
  });

  // ─ no branchName → skip probe and reset ─

  it('no branchName → neither probeWorktree nor resetWorktree called; deriveStageFromRemote still called', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: undefined })),
      deriveStageFromRemote: vi.fn().mockReturnValue('abandoned'),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(deps.probeWorktree).not.toHaveBeenCalled();
    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).toHaveBeenCalledOnce();
  });

  it('acquireIssueSpawnLock is called before probeWorktree', () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      acquireIssueSpawnLock: vi.fn().mockImplementation(() => { callOrder.push('acquire'); return true; }),
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' })),
      probeWorktree: vi.fn().mockImplementation(() => { callOrder.push('probe'); return healthyProbe(); }),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(callOrder.indexOf('acquire')).toBeLessThan(callOrder.indexOf('probe'));
  });

  it('lock is NOT released on take_over_adwId (caller keeps it for spawn)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' })),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);

    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });

  it('no killProcess on abandoned branch', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' })),
    });
    evaluateCandidate({ issueNumber: 104, repoInfo: REPO }, deps);
    expect(deps.killProcess).not.toHaveBeenCalled();
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

  it('active running path always resets (reuse gate is not applied)', () => {
    // Even with a healthy probe, active running path resets unconditionally.
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'build_running', branchName: 'b', pid: 1, pidStartedAt: 'old' })),
      isProcessLive: vi.fn().mockReturnValue(false),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    evaluateCandidate({ issueNumber: 105, repoInfo: REPO }, deps);
    expect(deps.resetWorktree).toHaveBeenCalledOnce();
    expect(deps.probeWorktree).not.toHaveBeenCalled();
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

// ─── phase_timeout → take_over_adwId (below cap, via reuse gate) ─────────────

describe('take_over_adwId from phase_timeout', () => {
  // ─ healthy probe → reuse in place (within cap) ─

  it('healthy probe → returns take_over_adwId and increments resumeAttempts (first resume)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-637-x' })),
      deriveStageFromRemote: vi.fn().mockReturnValue('awaiting_merge'),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    const decision = evaluateCandidate({ issueNumber: 637, repoInfo: REPO }, deps) as Extract<CandidateDecision, { kind: 'take_over_adwId' }>;

    expect(decision.kind).toBe('take_over_adwId');
    expect(decision.adwId).toBe(ADW_ID);
    expect(decision.derivedStage).toBe('awaiting_merge');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith(ADW_ID, { resumeAttempts: 1 });
  });

  it('returns take_over_adwId and increments resumeAttempts from 2 to 3 (one below cap)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-637-x', resumeAttempts: 2 })),
      deriveStageFromRemote: vi.fn().mockReturnValue('abandoned'),
    });
    const decision = evaluateCandidate({ issueNumber: 637, repoInfo: REPO }, deps);

    expect(decision.kind).toBe('take_over_adwId');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith(ADW_ID, { resumeAttempts: 3 });
  });

  it('healthy probe → resetWorktree NOT called (uncommitted work preserved)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-637-x' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    evaluateCandidate({ issueNumber: 637, repoInfo: REPO }, deps);

    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).toHaveBeenCalledOnce();
  });

  it('healthy probe → probeWorktree called with worktree path and branchName', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-637-x', pid: 77777, pidStartedAt: 'dead-era' })),
      getWorktreePath: vi.fn().mockReturnValue('/wt/feature-issue-637-x'),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    evaluateCandidate({ issueNumber: 637, repoInfo: REPO }, deps);

    expect(deps.probeWorktree).toHaveBeenCalledWith('/wt/feature-issue-637-x', 'feature-issue-637-x', 77777, 'dead-era');
  });

  it('healthy probe with orphaned lock → clearOrphanedIndexLock called; resetWorktree NOT called', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-branch' })),
      getWorktreePath: vi.fn().mockReturnValue('/wt/feature-branch'),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe({ indexLock: 'orphaned' })),
    });
    evaluateCandidate({ issueNumber: 637, repoInfo: REPO }, deps);

    expect(deps.clearOrphanedIndexLock).toHaveBeenCalledWith('/wt/feature-branch');
    expect(deps.resetWorktree).not.toHaveBeenCalled();
  });

  // ─ unhealthy probe → reset from remote ─

  it('unhealthy probe → resetWorktree called before deriveStageFromRemote', () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-637-x' })),
      probeWorktree: vi.fn().mockReturnValue(unhealthyProbe('interrupted_rebase')),
      resetWorktree: vi.fn().mockImplementation(() => callOrder.push('reset')),
      deriveStageFromRemote: vi.fn().mockImplementation(() => { callOrder.push('reconcile'); return 'abandoned'; }),
    });
    evaluateCandidate({ issueNumber: 637, repoInfo: REPO }, deps);

    expect(callOrder).toEqual(['reset', 'reconcile']);
  });

  it('unhealthy probe → passes the branchName from state to resetWorktree', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-637-whatever' })),
      getWorktreePath: vi.fn().mockReturnValue('/wt/feature-issue-637-whatever'),
      probeWorktree: vi.fn().mockReturnValue(unhealthyProbe()),
    });
    evaluateCandidate({ issueNumber: 637, repoInfo: REPO }, deps);

    expect(deps.resetWorktree).toHaveBeenCalledWith('/wt/feature-issue-637-whatever', 'feature-issue-637-whatever');
  });

  // ─ no branchName → skip probe and reset ─

  it('no branchName → neither probeWorktree nor resetWorktree called; deriveStageFromRemote still called', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: undefined })),
      deriveStageFromRemote: vi.fn().mockReturnValue('abandoned'),
    });
    evaluateCandidate({ issueNumber: 637, repoInfo: REPO }, deps);

    expect(deps.probeWorktree).not.toHaveBeenCalled();
    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).toHaveBeenCalledOnce();
  });

  it('lock is NOT released on take_over_adwId (caller keeps it for spawn)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-branch' })),
    });
    evaluateCandidate({ issueNumber: 637, repoInfo: REPO }, deps);

    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });

  it('does NOT call killProcess even when state has a live PID (orchestrator already exited)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({
        workflowStage: 'phase_timeout',
        branchName: 'feature-branch',
        pid: 77777,
        pidStartedAt: 'live-era',
      })),
      isProcessLive: vi.fn().mockReturnValue(true),
      // liveOwner=false in the probe (dead pid verified at probe time), so gate passes
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    evaluateCandidate({ issueNumber: 637, repoInfo: REPO }, deps);

    expect(deps.killProcess).not.toHaveBeenCalled();
  });

  it('liveOwner=true in probe → reset (confirmed-dead safety net); no killProcess', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({
        workflowStage: 'phase_timeout',
        branchName: 'feature-branch',
        pid: 77777,
        pidStartedAt: 'live-era',
      })),
      probeWorktree: vi.fn().mockReturnValue(unhealthyProbe('live_owner')),
    });
    evaluateCandidate({ issueNumber: 637, repoInfo: REPO }, deps);

    expect(deps.killProcess).not.toHaveBeenCalled();
    expect(deps.resetWorktree).toHaveBeenCalledOnce();
    expect(deps.deriveStageFromRemote).toHaveBeenCalledOnce();
  });
});

// ─── phase_timeout → escalate_human_gated (at cap) ──────────────────────────

describe('escalate_human_gated from phase_timeout at cap', () => {
  it('returns escalate_human_gated with adwId when resumeAttempts equals MAX_RESUME_ATTEMPTS', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-branch', resumeAttempts: 3 })),
    });
    const decision = evaluateCandidate({ issueNumber: 639, repoInfo: REPO }, deps) as Extract<CandidateDecision, { kind: 'escalate_human_gated' }>;

    expect(decision.kind).toBe('escalate_human_gated');
    expect(decision.adwId).toBe(ADW_ID);
  });

  it('writes human_gated to state when escalating', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', resumeAttempts: 3 })),
    });
    evaluateCandidate({ issueNumber: 639, repoInfo: REPO }, deps);

    expect(deps.writeTopLevelState).toHaveBeenCalledWith(ADW_ID, { workflowStage: 'human_gated' });
  });

  it('posts the escalation comment when escalating', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', resumeAttempts: 3 })),
    });
    evaluateCandidate({ issueNumber: 639, repoInfo: REPO }, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledOnce();
  });

  it('releases the spawn lock on escalation', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', resumeAttempts: 3 })),
    });
    evaluateCandidate({ issueNumber: 639, repoInfo: REPO }, deps);

    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
  });

  it('does not call resetWorktree or deriveStageFromRemote on escalation', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', resumeAttempts: 3 })),
    });
    evaluateCandidate({ issueNumber: 639, repoInfo: REPO }, deps);

    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
  });

  it('escalates also when resumeAttempts exceeds cap (defensive — above cap)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', resumeAttempts: 5 })),
    });
    const decision = evaluateCandidate({ issueNumber: 639, repoInfo: REPO }, deps);

    expect(decision.kind).toBe('escalate_human_gated');
  });
});

// ─── GitContext-based worktree path resolution (story 10) ─────────────────────
//
// When EvaluateCandidateInput carries a GitContext, recovery helpers resolve the
// worktree path via the context's identity-determined base path — never from
// ambient cwd (the spawnSync ENOENT incident pin).

const TARGET_BASE = '/srv/target-repos/vestmatic/vestmatic';
const FRAMEWORK_ROOT = '/srv/adw/framework';

function makeTestGitContext(base: string, selfHost: boolean): GitContext {
  return new GitContext({
    owner: 'vestmatic',
    repo: 'vestmatic',
    selfHost,
    token: 'test-token',
    gitIdentity: {
      authorName: 'Bot',
      authorEmail: 'bot@test.dev',
      committerName: 'Bot',
      committerEmail: 'bot@test.dev',
    },
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: '/srv/target-repos',
  });
}

describe('GitContext-based worktree path (abandoned)', () => {
  it('abandoned: worktree path resolves under context base, not getWorktreePath', () => {
    const fakeCtx = makeTestGitContext(TARGET_BASE, false);
    const expectedWtPath = path.join(TARGET_BASE, '.worktrees', 'feature-issue-187-x');
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-187-x' })),
      getWorktreePath: vi.fn().mockReturnValue('/wrong/framework/path/.worktrees/feature-issue-187-x'),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });

    evaluateCandidate({ issueNumber: 187, repoInfo: REPO, gitContext: fakeCtx }, deps);

    expect(deps.probeWorktree).toHaveBeenCalledWith(expectedWtPath, 'feature-issue-187-x', undefined, undefined);
    expect(deps.getWorktreePath).not.toHaveBeenCalled();
  });

  it('abandoned: unhealthy probe resets worktree via context base path', () => {
    const fakeCtx = makeTestGitContext(TARGET_BASE, false);
    const expectedWtPath = path.join(TARGET_BASE, '.worktrees', 'feature-issue-187-x');
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-187-x' })),
      getWorktreePath: vi.fn().mockReturnValue('/wrong/path'),
      probeWorktree: vi.fn().mockReturnValue(unhealthyProbe()),
    });

    evaluateCandidate({ issueNumber: 187, repoInfo: REPO, gitContext: fakeCtx }, deps);

    expect(deps.resetWorktree).toHaveBeenCalledWith(expectedWtPath, 'feature-issue-187-x');
    expect(deps.getWorktreePath).not.toHaveBeenCalled();
  });

  it('abandoned: resolved worktree path is not under the framework cwd (incident pin)', () => {
    const fakeCtx = makeTestGitContext(TARGET_BASE, false);
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-187-x' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });

    evaluateCandidate({ issueNumber: 187, repoInfo: REPO, gitContext: fakeCtx }, deps);

    const probeCall = (deps.probeWorktree as ReturnType<typeof vi.fn>).mock.calls[0] as string[];
    expect(probeCall[0]).not.toContain(FRAMEWORK_ROOT);
    expect(probeCall[0]).toContain(TARGET_BASE);
  });
});

describe('GitContext-based worktree path (phase_timeout)', () => {
  it('phase_timeout: worktree path resolves under context base, not getWorktreePath', () => {
    const fakeCtx = makeTestGitContext(TARGET_BASE, false);
    const expectedWtPath = path.join(TARGET_BASE, '.worktrees', 'feature-issue-187-x');
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-187-x' })),
      getWorktreePath: vi.fn().mockReturnValue('/wrong/framework/path/.worktrees/feature-issue-187-x'),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });

    evaluateCandidate({ issueNumber: 187, repoInfo: REPO, gitContext: fakeCtx }, deps);

    expect(deps.probeWorktree).toHaveBeenCalledWith(expectedWtPath, 'feature-issue-187-x', undefined, undefined);
    expect(deps.getWorktreePath).not.toHaveBeenCalled();
  });
});
