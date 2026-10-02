// All I/O is injected via TakeoverDeps — no real execSync/mockExecSync, gh CLI, or git subprocess is used.
import * as path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWorktreePathFor = vi.hoisted(() => vi.fn().mockReturnValue('/worktrees/feature-branch'));
import { evaluateCandidate } from '../takeoverHandler';
import type { TakeoverDeps, CandidateDecision } from '../takeoverHandler';
import { Platform, type RepoIdentifier } from '@paysdoc/devplatform';
import type { AgentState } from '../../types/agentTypes';
import type { WorktreeProbe } from '../../vcs/worktreeReuseGate';
import { GitContext, createLiteralTokenProvider } from '@paysdoc/devplatform/git';
import type { LaunchBoundary } from '../../core';

const REPO: RepoIdentifier = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub };
const ADW_ID = 'test-adwid-123';
const FAKE_BOUNDARY: LaunchBoundary = {
  repoId: REPO,
  gitContext: { worktreePathFor: mockWorktreePathFor } as unknown as GitContext,
  providers: {},
} as unknown as LaunchBoundary;

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
  mockWorktreePathFor.mockReturnValue('/worktrees/feature-branch');
});

describe('defer_live_holder', () => {
  it('returns defer_live_holder when the lock is held by a live process', () => {
    const deps = makeDeps({
      acquireIssueSpawnLock: vi.fn().mockReturnValue(false),
      readSpawnLockRecord: vi.fn().mockReturnValue({ pid: 9999, pidStartedAt: 'live-era' }),
    });
    const decision = evaluateCandidate({ issueNumber: 107, boundary: FAKE_BOUNDARY }, deps);

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
    const decision = evaluateCandidate({ issueNumber: 107, boundary: FAKE_BOUNDARY }, deps);
    expect(decision).toEqual({ kind: 'defer_live_holder', holderPid: 0 });
  });
});

describe('spawn_fresh — no adwId', () => {
  it('returns spawn_fresh when resolveAdwId returns null', () => {
    const deps = makeDeps({ resolveAdwId: vi.fn().mockReturnValue(null) });
    const decision = evaluateCandidate({ issueNumber: 101, boundary: FAKE_BOUNDARY }, deps);

    expect(decision).toEqual({ kind: 'spawn_fresh' });
    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });

  it('returns spawn_fresh when adwId resolves but state file is null', () => {
    const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(null) });
    const decision = evaluateCandidate({ issueNumber: 101, boundary: FAKE_BOUNDARY }, deps);

    expect(decision).toEqual({ kind: 'spawn_fresh' });
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });
});

describe('skip_terminal', () => {
  it('returns skip_terminal for completed stage and releases lock', () => {
    const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'completed' })) });
    const decision = evaluateCandidate({ issueNumber: 102, boundary: FAKE_BOUNDARY }, deps);

    expect(decision).toEqual({ kind: 'skip_terminal', adwId: ADW_ID, terminalStage: 'completed' });
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
    expect(deps.killProcess).not.toHaveBeenCalled();
  });

  it('returns skip_terminal for discarded stage and releases lock', () => {
    const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'discarded' })) });
    const decision = evaluateCandidate({ issueNumber: 103, boundary: FAKE_BOUNDARY }, deps);

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
    const decision = evaluateCandidate({ issueNumber: 102, boundary: FAKE_BOUNDARY }, deps);
    expect(decision.kind).toBe('skip_terminal');
    expect(deps.killProcess).not.toHaveBeenCalled();
  });
});

describe('paused no-op', () => {
  it('returns skip_terminal with terminalStage paused and releases lock', () => {
    const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'paused' })) });
    const decision = evaluateCandidate({ issueNumber: 109, boundary: FAKE_BOUNDARY }, deps);

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
    const decision = evaluateCandidate({ issueNumber: 109, boundary: FAKE_BOUNDARY }, deps);
    expect(decision.kind).toBe('skip_terminal');
    expect(deps.killProcess).not.toHaveBeenCalled();
  });
});

describe('paused_auth no-op', () => {
  it('returns skip_terminal with terminalStage paused_auth and releases lock', () => {
    const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'paused_auth' })) });
    const decision = evaluateCandidate({ issueNumber: 110, boundary: FAKE_BOUNDARY }, deps);

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
    const decision = evaluateCandidate({ issueNumber: 110, boundary: FAKE_BOUNDARY }, deps);
    expect(decision.kind).toBe('skip_terminal');
    expect(deps.killProcess).not.toHaveBeenCalled();
  });
});

describe('take_over_adwId from abandoned', () => {
  it('healthy probe → returns take_over_adwId carrying the adwId and derived stage', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-104-x' })),
      deriveStageFromRemote: vi.fn().mockReturnValue('awaiting_merge'),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    const decision = evaluateCandidate({ issueNumber: 104, boundary: FAKE_BOUNDARY }, deps) as Extract<CandidateDecision, { kind: 'take_over_adwId' }>;

    expect(decision.kind).toBe('take_over_adwId');
    expect(decision.adwId).toBe(ADW_ID);
    expect(decision.derivedStage).toBe('awaiting_merge');
  });

  it('healthy probe → resetWorktree NOT called (uncommitted work preserved)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-104-x' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    evaluateCandidate({ issueNumber: 104, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).toHaveBeenCalledOnce();
  });

  it('healthy probe → probeWorktree called with worktree path and branchName', () => {
    mockWorktreePathFor.mockReturnValue('/wt/feature-issue-104-x');
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-104-x' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    evaluateCandidate({ issueNumber: 104, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.probeWorktree).toHaveBeenCalledWith('/wt/feature-issue-104-x', 'feature-issue-104-x', undefined, undefined);
  });

  it('healthy probe with orphaned lock → clearOrphanedIndexLock called; resetWorktree NOT called', () => {
    mockWorktreePathFor.mockReturnValue('/wt/feature-branch');
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe({ indexLock: 'orphaned' })),
    });
    evaluateCandidate({ issueNumber: 104, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.clearOrphanedIndexLock).toHaveBeenCalledWith('/wt/feature-branch');
    expect(deps.resetWorktree).not.toHaveBeenCalled();
  });

  it('healthy probe with absent lock → clearOrphanedIndexLock NOT called', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe({ indexLock: 'absent' })),
    });
    evaluateCandidate({ issueNumber: 104, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.clearOrphanedIndexLock).not.toHaveBeenCalled();
  });

  it('unhealthy probe → resetWorktree called before deriveStageFromRemote', () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-104-x' })),
      probeWorktree: vi.fn().mockReturnValue(unhealthyProbe('interrupted_rebase')),
      resetWorktree: vi.fn().mockImplementation(() => callOrder.push('reset')),
      deriveStageFromRemote: vi.fn().mockImplementation(() => { callOrder.push('reconcile'); return 'awaiting_merge'; }),
    });
    evaluateCandidate({ issueNumber: 104, boundary: FAKE_BOUNDARY }, deps);

    expect(callOrder).toEqual(['reset', 'reconcile']);
  });

  it('unhealthy probe → passes the branchName to resetWorktree', () => {
    mockWorktreePathFor.mockReturnValue('/wt/feature-issue-104-whatever');
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-104-whatever' })),
      probeWorktree: vi.fn().mockReturnValue(unhealthyProbe()),
    });
    evaluateCandidate({ issueNumber: 104, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.resetWorktree).toHaveBeenCalledWith('/wt/feature-issue-104-whatever', 'feature-issue-104-whatever');
  });

  it('no branchName → neither probeWorktree nor resetWorktree called; deriveStageFromRemote still called', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: undefined })),
      deriveStageFromRemote: vi.fn().mockReturnValue('abandoned'),
    });
    evaluateCandidate({ issueNumber: 104, boundary: FAKE_BOUNDARY }, deps);

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
    evaluateCandidate({ issueNumber: 104, boundary: FAKE_BOUNDARY }, deps);

    expect(callOrder.indexOf('acquire')).toBeLessThan(callOrder.indexOf('probe'));
  });

  it('lock is NOT released on take_over_adwId (caller keeps it for spawn)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' })),
    });
    evaluateCandidate({ issueNumber: 104, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });

  it('no killProcess on abandoned branch', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' })),
    });
    evaluateCandidate({ issueNumber: 104, boundary: FAKE_BOUNDARY }, deps);
    expect(deps.killProcess).not.toHaveBeenCalled();
  });
});

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
    const decision = evaluateCandidate({ issueNumber: 105, boundary: FAKE_BOUNDARY }, deps);

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
    evaluateCandidate({ issueNumber: 105, boundary: FAKE_BOUNDARY }, deps);
    expect(callOrder).toEqual(['reset', 'reconcile']);
  });

  it('handles starting stage with dead PID as take_over_adwId', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'starting', branchName: 'b', pid: 1, pidStartedAt: 'old' })),
      isProcessLive: vi.fn().mockReturnValue(false),
    });
    const decision = evaluateCandidate({ issueNumber: 105, boundary: FAKE_BOUNDARY }, deps);
    expect(decision.kind).toBe('take_over_adwId');
  });

  it('handles no pid field as dead — proceeds to take_over', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'build_running', branchName: 'b', pid: undefined, pidStartedAt: undefined })),
    });
    const decision = evaluateCandidate({ issueNumber: 105, boundary: FAKE_BOUNDARY }, deps);
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
    evaluateCandidate({ issueNumber: 105, boundary: FAKE_BOUNDARY }, deps);
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
    const decision = evaluateCandidate({ issueNumber: 106, boundary: FAKE_BOUNDARY }, deps);

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
    evaluateCandidate({ issueNumber: 106, boundary: FAKE_BOUNDARY }, deps);
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
    const decision = evaluateCandidate({ issueNumber: 106, boundary: FAKE_BOUNDARY }, deps);
    expect(decision.kind).toBe('take_over_adwId');
  });
});

describe('defensive fallthrough', () => {
  it('returns spawn_fresh for an unknown/unrecognised stage', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'some_unknown_future_stage' as never })),
    });
    const decision = evaluateCandidate({ issueNumber: 99, boundary: FAKE_BOUNDARY }, deps);
    expect(decision).toEqual({ kind: 'spawn_fresh' });
  });
});

describe('paused — no side effects', () => {
  it('records no worktreeReset, remoteReconcile, or kill calls', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'paused' })),
    });
    evaluateCandidate({ issueNumber: 109, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
    expect(deps.killProcess).not.toHaveBeenCalled();
  });
});

describe('lock handoff semantics', () => {
  it('does not release lock on spawn_fresh (caller keeps lock for spawn)', () => {
    const deps = makeDeps({ resolveAdwId: vi.fn().mockReturnValue(null) });
    evaluateCandidate({ issueNumber: 200, boundary: FAKE_BOUNDARY }, deps);
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });
});

describe('take_over_adwId from phase_timeout', () => {
  it('healthy probe → returns take_over_adwId and increments resumeAttempts (first resume)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-637-x' })),
      deriveStageFromRemote: vi.fn().mockReturnValue('awaiting_merge'),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    const decision = evaluateCandidate({ issueNumber: 637, boundary: FAKE_BOUNDARY }, deps) as Extract<CandidateDecision, { kind: 'take_over_adwId' }>;

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
    const decision = evaluateCandidate({ issueNumber: 637, boundary: FAKE_BOUNDARY }, deps);

    expect(decision.kind).toBe('take_over_adwId');
    expect(deps.writeTopLevelState).toHaveBeenCalledWith(ADW_ID, { resumeAttempts: 3 });
  });

  it('healthy probe → resetWorktree NOT called (uncommitted work preserved)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-637-x' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    evaluateCandidate({ issueNumber: 637, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).toHaveBeenCalledOnce();
  });

  it('healthy probe → probeWorktree called with worktree path and branchName', () => {
    mockWorktreePathFor.mockReturnValue('/wt/feature-issue-637-x');
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-637-x', pid: 77777, pidStartedAt: 'dead-era' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });
    evaluateCandidate({ issueNumber: 637, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.probeWorktree).toHaveBeenCalledWith('/wt/feature-issue-637-x', 'feature-issue-637-x', 77777, 'dead-era');
  });

  it('healthy probe with orphaned lock → clearOrphanedIndexLock called; resetWorktree NOT called', () => {
    mockWorktreePathFor.mockReturnValue('/wt/feature-branch');
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-branch' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe({ indexLock: 'orphaned' })),
    });
    evaluateCandidate({ issueNumber: 637, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.clearOrphanedIndexLock).toHaveBeenCalledWith('/wt/feature-branch');
    expect(deps.resetWorktree).not.toHaveBeenCalled();
  });

  it('unhealthy probe → resetWorktree called before deriveStageFromRemote', () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-637-x' })),
      probeWorktree: vi.fn().mockReturnValue(unhealthyProbe('interrupted_rebase')),
      resetWorktree: vi.fn().mockImplementation(() => callOrder.push('reset')),
      deriveStageFromRemote: vi.fn().mockImplementation(() => { callOrder.push('reconcile'); return 'abandoned'; }),
    });
    evaluateCandidate({ issueNumber: 637, boundary: FAKE_BOUNDARY }, deps);

    expect(callOrder).toEqual(['reset', 'reconcile']);
  });

  it('unhealthy probe → passes the branchName from state to resetWorktree', () => {
    mockWorktreePathFor.mockReturnValue('/wt/feature-issue-637-whatever');
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-637-whatever' })),
      probeWorktree: vi.fn().mockReturnValue(unhealthyProbe()),
    });
    evaluateCandidate({ issueNumber: 637, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.resetWorktree).toHaveBeenCalledWith('/wt/feature-issue-637-whatever', 'feature-issue-637-whatever');
  });

  it('no branchName → neither probeWorktree nor resetWorktree called; deriveStageFromRemote still called', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: undefined })),
      deriveStageFromRemote: vi.fn().mockReturnValue('abandoned'),
    });
    evaluateCandidate({ issueNumber: 637, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.probeWorktree).not.toHaveBeenCalled();
    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).toHaveBeenCalledOnce();
  });

  it('lock is NOT released on take_over_adwId (caller keeps it for spawn)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-branch' })),
    });
    evaluateCandidate({ issueNumber: 637, boundary: FAKE_BOUNDARY }, deps);

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
    evaluateCandidate({ issueNumber: 637, boundary: FAKE_BOUNDARY }, deps);

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
    evaluateCandidate({ issueNumber: 637, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.killProcess).not.toHaveBeenCalled();
    expect(deps.resetWorktree).toHaveBeenCalledOnce();
    expect(deps.deriveStageFromRemote).toHaveBeenCalledOnce();
  });
});

describe('escalate_human_gated from phase_timeout at cap', () => {
  it('returns escalate_human_gated with adwId when resumeAttempts equals MAX_RESUME_ATTEMPTS', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-branch', resumeAttempts: 3 })),
    });
    const decision = evaluateCandidate({ issueNumber: 639, boundary: FAKE_BOUNDARY }, deps) as Extract<CandidateDecision, { kind: 'escalate_human_gated' }>;

    expect(decision.kind).toBe('escalate_human_gated');
    expect(decision.adwId).toBe(ADW_ID);
  });

  it('writes human_gated to state when escalating', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', resumeAttempts: 3 })),
    });
    evaluateCandidate({ issueNumber: 639, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.writeTopLevelState).toHaveBeenCalledWith(ADW_ID, { workflowStage: 'human_gated' });
  });

  it('posts the escalation comment when escalating', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', resumeAttempts: 3 })),
    });
    evaluateCandidate({ issueNumber: 639, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledOnce();
  });

  it('releases the spawn lock on escalation', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', resumeAttempts: 3 })),
    });
    evaluateCandidate({ issueNumber: 639, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
  });

  it('does not call resetWorktree or deriveStageFromRemote on escalation', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', resumeAttempts: 3 })),
    });
    evaluateCandidate({ issueNumber: 639, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
  });

  it('escalates also when resumeAttempts exceeds cap (defensive — above cap)', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', resumeAttempts: 5 })),
    });
    const decision = evaluateCandidate({ issueNumber: 639, boundary: FAKE_BOUNDARY }, deps);

    expect(decision.kind).toBe('escalate_human_gated');
  });
});

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
    tokenProvider: createLiteralTokenProvider('test-token'),
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
  it('abandoned: worktree path resolves under context base (boundary.gitContext is the only source, #822)', () => {
    const fakeCtx = makeTestGitContext(TARGET_BASE, false);
    const expectedWtPath = path.join(TARGET_BASE, '.worktrees', 'feature-issue-187-x');
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-187-x' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });

    evaluateCandidate({ issueNumber: 187, boundary: { repoId: REPO, gitContext: fakeCtx, providers: {} } as unknown as LaunchBoundary }, deps);

    expect(deps.probeWorktree).toHaveBeenCalledWith(expectedWtPath, 'feature-issue-187-x', undefined, undefined);
  });

  it('abandoned: unhealthy probe resets worktree via context base path', () => {
    const fakeCtx = makeTestGitContext(TARGET_BASE, false);
    const expectedWtPath = path.join(TARGET_BASE, '.worktrees', 'feature-issue-187-x');
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-187-x' })),
      probeWorktree: vi.fn().mockReturnValue(unhealthyProbe()),
    });

    evaluateCandidate({ issueNumber: 187, boundary: { repoId: REPO, gitContext: fakeCtx, providers: {} } as unknown as LaunchBoundary }, deps);

    expect(deps.resetWorktree).toHaveBeenCalledWith(expectedWtPath, 'feature-issue-187-x');
  });

  it('abandoned: resolved worktree path is not under the framework cwd (incident pin)', () => {
    const fakeCtx = makeTestGitContext(TARGET_BASE, false);
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-issue-187-x' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });

    evaluateCandidate({ issueNumber: 187, boundary: { repoId: REPO, gitContext: fakeCtx, providers: {} } as unknown as LaunchBoundary }, deps);

    const probeCall = (deps.probeWorktree as ReturnType<typeof vi.fn>).mock.calls[0] as string[];
    expect(probeCall[0]).not.toContain(FRAMEWORK_ROOT);
    expect(probeCall[0]).toContain(TARGET_BASE);
  });
});

describe('GitContext-based worktree path (phase_timeout)', () => {
  it('phase_timeout: worktree path resolves under context base (boundary.gitContext is the only source, #822)', () => {
    const fakeCtx = makeTestGitContext(TARGET_BASE, false);
    const expectedWtPath = path.join(TARGET_BASE, '.worktrees', 'feature-issue-187-x');
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-187-x' })),
      probeWorktree: vi.fn().mockReturnValue(healthyProbe()),
    });

    evaluateCandidate({ issueNumber: 187, boundary: { repoId: REPO, gitContext: fakeCtx, providers: {} } as unknown as LaunchBoundary }, deps);

    expect(deps.probeWorktree).toHaveBeenCalledWith(expectedWtPath, 'feature-issue-187-x', undefined, undefined);
  });
});

import { buildDefaultTakeoverDeps } from '../takeoverHandler';

function makeFakeBoundary(fetchComments: (issueNumber: number) => { body: string }[]): LaunchBoundary {
  return {
    providers: { issueTracker: { fetchComments } },
  } as unknown as LaunchBoundary;
}

describe('buildDefaultTakeoverDeps — resolveAdwId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads comments through the boundary\'s issue tracker, and the latest adw id wins', () => {
    const fetchComments = vi.fn(() => [
      { id: '1', body: '**ADW ID:** `aaaaaa-old`', author: 'bot', createdAt: '2024-01-01T00:00:00Z' },
      { id: '2', body: '**ADW ID:** `zzzzzz-new`', author: 'bot', createdAt: '2024-01-02T00:00:00Z' },
    ]);
    const boundary = makeFakeBoundary(fetchComments);

    const deps = buildDefaultTakeoverDeps(boundary);
    const result = deps.resolveAdwId(99, REPO);

    expect(fetchComments).toHaveBeenCalledWith(99);
    expect(result).toBe('zzzzzz-new');
  });

  it('returns null on a boundary throw (fail-safe)', () => {
    const boundary = makeFakeBoundary(() => { throw new Error('rest api failed'); });

    const deps = buildDefaultTakeoverDeps(boundary);
    const result = deps.resolveAdwId(99, REPO);

    expect(result).toBeNull();
  });

  it('returns null when no comment carries an adwId', () => {
    const boundary = makeFakeBoundary(() => [{ id: '1', body: 'no adw id here', author: 'bot', createdAt: '2024-01-01T00:00:00Z' }]);

    const deps = buildDefaultTakeoverDeps(boundary);
    const result = deps.resolveAdwId(99, REPO);

    expect(result).toBeNull();
  });
});

vi.mock('../../core/remoteReconcile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/remoteReconcile')>();
  return {
    ...actual,
    deriveStageFromRemote: vi.fn(),
    buildDefaultReconcileDeps: vi.fn(),
  };
});

import { deriveStageFromRemote as mockDeriveStageFromRemote, buildDefaultReconcileDeps as mockBuildDefaultReconcileDeps } from '../../core/remoteReconcile';

describe('buildDefaultTakeoverDeps — deriveStageFromRemote boundary routing', () => {
  beforeEach(() => {
    vi.mocked(mockDeriveStageFromRemote).mockClear().mockReturnValue('abandoned');
    vi.mocked(mockBuildDefaultReconcileDeps).mockClear();
  });

  it('passes buildDefaultReconcileDeps(boundary) as the 2nd arg', () => {
    const fakeReconcileDeps = { readTopLevelState: vi.fn() } as unknown as ReturnType<typeof mockBuildDefaultReconcileDeps>;
    vi.mocked(mockBuildDefaultReconcileDeps).mockReturnValue(fakeReconcileDeps);
    const boundary = makeFakeBoundary(() => []);
    const deps = buildDefaultTakeoverDeps(boundary);

    deps.deriveStageFromRemote('adw-1');

    expect(mockBuildDefaultReconcileDeps).toHaveBeenCalledWith(boundary);
    expect(mockDeriveStageFromRemote).toHaveBeenCalledWith('adw-1', fakeReconcileDeps);
  });
});

describe('starting — the recorded owner decides, never the stage', () => {
  function startingState(overrides: Partial<AgentState> = {}): AgentState {
    return makeState({ workflowStage: 'starting', branchName: 'feature-branch', ...overrides });
  }

  describe('a live recorded owner', () => {
    const liveOwnerDeps = () => makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(startingState({ pid: 4242, pidStartedAt: 'live-start' })),
      isProcessLive: vi.fn().mockReturnValue(true),
    });

    it('is deferred to, carrying its pid, with the lock released so it can take it itself', () => {
      const deps = liveOwnerDeps();

      const decision = evaluateCandidate({ issueNumber: 108, boundary: FAKE_BOUNDARY }, deps);

      expect(decision).toEqual({ kind: 'defer_live_holder', holderPid: 4242 });
      expect(deps.isProcessLive).toHaveBeenCalledWith(4242, 'live-start');
      expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
    });

    it('is never killed, never has its worktree probed or reset, and nothing is reconciled or written', () => {
      const deps = liveOwnerDeps();

      evaluateCandidate({ issueNumber: 108, boundary: FAKE_BOUNDARY }, deps);

      expect(deps.killProcess).not.toHaveBeenCalled();
      expect(deps.resetWorktree).not.toHaveBeenCalled();
      expect(deps.probeWorktree).not.toHaveBeenCalled();
      expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
      expect(deps.writeTopLevelState).not.toHaveBeenCalled();
    });
  });

  describe('a dead recorded owner', () => {
    const deadOwner = { pid: 4242, pidStartedAt: 'crashed-run' };

    it('healthy probe → take_over_adwId through the reuse gate: probed with its path, branch, pid and start time, never reset or killed', () => {
      const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(startingState(deadOwner)) });

      const decision = evaluateCandidate({ issueNumber: 109, boundary: FAKE_BOUNDARY }, deps);

      expect(decision).toEqual({ kind: 'take_over_adwId', adwId: ADW_ID, derivedStage: 'abandoned' });
      expect(deps.probeWorktree).toHaveBeenCalledWith('/worktrees/feature-branch', 'feature-branch', 4242, 'crashed-run');
      expect(deps.resetWorktree).not.toHaveBeenCalled();
      expect(deps.killProcess).not.toHaveBeenCalled();
    });

    it('unhealthy probe → resetWorktree runs before deriveStageFromRemote', () => {
      const callOrder: string[] = [];
      const deps = makeDeps({
        readTopLevelState: vi.fn().mockReturnValue(startingState(deadOwner)),
        probeWorktree: vi.fn().mockReturnValue(unhealthyProbe('wrong_head')),
        resetWorktree: vi.fn().mockImplementation(() => callOrder.push('reset')),
        deriveStageFromRemote: vi.fn().mockImplementation(() => { callOrder.push('reconcile'); return 'starting'; }),
      });

      const decision = evaluateCandidate({ issueNumber: 109, boundary: FAKE_BOUNDARY }, deps);

      expect(decision.kind).toBe('take_over_adwId');
      expect(callOrder).toEqual(['reset', 'reconcile']);
      expect(deps.killProcess).not.toHaveBeenCalled();
    });

    it('keeps the lock for the caller that spawns the take-over', () => {
      const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(startingState(deadOwner)) });

      evaluateCandidate({ issueNumber: 109, boundary: FAKE_BOUNDARY }, deps);

      expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
    });
  });

  describe('no recorded owner', () => {
    it('counts as dead: through the reuse gate to take_over_adwId, with nothing killed', () => {
      const deps = makeDeps({ readTopLevelState: vi.fn().mockReturnValue(startingState()) });

      const decision = evaluateCandidate({ issueNumber: 110, boundary: FAKE_BOUNDARY }, deps);

      expect(decision.kind).toBe('take_over_adwId');
      expect(deps.probeWorktree).toHaveBeenCalledWith('/worktrees/feature-branch', 'feature-branch', undefined, undefined);
      expect(deps.resetWorktree).not.toHaveBeenCalled();
      expect(deps.killProcess).not.toHaveBeenCalled();
    });

    it('counts a pid that has no start time as unrecorded, since liveness cannot be confirmed', () => {
      const deps = makeDeps({
        readTopLevelState: vi.fn().mockReturnValue(startingState({ pid: 4242 })),
        isProcessLive: vi.fn().mockReturnValue(true),
      });

      const decision = evaluateCandidate({ issueNumber: 110, boundary: FAKE_BOUNDARY }, deps);

      expect(decision.kind).toBe('take_over_adwId');
      expect(deps.isProcessLive).not.toHaveBeenCalled();
    });
  });
});

describe('the spawn lock never outlives an evaluation that throws', () => {
  it('releases the lock exactly once and rethrows when the reset of an unpushed branch fails', () => {
    const resetFailure = new Error("Failed to fetch origin/bugfix-issue-935: fatal: couldn't find remote ref");
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'build_running', branchName: 'feature-branch', pid: 1, pidStartedAt: 'old' })),
      resetWorktree: vi.fn().mockImplementation(() => { throw resetFailure; }),
    });

    expect(() => evaluateCandidate({ issueNumber: 111, boundary: FAKE_BOUNDARY }, deps)).toThrow(resetFailure);
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
  });

  it('releases the lock exactly once and rethrows when the remote reconcile fails for an abandoned workflow', () => {
    const reconcileFailure = new Error('gh: HTTP 502');
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' })),
      deriveStageFromRemote: vi.fn().mockImplementation(() => { throw reconcileFailure; }),
    });

    expect(() => evaluateCandidate({ issueNumber: 112, boundary: FAKE_BOUNDARY }, deps)).toThrow(reconcileFailure);
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
  });

  it('releases the lock when reading the state fails after it was taken', () => {
    const deps = makeDeps({ readTopLevelState: vi.fn().mockImplementation(() => { throw new Error('EIO'); }) });

    expect(() => evaluateCandidate({ issueNumber: 113, boundary: FAKE_BOUNDARY }, deps)).toThrow('EIO');
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
  });

  it('never releases a lock it failed to take', () => {
    const deps = makeDeps({
      acquireIssueSpawnLock: vi.fn().mockReturnValue(false),
      readSpawnLockRecord: vi.fn().mockImplementation(() => { throw new Error('EIO'); }),
    });

    expect(() => evaluateCandidate({ issueNumber: 114, boundary: FAKE_BOUNDARY }, deps)).toThrow('EIO');
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });
});

describe('a spawn lock this very process left behind', () => {
  const ownLock = () => vi.fn().mockReturnValue({ pid: process.pid, pidStartedAt: 'cron-start' });
  const heldThenFree = () => vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);

  function depsHoldingOwnLock(state: AgentState | null, overrides: Partial<TakeoverDeps> = {}): TakeoverDeps {
    return makeDeps({
      acquireIssueSpawnLock: heldThenFree(),
      readSpawnLockRecord: ownLock(),
      readTopLevelState: vi.fn().mockReturnValue(state),
      ...overrides,
    });
  }

  it('is reclaimed for a starting workflow that records no owner: released once, taken again, then taken over', () => {
    const deps = depsHoldingOwnLock(makeState({ workflowStage: 'starting', branchName: 'feature-branch' }));

    const decision = evaluateCandidate({ issueNumber: 115, boundary: FAKE_BOUNDARY }, deps);

    expect(decision.kind).toBe('take_over_adwId');
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(deps.acquireIssueSpawnLock).toHaveBeenCalledTimes(2);
  });

  it('is reclaimed for an abandoned workflow that records no owner', () => {
    const deps = depsHoldingOwnLock(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' }));

    const decision = evaluateCandidate({ issueNumber: 116, boundary: FAKE_BOUNDARY }, deps);

    expect(decision.kind).toBe('take_over_adwId');
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(deps.acquireIssueSpawnLock).toHaveBeenCalledTimes(2);
  });

  it('is reclaimed for a phase_timeout workflow within the resume cap, which counts the resume once', () => {
    const deps = depsHoldingOwnLock(makeState({ workflowStage: 'phase_timeout', branchName: 'feature-branch' }));

    const decision = evaluateCandidate({ issueNumber: 117, boundary: FAKE_BOUNDARY }, deps);

    expect(decision.kind).toBe('take_over_adwId');
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(deps.writeTopLevelState).toHaveBeenCalledOnce();
    expect(deps.writeTopLevelState).toHaveBeenCalledWith(ADW_ID, { resumeAttempts: 1 });
  });

  it('is reclaimed for a *_running workflow whose recorded owner is dead', () => {
    const deps = depsHoldingOwnLock(
      makeState({ workflowStage: 'build_running', branchName: 'feature-branch', pid: 4242, pidStartedAt: 'crashed-run' }),
    );

    const decision = evaluateCandidate({ issueNumber: 118, boundary: FAKE_BOUNDARY }, deps);

    expect(decision.kind).toBe('take_over_adwId');
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(deps.killProcess).not.toHaveBeenCalled();
  });

  it('is not reclaimed while the workflow\'s recorded owner is alive', () => {
    const deps = depsHoldingOwnLock(
      makeState({ workflowStage: 'starting', branchName: 'feature-branch', pid: 4242, pidStartedAt: 'live-start' }),
      { isProcessLive: vi.fn().mockReturnValue(true) },
    );

    const decision = evaluateCandidate({ issueNumber: 119, boundary: FAKE_BOUNDARY }, deps);

    expect(decision).toEqual({ kind: 'defer_live_holder', holderPid: process.pid });
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
    expect(deps.acquireIssueSpawnLock).toHaveBeenCalledOnce();
  });

  it('is not reclaimed for a stage the handler answers with spawn_fresh, which is the hold an in-process wait spans', () => {
    const deps = depsHoldingOwnLock(makeState({ workflowStage: 'build_completed', branchName: 'feature-branch' }));

    const decision = evaluateCandidate({ issueNumber: 120, boundary: FAKE_BOUNDARY }, deps);

    expect(decision).toEqual({ kind: 'defer_live_holder', holderPid: process.pid });
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });

  it.each([
    ['no adwId is known yet', () => depsHoldingOwnLock(null, { resolveAdwId: vi.fn().mockReturnValue(null) })],
    ['the adwId has no state file', () => depsHoldingOwnLock(null)],
  ])('is not reclaimed when %s', (_label, buildDeps) => {
    const deps = buildDeps();

    const decision = evaluateCandidate({ issueNumber: 121, boundary: FAKE_BOUNDARY }, deps);

    expect(decision).toEqual({ kind: 'defer_live_holder', holderPid: process.pid });
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });

  it('is never touched when another process holds the lock, and the workflow is not even read', () => {
    const deps = makeDeps({
      acquireIssueSpawnLock: vi.fn().mockReturnValue(false),
      readSpawnLockRecord: vi.fn().mockReturnValue({ pid: process.pid + 1, pidStartedAt: 'other-start' }),
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' })),
    });

    const decision = evaluateCandidate({ issueNumber: 122, boundary: FAKE_BOUNDARY }, deps);

    expect(decision).toEqual({ kind: 'defer_live_holder', holderPid: process.pid + 1 });
    expect(deps.resolveAdwId).not.toHaveBeenCalled();
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });

  it('defers when the lock cannot be taken again after it was released', () => {
    const deps = depsHoldingOwnLock(makeState({ workflowStage: 'abandoned', branchName: 'feature-branch' }), {
      acquireIssueSpawnLock: vi.fn().mockReturnValue(false),
    });

    const decision = evaluateCandidate({ issueNumber: 123, boundary: FAKE_BOUNDARY }, deps);

    expect(decision.kind).toBe('defer_live_holder');
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
    expect(deps.probeWorktree).not.toHaveBeenCalled();
  });
});
