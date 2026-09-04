/**
 * takeoverHandler — single decision tree for every candidate arriving at an issue.
 *
 * Decision tree (evaluated in order):
 *  1. Lock held by live holder          → defer_live_holder
 *  2. No adwId / no state file          → spawn_fresh
 *  3. completed / discarded             → skip_terminal (lock released)
 *  4. paused                            → skip_terminal with terminalStage "paused"
 *                                         (scanPauseQueue is the sole resumer)
 *  5. abandoned                         → probe worktree → reuse-in-place if healthy,
 *                                         else reset-from-remote → reconcile → take_over_adwId
 *  6. phase_timeout                     → cap automatic resumes (#639): within budget →
 *                                         probe worktree → reuse-in-place if healthy,
 *                                         else reset-from-remote → reconcile → take_over_adwId;
 *                                         at cap → escalate_human_gated
 *  7. *_running / starting / resuming,
 *     live PID not holding lock         → SIGKILL → worktreeReset → remoteReconcile → take_over_adwId
 *  8. *_running / starting / resuming,
 *     dead PID                          → worktreeReset → remoteReconcile → take_over_adwId
 *  9. any other stage (defensive)       → spawn_fresh
 *
 * All I/O boundaries are injected via TakeoverDeps so every branch is unit-testable.
 */

import {
  acquireIssueSpawnLock,
  releaseIssueSpawnLock,
  readSpawnLockRecord,
} from './spawnGate';
import { isProcessLive } from '../core/processLiveness';
import { AgentStateManager } from '../core/agentState';
import { deriveStageFromRemote, buildDefaultReconcileDeps } from '../core/remoteReconcile';
import { gitContextForSync } from '../github';
import { fetchIssueCommentBodies } from '../github/issueListApi';
import type { LaunchBoundary } from '../core';
import { extractLatestAdwId } from './cronStageResolver';
import { classifyStageString } from '../core/stageClassifier';
import { nextResumeAction, MAX_RESUME_ATTEMPTS } from '../core/resumePolicy';
import { formatHumanGatedComment } from '../github/workflowCommentsIssue';
import { commentOnIssue } from '../github/githubApi';
import { decideWorktreeReuse } from '../vcs/worktreeReuseGate';
import { probeWorktree, clearOrphanedIndexLock, buildDefaultProbeDeps } from '../vcs/worktreeProbe';
import type { WorktreeProbe } from '../vcs/worktreeReuseGate';
import type { RepoInfo } from '../github/githubApi';
import type { AgentState } from '../types/agentTypes';
import type { WorkflowStage } from '../types/workflowTypes';
import type { GitContext } from '../gitContext';

export type CandidateDecision =
  | { readonly kind: 'spawn_fresh' }
  | { readonly kind: 'take_over_adwId'; readonly adwId: string; readonly derivedStage: WorkflowStage }
  | { readonly kind: 'defer_live_holder'; readonly holderPid: number }
  | { readonly kind: 'skip_terminal'; readonly adwId: string; readonly terminalStage: 'completed' | 'discarded' | 'paused' | 'paused_auth' }
  | { readonly kind: 'escalate_human_gated'; readonly adwId: string };

export interface EvaluateCandidateInput {
  readonly issueNumber: number;
  readonly repoInfo: RepoInfo;
  /** Launch-boundary GitContext. When provided, worktree paths are resolved via the
   *  context's base path (never from ambient cwd). Absent only in legacy callers. */
  readonly gitContext?: GitContext;
  /** The launch boundary. When provided, resolveAdwId reads comments through its issue
   *  tracker instead of a fresh gitContextForRepo(...)-backed gh call. Absent only in
   *  legacy callers. */
  readonly boundary?: LaunchBoundary;
}

export interface TakeoverDeps {
  readonly acquireIssueSpawnLock: (repoInfo: RepoInfo, issueNumber: number, ownPid: number) => boolean;
  readonly releaseIssueSpawnLock: (repoInfo: RepoInfo, issueNumber: number) => void;
  readonly readSpawnLockRecord: (repoInfo: RepoInfo, issueNumber: number) => { pid: number; pidStartedAt: string } | null;
  readonly resolveAdwId: (issueNumber: number, repoInfo: RepoInfo) => string | null;
  readonly readTopLevelState: (adwId: string) => AgentState | null;
  readonly isProcessLive: (pid: number, pidStartedAt: string) => boolean;
  readonly killProcess: (pid: number) => void;
  readonly resetWorktree: (worktreePath: string, branch: string) => void;
  readonly deriveStageFromRemote: (issueNumber: number, adwId: string, repoInfo: RepoInfo) => WorkflowStage;
  readonly writeTopLevelState: (adwId: string, state: Partial<AgentState>) => void;
  readonly commentOnIssue: (issueNumber: number, body: string, repoInfo: RepoInfo) => void;
  readonly probeWorktree: (worktreePath: string, expectedBranch: string, recordedPid?: number, recordedPidStartedAt?: string) => WorktreeProbe;
  readonly clearOrphanedIndexLock: (worktreePath: string) => void;
}

export function buildDefaultTakeoverDeps(repoInfo?: RepoInfo, boundary?: LaunchBoundary): TakeoverDeps {
  return {
    acquireIssueSpawnLock: (repoInfo, issueNumber, ownPid) =>
      acquireIssueSpawnLock(repoInfo, issueNumber, ownPid),
    releaseIssueSpawnLock: (repoInfo, issueNumber) =>
      releaseIssueSpawnLock(repoInfo, issueNumber),
    readSpawnLockRecord: (repoInfo, issueNumber) =>
      readSpawnLockRecord(repoInfo, issueNumber),
    resolveAdwId: (issueNumber, repoInfo) => {
      try {
        return boundary
          ? extractLatestAdwId(boundary.providers.issueTracker.fetchComments(issueNumber).map((c) => ({ body: c.body })))
          : extractLatestAdwId(fetchIssueCommentBodies(issueNumber, repoInfo));
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
      if (!repoInfo) throw new Error('takeoverHandler: repoInfo required for resetWorktree');
      gitContextForSync({ owner: repoInfo.owner, repo: repoInfo.repo, selfHost: false }).resetWorktree(worktreePath, branch);
    },
    deriveStageFromRemote: (issueNumber, adwId, repoInfo) =>
      deriveStageFromRemote(issueNumber, adwId, repoInfo, boundary ? buildDefaultReconcileDeps(boundary) : undefined),
    writeTopLevelState: (adwId, state) => AgentStateManager.writeTopLevelState(adwId, state),
    commentOnIssue: (issueNumber, body, repoInfo) => commentOnIssue(issueNumber, body, repoInfo),
    probeWorktree: (worktreePath, expectedBranch, recordedPid, recordedPidStartedAt) => {
      if (!repoInfo) throw new Error('takeoverHandler: repoInfo required for probeWorktree');
      const ctx = gitContextForSync({ owner: repoInfo.owner, repo: repoInfo.repo, selfHost: false });
      return probeWorktree({ worktreePath, expectedBranch, recordedPid, recordedPidStartedAt }, buildDefaultProbeDeps(ctx));
    },
    clearOrphanedIndexLock: (worktreePath) => {
      if (!repoInfo) throw new Error('takeoverHandler: repoInfo required for clearOrphanedIndexLock');
      const ctx = gitContextForSync({ owner: repoInfo.owner, repo: repoInfo.repo, selfHost: false });
      clearOrphanedIndexLock(worktreePath, buildDefaultProbeDeps(ctx));
    },
  };
}


function takeOverWithDerivedStage(
  d: TakeoverDeps,
  input: EvaluateCandidateInput,
  adwId: string,
): CandidateDecision {
  const derivedStage = d.deriveStageFromRemote(input.issueNumber, adwId, input.repoInfo);
  return { kind: 'take_over_adwId', adwId, derivedStage };
}

function resolveWorktreePath(input: EvaluateCandidateInput, branchName: string): string {
  const ctx = input.gitContext ?? gitContextForSync({ owner: input.repoInfo.owner, repo: input.repoInfo.repo, selfHost: false });
  return ctx.worktreePathFor(branchName);
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
  return takeOverWithDerivedStage(d, input, adwId);
}

// For abandoned + phase_timeout: probe the worktree and reuse if healthy, else reset.
// The orchestrator is already dead for both stages; the liveOwner signal is the
// confirmed-dead safety net so a surprise-live owner forces a reset, never a reuse.
function recoverViaResumeInPlaceOrReset(
  d: TakeoverDeps,
  input: EvaluateCandidateInput,
  adwId: string,
  state: AgentState,
): CandidateDecision {
  if (!state.branchName) return takeOverWithDerivedStage(d, input, adwId);

  const wtPath = resolveWorktreePath(input, state.branchName);
  const probe = d.probeWorktree(wtPath, state.branchName, state.pid, state.pidStartedAt);
  const decision = decideWorktreeReuse(probe);

  if (!decision.reuse) return recoverViaResetFromRemote(d, input, adwId, state);

  // Healthy: resume in place — clear orphaned lock if present so the first git op succeeds.
  if (probe.indexLock === 'orphaned') d.clearOrphanedIndexLock(wtPath);
  return takeOverWithDerivedStage(d, input, adwId);
}

export function evaluateCandidate(
  input: EvaluateCandidateInput,
  deps?: TakeoverDeps,
): CandidateDecision {
  const d = deps ?? buildDefaultTakeoverDeps(input.repoInfo, input.boundary);
  const { issueNumber, repoInfo } = input;

  // Branch 1: attempt to acquire the per-issue spawn lock.
  // If another live process holds it, defer immediately.
  const acquired = d.acquireIssueSpawnLock(repoInfo, issueNumber, process.pid);
  if (!acquired) {
    const holder = d.readSpawnLockRecord(repoInfo, issueNumber);
    return { kind: 'defer_live_holder', holderPid: holder?.pid ?? 0 };
  }

  // We hold the lock from here. Release it on any non-takeover exit.
  const releaseLock = () => d.releaseIssueSpawnLock(repoInfo, issueNumber);

  // Branch 2: resolve the canonical adwId from issue comments.
  const adwId = d.resolveAdwId(issueNumber, repoInfo);
  if (adwId === null) {
    // No prior ADW work — spawn fresh; lock stays held for caller's spawn.
    return { kind: 'spawn_fresh' };
  }

  const state = d.readTopLevelState(adwId);
  if (state === null) {
    // State file not found — treat as fresh.
    return { kind: 'spawn_fresh' };
  }

  const stage = state.workflowStage ?? '';
  const cls = classifyStageString(stage);

  // Branch 3 & 4: terminal — completed / discarded / paused / paused_auth.
  if (cls === 'terminal') {
    releaseLock();
    return {
      kind: 'skip_terminal',
      adwId,
      terminalStage: stage as 'completed' | 'discarded' | 'paused' | 'paused_auth',
    };
  }

  // Branch 5: retriable (abandoned) — probe worktree → reuse-in-place or reset-from-remote → takeover.
  if (cls === 'retriable') {
    return recoverViaResumeInPlaceOrReset(d, input, adwId, state);
  }

  // Branch 6: phase_timeout — the watchdog exited the orchestrator (process.exit(0)).
  // Cap the automatic resumes (#639): escalate to human_gated when the bound is reached.
  // Within budget: increment the counter and run the #638 reuse-or-reset gate.
  if (stage === 'phase_timeout') {
    const attempts = state.resumeAttempts ?? 0;
    if (nextResumeAction(attempts, MAX_RESUME_ATTEMPTS) === 'escalate') {
      d.writeTopLevelState(adwId, { workflowStage: 'human_gated' });
      d.commentOnIssue(
        input.issueNumber,
        formatHumanGatedComment(adwId, attempts, MAX_RESUME_ATTEMPTS),
        input.repoInfo,
      );
      releaseLock();
      return { kind: 'escalate_human_gated', adwId };
    }
    d.writeTopLevelState(adwId, { resumeAttempts: attempts + 1 });
    return recoverViaResumeInPlaceOrReset(d, input, adwId, state);
  }

  // Branch 7 & 8: active (*_running / starting / resuming).
  if (cls === 'active') {
    const pid = state.pid;
    const pidStartedAt = state.pidStartedAt ?? '';

    if (pid !== undefined && pidStartedAt && d.isProcessLive(pid, pidStartedAt)) {
      // Live PID not holding the lock (we acquired it) — send SIGKILL.
      try {
        d.killProcess(pid);
      } catch {
        // ESRCH: process exited between liveness check and kill — proceed to takeover
      }
    }
    // Dead PID (or post-SIGKILL): proceed with reset-from-remote (active path is out of scope for reuse).
    return recoverViaResetFromRemote(d, input, adwId, state);
  }

  // Branch 9: defensive fallthrough — awaiting_merge / human_gated / resumable.
  return { kind: 'spawn_fresh' };
}
