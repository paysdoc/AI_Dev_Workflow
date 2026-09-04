import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../agentState', () => ({
  AgentStateManager: {
    readTopLevelState: vi.fn(),
  },
}));

import {
  deriveStageFromRemote,
  mapArtifactsToStage,
  buildDefaultReconcileDeps,
  MAX_RECONCILE_VERIFICATION_RETRIES,
  type ReconcileDeps,
} from '../remoteReconcile';
import { AgentStateManager } from '../agentState';
import type { AgentState } from '../../types/agentTypes';
import type { RawPR } from '../../github/prApi';
import type { RepoInfo } from '../../github/githubApi';
import type { LaunchBoundary } from '../launchGitContext';
import type { GitContext } from '../../gitContext';
import type { CodeHost, PullRequestSummary } from '../../providers/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const REPO_INFO: RepoInfo = { owner: 'acme', repo: 'myrepo' };

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    adwId: 'test-adw-id',
    issueNumber: 42,
    agentName: 'sdlc-orchestrator',
    execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
    branchName: 'feature-issue-42-abc',
    workflowStage: 'build_running',
    ...overrides,
  };
}

function makePR(overrides: Partial<RawPR> = {}): RawPR {
  return {
    number: 7,
    state: 'OPEN',
    headRefName: 'feature-issue-42-abc',
    baseRefName: 'main',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    readTopLevelState: vi.fn().mockReturnValue(makeState()),
    branchExistsOnRemote: vi.fn().mockReturnValue(true),
    findPRByBranch: vi.fn().mockReturnValue(makePR()),
    ...overrides,
  };
}

// ── mapArtifactsToStage — pure mapping ────────────────────────────────────────

describe('mapArtifactsToStage', () => {
  it('returns null when branch does not exist', () => {
    expect(mapArtifactsToStage(false, null)).toBe(null);
  });

  it('returns null when branch does not exist even if PR present', () => {
    expect(mapArtifactsToStage(false, makePR())).toBe(null);
  });

  it('returns branch_created when branch exists and no PR', () => {
    expect(mapArtifactsToStage(true, null)).toBe('branch_created');
  });

  it('returns awaiting_merge when branch exists and PR is OPEN', () => {
    expect(mapArtifactsToStage(true, makePR({ state: 'OPEN' }))).toBe('awaiting_merge');
  });

  it('returns completed when branch exists and PR is MERGED', () => {
    expect(mapArtifactsToStage(true, makePR({ state: 'MERGED' }))).toBe('completed');
  });

  it('returns discarded when branch exists and PR is CLOSED', () => {
    expect(mapArtifactsToStage(true, makePR({ state: 'CLOSED' }))).toBe('discarded');
  });

  it('returns null for unknown PR state', () => {
    expect(mapArtifactsToStage(true, makePR({ state: 'UNKNOWN_STATE' }))).toBe(null);
  });
});

// ── deriveStageFromRemote — happy path ────────────────────────────────────────

describe('deriveStageFromRemote — happy path mappings', () => {
  it('returns branch_created when branch exists and no PR', () => {
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue(null) });

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, deps);

    expect(result).toBe('branch_created');
    // initial read + at least one re-verification read
    expect(deps.branchExistsOnRemote).toHaveBeenCalledTimes(2);
    expect(deps.findPRByBranch).toHaveBeenCalledTimes(2);
  });

  it('returns awaiting_merge when branch exists and PR is OPEN', () => {
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue(makePR({ state: 'OPEN' })) });

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, deps);

    expect(result).toBe('awaiting_merge');
    expect(deps.branchExistsOnRemote).toHaveBeenCalledTimes(2);
  });

  it('returns completed when branch exists and PR is MERGED', () => {
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue(makePR({ state: 'MERGED' })) });

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, deps);

    expect(result).toBe('completed');
    expect(deps.branchExistsOnRemote).toHaveBeenCalledTimes(2);
  });

  it('returns discarded when branch exists and PR is CLOSED', () => {
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue(makePR({ state: 'CLOSED' })) });

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, deps);

    expect(result).toBe('discarded');
    expect(deps.branchExistsOnRemote).toHaveBeenCalledTimes(2);
  });
});

// ── deriveStageFromRemote — re-verification ───────────────────────────────────

describe('deriveStageFromRemote — re-verification', () => {
  it('returns converged value when reads flap then stabilize on third pair', () => {
    // Read 1: awaiting_merge, Read 2: completed (flap), Read 3: completed (stable)
    const findPR = vi.fn()
      .mockReturnValueOnce(makePR({ state: 'OPEN' }))    // initial read
      .mockReturnValueOnce(makePR({ state: 'MERGED' }))  // re-verify (diverges)
      .mockReturnValueOnce(makePR({ state: 'MERGED' })); // retry (agrees)
    const branchExists = vi.fn().mockReturnValue(true);

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, makeDeps({
      branchExistsOnRemote: branchExists,
      findPRByBranch: findPR,
    }));

    expect(result).toBe('completed');
    expect(findPR).toHaveBeenCalledTimes(3);
  });

  it('falls back to state-file workflowStage when reads never stabilize', () => {
    // Alternate OPEN/MERGED forever — never two in a row the same
    let call = 0;
    const findPR = vi.fn().mockImplementation(() =>
      makePR({ state: call++ % 2 === 0 ? 'OPEN' : 'MERGED' }),
    );

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, makeDeps({
      findPRByBranch: findPR,
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'build_running' })),
    }));

    expect(result).toBe('build_running');
    // initial read + MAX_RECONCILE_VERIFICATION_RETRIES + 1 re-reads
    expect(findPR).toHaveBeenCalledTimes(MAX_RECONCILE_VERIFICATION_RETRIES + 2);
  });

  it('falls back to starting when reads never stabilize and state has no workflowStage', () => {
    let call = 0;
    const findPR = vi.fn().mockImplementation(() =>
      makePR({ state: call++ % 2 === 0 ? 'OPEN' : 'MERGED' }),
    );
    const state = makeState({ workflowStage: undefined });

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, makeDeps({
      findPRByBranch: findPR,
      readTopLevelState: vi.fn().mockReturnValue(state),
    }));

    expect(result).toBe('starting');
  });
});

// ── deriveStageFromRemote — state-file edges ──────────────────────────────────

describe('deriveStageFromRemote — state-file edges', () => {
  it('returns starting and issues zero GitHub reads when state file is missing', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(null),
    });

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, deps);

    expect(result).toBe('starting');
    expect(deps.branchExistsOnRemote).toHaveBeenCalledTimes(0);
    expect(deps.findPRByBranch).toHaveBeenCalledTimes(0);
  });

  it('returns state workflowStage and issues zero GitHub reads when branchName is missing', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ branchName: undefined })),
    });

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, deps);

    expect(result).toBe('build_running');
    expect(deps.branchExistsOnRemote).toHaveBeenCalledTimes(0);
    expect(deps.findPRByBranch).toHaveBeenCalledTimes(0);
  });

  it('returns starting when branchName is empty string', () => {
    const deps = makeDeps({
      readTopLevelState: vi.fn().mockReturnValue(makeState({ branchName: '', workflowStage: undefined })),
    });

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, deps);

    expect(result).toBe('starting');
    expect(deps.branchExistsOnRemote).toHaveBeenCalledTimes(0);
  });

  it('falls back to state-file workflowStage when remote branch does not exist', () => {
    const deps = makeDeps({
      branchExistsOnRemote: vi.fn().mockReturnValue(false),
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: 'build_running' })),
    });

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, deps);

    expect(result).toBe('build_running');
  });

  it('returns starting when remote branch absent and state has no workflowStage', () => {
    const deps = makeDeps({
      branchExistsOnRemote: vi.fn().mockReturnValue(false),
      readTopLevelState: vi.fn().mockReturnValue(makeState({ workflowStage: undefined })),
    });

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, deps);

    expect(result).toBe('starting');
  });
});

// ── buildDefaultReconcileDeps — boundary-bound wiring ─────────────────────────

function makeFakeBoundary(overrides: {
  lsRemote?: (branchName: string) => string[];
  findPullRequestByBranch?: (branchName: string) => Pick<PullRequestSummary, 'state'> | null;
} = {}): LaunchBoundary {
  const gitContext = {
    lsRemote: vi.fn(overrides.lsRemote ?? (() => ['abc123\trefs/heads/feature-issue-42-abc'])),
  } as unknown as GitContext;
  const codeHost = {
    findPullRequestByBranch: vi.fn(overrides.findPullRequestByBranch ?? (() => ({ state: 'OPEN' }))),
  } as unknown as CodeHost;
  return {
    gitContext,
    providers: { issueTracker: {} as never, codeHost },
  } as unknown as LaunchBoundary;
}

describe('buildDefaultReconcileDeps — boundary-bound wiring', () => {
  beforeEach(() => {
    vi.mocked(AgentStateManager.readTopLevelState).mockReturnValue(makeState());
  });

  it.each([
    ['OPEN', 'awaiting_merge'],
    ['MERGED', 'completed'],
    ['CLOSED', 'discarded'],
  ] as const)('maps PR state %s to workflow stage %s through the boundary\'s codeHost', (prState, expectedStage) => {
    const boundary = makeFakeBoundary({ findPullRequestByBranch: () => ({ state: prState }) });
    const deps = buildDefaultReconcileDeps(boundary);

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, deps);

    expect(result).toBe(expectedStage);
  });

  it('findPullRequestByBranch is called at least twice for one deriveStageFromRemote call — the read-your-write cross-check is never memoised', () => {
    const findPullRequestByBranch = vi.fn(() => ({ state: 'OPEN' as const }));
    const boundary = makeFakeBoundary({ findPullRequestByBranch });
    const deps = buildDefaultReconcileDeps(boundary);

    deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, deps);

    expect(findPullRequestByBranch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to the state-file stage when boundary.gitContext.lsRemote reports the branch absent', () => {
    const boundary = makeFakeBoundary({ lsRemote: () => [] });
    const deps = buildDefaultReconcileDeps(boundary);

    const result = deriveStageFromRemote(42, 'test-adw-id', REPO_INFO, deps);

    expect(result).toBe('build_running');
  });

  it('branchExistsOnRemote returns false (and does not throw) when gitContext.lsRemote throws', () => {
    const boundary = makeFakeBoundary();
    vi.mocked(boundary.gitContext.lsRemote).mockImplementation(() => { throw new Error('git ls-remote failed'); });
    const deps = buildDefaultReconcileDeps(boundary);

    expect(deps.branchExistsOnRemote('feature-issue-42-abc')).toBe(false);
  });
});
