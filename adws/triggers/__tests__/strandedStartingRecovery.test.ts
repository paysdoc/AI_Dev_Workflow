/**
 * An orchestrator that dies in `starting` must not strand its issue. These tests chain the real
 * resolver, the real cron filter and the real takeover handler through their public interfaces,
 * with only liveness, the state file and git injected.
 */

import { describe, it, expect, vi } from 'vitest';
import { Platform, type RepoIdentifier } from '@paysdoc/devplatform';
import { evaluateIssue, filterEligibleIssues } from '../cronIssueFilter';
import { resolveIssueWorkflowStage } from '../cronStageResolver';
import { evaluateCandidate, type TakeoverDeps } from '../takeoverHandler';
import { makeIssue, GRACE_PERIOD_MS, NOW, OLD_DATE } from './cronIssueFilterFixtures';
import type { LaunchBoundary } from '../../core';
import type { WorktreeProbe } from '../../vcs/worktreeReuseGate';
import type { AgentState } from '../../types/agentTypes';

const ADW_ID = 'stranded-adw-id';
const BRANCH = 'bugfix-issue-935-repair-regression-suite-scenarios';
const CRASHED_OWNER = { pid: 4242, pidStartedAt: 'crashed-run' } as const;
const ISSUE_COMMENTS = [{ body: `**ADW ID:** \`${ADW_ID}\`` }];
const REPO: RepoIdentifier = { owner: 'paysdoc', repo: 'AI_Dev_Workflow', platform: Platform.GitHub };
const WORKTREE = '/worktrees/bugfix-issue-935';
const BOUNDARY = { repoId: REPO, gitContext: { worktreePathFor: () => WORKTREE }, providers: {} } as unknown as LaunchBoundary;
const HEALTHY_PROBE: WorktreeProbe = {
  registration: 'healthy',
  indexLock: 'absent',
  interruptedOp: 'none',
  headOnExpectedBranch: true,
  liveOwner: false,
};

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    adwId: ADW_ID,
    issueNumber: 935,
    agentName: 'sdlc-orchestrator',
    execution: { status: 'running', startedAt: '2026-10-01T23:00:00Z' },
    workflowStage: 'starting',
    branchName: BRANCH,
    ...overrides,
  };
}

/** The state #935 was left in: `starting`, the previous run's heartbeat, no owner recorded. */
function makeStateOf935(): AgentState {
  return makeState({ lastSeenAt: '2026-10-01T23:45:26.529Z', resumeAttempts: 1 });
}

function makeFilterIssue(overrides: Parameters<typeof makeIssue>[0] = {}) {
  return makeIssue({ number: 935, comments: ISSUE_COMMENTS, createdAt: OLD_DATE, updatedAt: OLD_DATE, ...overrides });
}

function resolverFor(state: AgentState, ownerAlive: boolean) {
  return (comments: { body: string }[]) => resolveIssueWorkflowStage(comments, () => state, () => ownerAlive);
}

describe('cron filter: an active stage whose orchestrator is dead', () => {
  it('passes a starting state whose recorded owner is dead on to the takeover handler under its adwId', () => {
    const result = evaluateIssue(makeFilterIssue(), NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolverFor(makeState(CRASHED_OWNER), false));

    expect(result).toEqual({ eligible: true, action: 'spawn', adwId: ADW_ID });
  });

  it('passes #935\'s starting state, which records no owner, on to the takeover handler', () => {
    const result = evaluateIssue(makeFilterIssue(), NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolverFor(makeStateOf935(), true));

    expect(result).toEqual({ eligible: true, action: 'spawn', adwId: ADW_ID });
  });

  it.each(['build_running', 'stepDef_running'])('passes a %s state whose recorded owner is dead', (workflowStage) => {
    const state = makeState({ workflowStage, ...CRASHED_OWNER });

    const result = evaluateIssue(makeFilterIssue(), NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolverFor(state, false));

    expect(result).toEqual({ eligible: true, action: 'spawn', adwId: ADW_ID });
  });

  it('still excludes a starting state whose recorded owner is alive, so a slow startup is never disturbed', () => {
    const result = evaluateIssue(makeFilterIssue(), NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolverFor(makeState(CRASHED_OWNER), true));

    expect(result).toEqual({ eligible: false, reason: 'active' });
  });

  it('stays eligible when this cron spawned the issue itself, so recovery needs no cron restart', () => {
    const result = evaluateIssue(makeFilterIssue(), NOW, { spawns: new Set([935]) }, GRACE_PERIOD_MS, resolverFor(makeState(CRASHED_OWNER), false));

    expect(result).toEqual({ eligible: true, action: 'spawn', adwId: ADW_ID });
  });

  it('waits out the grace period first, then becomes eligible once it has passed', () => {
    const resolution = { ...resolverFor(makeState(CRASHED_OWNER), false)(ISSUE_COMMENTS), lastActivityMs: NOW - 1_000 };
    const resolveStage = () => resolution;

    const inside = evaluateIssue(makeFilterIssue(), NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);
    const past = evaluateIssue(makeFilterIssue(), NOW + GRACE_PERIOD_MS, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);

    expect(inside).toEqual({ eligible: false, reason: 'grace_period' });
    expect(past).toEqual({ eligible: true, action: 'spawn', adwId: ADW_ID });
  });

  it('never passes an issue that carries adw:none, whatever became of its orchestrator', () => {
    const issue = makeFilterIssue({ labels: [{ name: 'adw:bug' }, { name: 'adw:none' }] });

    const result = evaluateIssue(issue, NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolverFor(makeState(CRASHED_OWNER), false));

    expect(result).toEqual({ eligible: false, reason: 'label:opt_out' });
  });

  it('lists the dead-owner issue as a candidate and annotates the live-owner one as active', () => {
    const states: Record<string, AgentState> = {
      'live-adw-id': makeState({ adwId: 'live-adw-id', pid: 1, pidStartedAt: 'live-run' }),
      'dead-adw-id': makeState({ adwId: 'dead-adw-id', pid: 2, pidStartedAt: 'dead-run' }),
    };
    const issues = [
      makeFilterIssue({ number: 1, comments: [{ body: '**ADW ID:** `live-adw-id`' }] }),
      makeFilterIssue({ number: 2, comments: [{ body: '**ADW ID:** `dead-adw-id`' }] }),
    ];
    const resolveStage = (comments: { body: string }[]) =>
      resolveIssueWorkflowStage(comments, (adwId) => states[adwId] ?? null, (_pid, pidStartedAt) => pidStartedAt === 'live-run');

    const { eligible, filteredAnnotations } = filterEligibleIssues(issues, NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolveStage);

    expect(eligible.map((candidate) => candidate.issue.number)).toEqual([2]);
    expect(filteredAnnotations).toEqual(['#1(active)']);
  });
});

function makeDeps(state: AgentState, overrides: Partial<TakeoverDeps> = {}): TakeoverDeps {
  return {
    acquireIssueSpawnLock: vi.fn().mockReturnValue(true),
    releaseIssueSpawnLock: vi.fn(),
    readSpawnLockRecord: vi.fn().mockReturnValue(null),
    resolveAdwId: vi.fn().mockReturnValue(ADW_ID),
    readTopLevelState: vi.fn().mockReturnValue(state),
    isProcessLive: vi.fn().mockReturnValue(false),
    killProcess: vi.fn(),
    resetWorktree: vi.fn(),
    deriveStageFromRemote: vi.fn().mockReturnValue('starting'),
    writeTopLevelState: vi.fn(),
    commentOnIssue: vi.fn(),
    probeWorktree: vi.fn().mockReturnValue(HEALTHY_PROBE),
    clearOrphanedIndexLock: vi.fn(),
    ...overrides,
  };
}

describe('a dead orchestrator in starting is recovered through the cron filter and the takeover handler', () => {
  it.each([
    ['records its owner', () => makeState(CRASHED_OWNER)],
    ['is in #935\'s state, with no owner recorded', () => makeStateOf935()],
  ])('when its state %s', (_label, buildState) => {
    const state = buildState();
    const filter = evaluateIssue(makeFilterIssue(), NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolverFor(state, false));
    const deps = makeDeps(state);

    const decision = evaluateCandidate({ issueNumber: 935, boundary: BOUNDARY }, deps);

    expect(filter).toEqual({ eligible: true, action: 'spawn', adwId: ADW_ID });
    expect(decision).toEqual({ kind: 'take_over_adwId', adwId: ADW_ID, derivedStage: 'starting' });
    expect(deps.killProcess).not.toHaveBeenCalled();
    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.releaseIssueSpawnLock).not.toHaveBeenCalled();
  });

  it('resets its worktree, rather than reusing it, when the worktree is not healthy', () => {
    const deps = makeDeps(makeState(CRASHED_OWNER), {
      probeWorktree: vi.fn().mockReturnValue({ ...HEALTHY_PROBE, interruptedOp: 'rebase' }),
    });

    const decision = evaluateCandidate({ issueNumber: 935, boundary: BOUNDARY }, deps);

    expect(decision.kind).toBe('take_over_adwId');
    expect(deps.resetWorktree).toHaveBeenCalledWith(WORKTREE, BRANCH);
  });
});

describe('a live orchestrator in starting is never disturbed', () => {
  const LIVE_OWNER = { pid: 4242, pidStartedAt: 'live-run' } as const;

  it('is left to itself by the cron filter, however long its startup takes', () => {
    const result = evaluateIssue(makeFilterIssue(), NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolverFor(makeState(LIVE_OWNER), true));

    expect(result).toEqual({ eligible: false, reason: 'active' });
  });

  it('is deferred to by the handler when it records starting between the filter and the decision: not killed, not reset, lock released', () => {
    const filterSaw = makeState({ workflowStage: 'phase_timeout' });
    const filter = evaluateIssue(makeFilterIssue(), NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolverFor(filterSaw, false));
    const deps = makeDeps(makeState(LIVE_OWNER), { isProcessLive: vi.fn().mockReturnValue(true) });

    const decision = evaluateCandidate({ issueNumber: 935, boundary: BOUNDARY }, deps);

    expect(filter).toEqual({ eligible: true, action: 'spawn', adwId: ADW_ID });
    expect(decision).toEqual({ kind: 'defer_live_holder', holderPid: 4242 });
    expect(deps.killProcess).not.toHaveBeenCalled();
    expect(deps.resetWorktree).not.toHaveBeenCalled();
    expect(deps.probeWorktree).not.toHaveBeenCalled();
    expect(deps.deriveStageFromRemote).not.toHaveBeenCalled();
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
  });
});

describe('a spawn lock the cron\'s own process left behind does not hold a dead workflow hostage', () => {
  it.each([
    ['starting, with no owner recorded', makeStateOf935],
    ['abandoned', () => makeState({ workflowStage: 'abandoned' })],
    ['phase_timeout', () => makeState({ workflowStage: 'phase_timeout' })],
  ])('when the workflow stands at %s', (_label, buildState) => {
    const state = buildState();
    const filter = evaluateIssue(makeFilterIssue(), NOW, { spawns: new Set() }, GRACE_PERIOD_MS, resolverFor(state, false));
    const deps = makeDeps(state, {
      acquireIssueSpawnLock: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
      readSpawnLockRecord: vi.fn().mockReturnValue({ pid: process.pid, pidStartedAt: 'cron-start' }),
    });

    const decision = evaluateCandidate({ issueNumber: 935, boundary: BOUNDARY }, deps);

    expect(filter.eligible).toBe(true);
    expect(decision.kind).toBe('take_over_adwId');
    expect(deps.releaseIssueSpawnLock).toHaveBeenCalledOnce();
  });
});
