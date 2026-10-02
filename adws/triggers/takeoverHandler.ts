/**
 * takeoverHandler — single decision tree for every candidate arriving at an issue.
 *
 * Decision tree (evaluated in order):
 *  1. Lock held by a live holder        → defer_live_holder; if the holder is this process and the
 *                                         issue's orchestrator is dead (abandoned, phase_timeout or
 *                                         active, no live owner recorded) the lock is reclaimed
 *  2. No adwId / no state file          → spawn_fresh
 *  3. completed / discarded             → skip_terminal (lock released)
 *  4. paused                            → skip_terminal with terminalStage "paused"
 *                                         (scanPauseQueue is the sole resumer)
 *  5. abandoned                         → probe worktree → reuse-in-place if healthy,
 *                                         else reset-from-remote → reconcile → take_over_adwId
 *  6. phase_timeout                     → cap automatic resumes: within budget →
 *                                         probe worktree → reuse-in-place if healthy,
 *                                         else reset-from-remote → reconcile → take_over_adwId;
 *                                         at cap → escalate_human_gated
 *  7. starting, live recorded owner     → defer_live_holder (lock released)
 *  8. starting, dead or unrecorded owner → probe worktree → reuse-in-place if healthy,
 *                                         else reset-from-remote → reconcile → take_over_adwId
 *  9. *_running / resuming,
 *     live PID not holding lock         → SIGKILL → worktreeReset → remoteReconcile → take_over_adwId
 * 10. *_running / resuming,
 *     dead PID                          → worktreeReset → remoteReconcile → take_over_adwId
 * 11. any other stage (defensive)       → spawn_fresh
 *
 * Any throw after the lock is acquired releases it before propagating.
 *
 * All I/O boundaries are injected via TakeoverDeps so every branch is unit-testable.
 */

import { acquireIssueSpawnLock, releaseIssueSpawnLock, readSpawnLockRecord } from './spawnGate';
import { isProcessLive, isRecordedOwnerLive } from '../core/processLiveness';
import { log } from '../core/logger';
import { AgentStateManager } from '../core/agentState';
import { deriveStageFromRemote, buildDefaultReconcileDeps, type ReconcileDeps } from '../core/remoteReconcile';
import type { LaunchBoundary } from '../core';
import { extractLatestAdwId } from './cronStageResolver';
import { classifyStageString } from '../core/stageClassifier';
import { nextResumeAction, MAX_RESUME_ATTEMPTS } from '../core/resumePolicy';
import { formatHumanGatedComment } from '../forge/workflowCommentsIssue';
import { decideWorktreeReuse } from '../vcs/worktreeReuseGate';
import { probeWorktree, clearOrphanedIndexLock, buildDefaultProbeDeps } from '../vcs/worktreeProbe';
import type { WorktreeProbe } from '../vcs/worktreeReuseGate';
import type { RepoIdentifier } from '@paysdoc/devplatform';
import type { AgentState } from '../types/agentTypes';
import type { WorkflowStage } from '../types/workflowTypes';

export type CandidateDecision =
  | { readonly kind: 'spawn_fresh' }
  | { readonly kind: 'take_over_adwId'; readonly adwId: string; readonly derivedStage: WorkflowStage }
  | { readonly kind: 'defer_live_holder'; readonly holderPid: number }
  | { readonly kind: 'skip_terminal'; readonly adwId: string; readonly terminalStage: 'completed' | 'discarded' | 'paused' | 'paused_auth' }
  | { readonly kind: 'escalate_human_gated'; readonly adwId: string };

/** Identity, worktree base path and providers all come from the boundary — there are no boundary-less callers any more. */
export interface EvaluateCandidateInput {
  readonly issueNumber: number;
  readonly boundary: LaunchBoundary;
}

export interface TakeoverDeps {
  readonly acquireIssueSpawnLock: (repoInfo: RepoIdentifier, issueNumber: number, ownPid: number) => boolean;
  readonly releaseIssueSpawnLock: (repoInfo: RepoIdentifier, issueNumber: number) => void;
  readonly readSpawnLockRecord: (repoInfo: RepoIdentifier, issueNumber: number) => { pid: number; pidStartedAt: string } | null;
  readonly resolveAdwId: (issueNumber: number, repoInfo: RepoIdentifier) => string | null;
  readonly readTopLevelState: (adwId: string) => AgentState | null;
  readonly isProcessLive: (pid: number, pidStartedAt: string) => boolean;
  readonly killProcess: (pid: number) => void;
  readonly resetWorktree: (worktreePath: string, branch: string) => void;
  readonly deriveStageFromRemote: (adwId: string) => WorkflowStage;
  readonly writeTopLevelState: (adwId: string, state: Partial<AgentState>) => void;
  readonly commentOnIssue: (issueNumber: number, body: string) => void;
  readonly probeWorktree: (worktreePath: string, expectedBranch: string, recordedPid?: number, recordedPidStartedAt?: string) => WorktreeProbe;
  readonly clearOrphanedIndexLock: (worktreePath: string) => void;
}

/** `reconcileDeps` defaults to the boundary's own wiring; overridable so tests can pin `branchExistsOnRemote` without a real git remote (the fixture repo is deliberately non-existent). */
export function buildDefaultTakeoverDeps(boundary: LaunchBoundary, reconcileDeps: ReconcileDeps = buildDefaultReconcileDeps(boundary)): TakeoverDeps {
  const gitCtx = boundary.gitContext;
  return {
    acquireIssueSpawnLock: (repoInfo, issueNumber, ownPid) =>
      acquireIssueSpawnLock(repoInfo, issueNumber, ownPid),
    releaseIssueSpawnLock: (repoInfo, issueNumber) =>
      releaseIssueSpawnLock(repoInfo, issueNumber),
    readSpawnLockRecord: (repoInfo, issueNumber) =>
      readSpawnLockRecord(repoInfo, issueNumber),
    resolveAdwId: (issueNumber) => {
      try {
        return extractLatestAdwId(boundary.providers.issueTracker.fetchComments(issueNumber).map((c) => ({ body: c.body })));
      } catch {
        return null;
      }
    },
    readTopLevelState: (adwId) => AgentStateManager.readTopLevelState(adwId),
    isProcessLive: (pid, pidStartedAt) => isProcessLive(pid, pidStartedAt),
    killProcess: (pid) => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // ESRCH: process already gone — proceed to takeover
      }
    },
    resetWorktree: (worktreePath, branch) => {
      gitCtx.resetWorktree(worktreePath, branch);
    },
    deriveStageFromRemote: (adwId) => deriveStageFromRemote(adwId, reconcileDeps),
    writeTopLevelState: (adwId, state) => AgentStateManager.writeTopLevelState(adwId, state),
    commentOnIssue: (issueNumber, body) => boundary.providers.issueTracker.commentOnIssue(issueNumber, body),
    probeWorktree: (worktreePath, expectedBranch, recordedPid, recordedPidStartedAt) => {
      return probeWorktree({ worktreePath, expectedBranch, recordedPid, recordedPidStartedAt }, buildDefaultProbeDeps(gitCtx));
    },
    clearOrphanedIndexLock: (worktreePath) => {
      clearOrphanedIndexLock(worktreePath, buildDefaultProbeDeps(gitCtx));
    },
  };
}

function takeOverWithDerivedStage(
  d: TakeoverDeps,
  adwId: string,
): CandidateDecision {
  const derivedStage = d.deriveStageFromRemote(adwId);
  return { kind: 'take_over_adwId', adwId, derivedStage };
}

function resolveWorktreePath(input: EvaluateCandidateInput, branchName: string): string {
  return input.boundary.gitContext.worktreePathFor(branchName);
}

function recoverViaResetFromRemote(
  d: TakeoverDeps,
  input: EvaluateCandidateInput,
  adwId: string,
  state: AgentState,
): CandidateDecision {
  if (state.branchName) {
    const wtPath = resolveWorktreePath(input, state.branchName);
    d.resetWorktree(wtPath, state.branchName);
  }
  return takeOverWithDerivedStage(d, adwId);
}

// For abandoned, phase_timeout and a starting run whose owner is dead: probe the worktree and reuse
// if healthy, else reset. The orchestrator is already dead in all three; the liveOwner signal is the
// confirmed-dead safety net so a surprise-live owner forces a reset, never a reuse.
function recoverViaResumeInPlaceOrReset(
  d: TakeoverDeps,
  input: EvaluateCandidateInput,
  adwId: string,
  state: AgentState,
): CandidateDecision {
  if (!state.branchName) return takeOverWithDerivedStage(d, adwId);

  const wtPath = resolveWorktreePath(input, state.branchName);
  const probe = d.probeWorktree(wtPath, state.branchName, state.pid, state.pidStartedAt);
  const decision = decideWorktreeReuse(probe);

  if (!decision.reuse) return recoverViaResetFromRemote(d, input, adwId, state);

  // Healthy: resume in place — clear orphaned lock if present so the first git op succeeds.
  if (probe.indexLock === 'orphaned') d.clearOrphanedIndexLock(wtPath);
  return takeOverWithDerivedStage(d, adwId);
}

function recoverStartingStage(
  d: TakeoverDeps,
  input: EvaluateCandidateInput,
  adwId: string,
  state: AgentState,
  releaseLock: () => void,
): CandidateDecision {
  // A live owner that does not hold the lock has not taken its lifecycle lock yet, which comes right
  // after initializeWorkflow: a slow startup, not a split brain. Never kill it or reset its worktree.
  if (isRecordedOwnerLive(state, d.isProcessLive)) {
    releaseLock();
    return { kind: 'defer_live_holder', holderPid: state.pid ?? 0 };
  }
  // Only a named phase writes a *_running stage, so a dead starting run may have run unnamed phases
  // and left partial work: its worktree goes through the same reuse gate as phase_timeout and abandoned.
  return recoverViaResumeInPlaceOrReset(d, input, adwId, state);
}

function recoverActiveStage(
  d: TakeoverDeps,
  input: EvaluateCandidateInput,
  adwId: string,
  state: AgentState,
  releaseLock: () => void,
): CandidateDecision {
  if (state.workflowStage === 'starting') return recoverStartingStage(d, input, adwId, state, releaseLock);

  // A live PID not holding the lock (we acquired it) is killed; the active path always resets, never reuses.
  if (state.pid !== undefined && isRecordedOwnerLive(state, d.isProcessLive)) {
    try {
      d.killProcess(state.pid);
    } catch {
      // ESRCH: process exited between liveness check and kill — proceed to takeover
    }
  }
  return recoverViaResetFromRemote(d, input, adwId, state);
}

// A lock recorded under this process's pid for a workflow the handler takes over (its orchestrator is
// gone unless an owner is recorded alive) can only be one this process failed to release: in-process
// holds that span an await only follow spawn_fresh, which these stages never produce, and an
// orchestrator spawned under such a hold records its own live pid at `starting`.
function reclaimOwnLeakedLock(d: TakeoverDeps, input: EvaluateCandidateInput): boolean {
  const { issueNumber, boundary } = input;
  const repoInfo = boundary.repoId;
  if (d.readSpawnLockRecord(repoInfo, issueNumber)?.pid !== process.pid) return false;

  const adwId = d.resolveAdwId(issueNumber, repoInfo);
  if (adwId === null) return false;
  const state = d.readTopLevelState(adwId);
  if (state === null) return false;

  const stage = state.workflowStage ?? '';
  const takenOver = stage === 'abandoned' || stage === 'phase_timeout' || classifyStageString(stage) === 'active';
  if (!takenOver || isRecordedOwnerLive(state, d.isProcessLive)) return false;

  log(`Issue #${issueNumber}: spawn lock was left behind by this process (stage "${stage}", no live orchestrator), reclaiming`, 'warn');
  d.releaseIssueSpawnLock(repoInfo, issueNumber);
  return d.acquireIssueSpawnLock(repoInfo, issueNumber, process.pid);
}

function decideHoldingLock(
  d: TakeoverDeps,
  input: EvaluateCandidateInput,
  releaseLock: () => void,
): CandidateDecision {
  const adwId = d.resolveAdwId(input.issueNumber, input.boundary.repoId);
  // No prior ADW work — spawn fresh; lock stays held for caller's spawn.
  if (adwId === null) return { kind: 'spawn_fresh' };

  const state = d.readTopLevelState(adwId);
  if (state === null) return { kind: 'spawn_fresh' };

  const stage = state.workflowStage ?? '';
  const cls = classifyStageString(stage);

  if (cls === 'terminal') {
    releaseLock();
    return {
      kind: 'skip_terminal',
      adwId,
      terminalStage: stage as 'completed' | 'discarded' | 'paused' | 'paused_auth',
    };
  }

  if (cls === 'retriable') return recoverViaResumeInPlaceOrReset(d, input, adwId, state);

  if (stage === 'phase_timeout') {
    const attempts = state.resumeAttempts ?? 0;
    if (nextResumeAction(attempts, MAX_RESUME_ATTEMPTS) === 'escalate') {
      d.writeTopLevelState(adwId, { workflowStage: 'human_gated' });
      d.commentOnIssue(
        input.issueNumber,
        formatHumanGatedComment(adwId, attempts, MAX_RESUME_ATTEMPTS),
      );
      releaseLock();
      return { kind: 'escalate_human_gated', adwId };
    }
    d.writeTopLevelState(adwId, { resumeAttempts: attempts + 1 });
    return recoverViaResumeInPlaceOrReset(d, input, adwId, state);
  }

  if (cls === 'active') return recoverActiveStage(d, input, adwId, state, releaseLock);

  return { kind: 'spawn_fresh' };
}

export function evaluateCandidate(
  input: EvaluateCandidateInput,
  deps?: TakeoverDeps,
): CandidateDecision {
  const d = deps ?? buildDefaultTakeoverDeps(input.boundary);
  const { issueNumber, boundary } = input;
  const repoInfo = boundary.repoId;

  const acquired = d.acquireIssueSpawnLock(repoInfo, issueNumber, process.pid) || reclaimOwnLeakedLock(d, input);
  if (!acquired) {
    const holder = d.readSpawnLockRecord(repoInfo, issueNumber);
    return { kind: 'defer_live_holder', holderPid: holder?.pid ?? 0 };
  }

  // We hold the lock from here. Release it on any non-takeover exit, and on a throw: a lock left
  // under this process's pid reads as a live holder for as long as a long-lived caller, the cron, runs.
  const releaseLock = () => d.releaseIssueSpawnLock(repoInfo, issueNumber);
  try {
    return decideHoldingLock(d, input, releaseLock);
  } catch (error) {
    releaseLock();
    throw error;
  }
}
