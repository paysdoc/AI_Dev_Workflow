/**
 * Integration test: abandoned takeover end-to-end against a fixture state file.
 *
 * Uses a real tmpDir for the state file read (via a stubbed readTopLevelState
 * that reads from the fixture), but stubs all network/git I/O (resetWorktree,
 * deriveStageFromRemote, resolveAdwId) so no real filesystem mutations or
 * GitHub calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockWorktreePathFor = vi.hoisted(() => vi.fn().mockReturnValue('/tmp/integ-worktree'));
vi.mock('../../github/gitContextFactory', () => ({
  gitContextForSync: vi.fn().mockReturnValue({ worktreePathFor: mockWorktreePathFor }),
}));
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { evaluateCandidate } from '../takeoverHandler';
import type { TakeoverDeps, CandidateDecision } from '../takeoverHandler';
import { Platform, type RepoIdentifier } from '../../providers/types';
import type { AgentState } from '../../types/agentTypes';
import type { LaunchBoundary } from '../../core';
import type { GitContext } from '../../gitContext';

const REPO: RepoIdentifier = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub };
const FAKE_BOUNDARY: LaunchBoundary = {
  repoId: REPO,
  gitContext: { worktreePathFor: mockWorktreePathFor } as unknown as GitContext,
  providers: {},
} as unknown as LaunchBoundary;
const FIXTURE_ADW_ID = 'fixture-adwid';
const FIXTURE_BRANCH = 'feature/issue-999-fixture';
const FIXTURE_ISSUE = 999;

let tmpDir = '';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'takeover-integ-'));
  vi.clearAllMocks();
  mockWorktreePathFor.mockReturnValue(path.join(tmpDir, 'worktree'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixtureState(state: Partial<AgentState>): void {
  const stateDir = path.join(tmpDir, FIXTURE_ADW_ID);
  fs.mkdirSync(stateDir, { recursive: true });
  const full: AgentState = {
    adwId: FIXTURE_ADW_ID,
    issueNumber: FIXTURE_ISSUE,
    agentName: 'orchestrator',
    execution: { status: 'completed', startedAt: '2026-01-01T00:00:00Z' },
    workflowStage: 'abandoned',
    branchName: FIXTURE_BRANCH,
    ...state,
  };
  fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify(full, null, 2), 'utf-8');
}

function makeIntegDeps(overrides: Partial<TakeoverDeps> = {}): TakeoverDeps {
  return {
    acquireIssueSpawnLock: vi.fn().mockReturnValue(true),
    releaseIssueSpawnLock: vi.fn(),
    readSpawnLockRecord: vi.fn().mockReturnValue(null),
    resolveAdwId: vi.fn().mockReturnValue(FIXTURE_ADW_ID),
    readTopLevelState: vi.fn().mockImplementation((adwId: string) => {
      const statePath = path.join(tmpDir, adwId, 'state.json');
      if (!fs.existsSync(statePath)) return null;
      return JSON.parse(fs.readFileSync(statePath, 'utf-8')) as AgentState;
    }),
    isProcessLive: vi.fn().mockReturnValue(false),
    killProcess: vi.fn(),
    resetWorktree: vi.fn(),
    deriveStageFromRemote: vi.fn().mockReturnValue('awaiting_merge'),
    writeTopLevelState: vi.fn(),
    commentOnIssue: vi.fn(),
    probeWorktree: vi.fn().mockReturnValue({
      registration: 'healthy',
      indexLock: 'absent',
      interruptedOp: 'none',
      headOnExpectedBranch: true,
      liveOwner: false,
    }),
    clearOrphanedIndexLock: vi.fn(),
    ...overrides,
  };
}

describe('abandoned takeover end-to-end (integration)', () => {
  it('returns take_over_adwId with the fixture adwId and derived stage', () => {
    writeFixtureState({ workflowStage: 'abandoned', branchName: FIXTURE_BRANCH });
    const deps = makeIntegDeps();

    const decision = evaluateCandidate({ issueNumber: FIXTURE_ISSUE, boundary: FAKE_BOUNDARY }, deps);

    expect(decision).toMatchObject({
      kind: 'take_over_adwId',
      adwId: FIXTURE_ADW_ID,
      derivedStage: 'awaiting_merge',
    });
  });

  it('invokes resetWorktree with the fixture worktree path and branchName when gate fails', () => {
    writeFixtureState({ workflowStage: 'abandoned', branchName: FIXTURE_BRANCH });
    const wtPath = path.join(tmpDir, 'worktree');
    mockWorktreePathFor.mockReturnValue(wtPath);
    const unhealthyProbe = { registration: 'healthy' as const, indexLock: 'absent' as const, interruptedOp: 'rebase' as const, headOnExpectedBranch: true, liveOwner: false };
    const deps = makeIntegDeps({
      probeWorktree: vi.fn().mockReturnValue(unhealthyProbe),
    });

    evaluateCandidate({ issueNumber: FIXTURE_ISSUE, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.resetWorktree).toHaveBeenCalledWith(wtPath, FIXTURE_BRANCH);
  });

  it('invokes deriveStageFromRemote with the fixture adwId', () => {
    writeFixtureState({ workflowStage: 'abandoned', branchName: FIXTURE_BRANCH });
    const deps = makeIntegDeps();

    evaluateCandidate({ issueNumber: FIXTURE_ISSUE, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.deriveStageFromRemote).toHaveBeenCalledWith(FIXTURE_ADW_ID);
  });

  it('resetWorktree is called before deriveStageFromRemote when gate fails', () => {
    writeFixtureState({ workflowStage: 'abandoned', branchName: FIXTURE_BRANCH });
    const callOrder: string[] = [];
    const unhealthyProbe = { registration: 'healthy' as const, indexLock: 'absent' as const, interruptedOp: 'rebase' as const, headOnExpectedBranch: true, liveOwner: false };
    const deps = makeIntegDeps({
      probeWorktree: vi.fn().mockReturnValue(unhealthyProbe),
      resetWorktree: vi.fn().mockImplementation(() => callOrder.push('reset')),
      deriveStageFromRemote: vi.fn().mockImplementation(() => { callOrder.push('reconcile'); return 'awaiting_merge'; }),
    });

    evaluateCandidate({ issueNumber: FIXTURE_ISSUE, boundary: FAKE_BOUNDARY }, deps);

    expect(callOrder).toEqual(['reset', 'reconcile']);
  });

  it('lock is NOT released (caller keeps it for the spawn)', () => {
    writeFixtureState({ workflowStage: 'abandoned', branchName: FIXTURE_BRANCH });
    const deps = makeIntegDeps();

    evaluateCandidate({ issueNumber: FIXTURE_ISSUE, boundary: FAKE_BOUNDARY }, deps);

    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });

  it('returns spawn_fresh when no fixture state file exists', () => {
    // No writeFixtureState call — file absent
    const deps = makeIntegDeps();

    const decision = evaluateCandidate({ issueNumber: FIXTURE_ISSUE, boundary: FAKE_BOUNDARY }, deps) as CandidateDecision;

    expect(decision.kind).toBe('spawn_fresh');
  });
});
