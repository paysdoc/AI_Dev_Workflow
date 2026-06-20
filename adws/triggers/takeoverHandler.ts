/**
 * takeoverHandler — single decision tree for every candidate arriving at an issue.
 *
 * Decision tree (evaluated in order):
 *  1. Lock held by live holder          → defer_live_holder
 *  2. No adwId / no state file          → spawn_fresh
 *  3. completed / discarded             → skip_terminal (lock released)
 *  4. paused                            → skip_terminal with terminalStage "paused"
 *                                         (scanPauseQueue is the sole resumer)
 *  5. abandoned                         → worktreeReset → remoteReconcile → take_over_adwId
 *  6. *_running / starting / resuming,
 *     live PID not holding lock         → SIGKILL → worktreeReset → remoteReconcile → take_over_adwId
 *  7. *_running / starting / resuming,
 *     dead PID                          → worktreeReset → remoteReconcile → take_over_adwId
 *  8. any other stage (defensive)       → spawn_fresh
 *
 * All I/O boundaries are injected via TakeoverDeps so every branch is unit-testable.
 */

import { execSync } from 'child_process';
import {
  acquireIssueSpawnLock,
  releaseIssueSpawnLock,
  readSpawnLockRecord,
} from './spawnGate';
import { isProcessLive } from '../core/processLiveness';
import { AgentStateManager } from '../core/agentState';
import { deriveStageFromRemote } from '../core/remoteReconcile';
import { resetWorktreeToRemote } from '../vcs/worktreeReset';
import { getWorktreePath } from '../vcs/worktreeOperations';
import { extractLatestAdwId } from './cronStageResolver';
import { classifyStageString } from '../core/stageClassifier';
import { nextResumeAction, MAX_RESUME_ATTEMPTS } from '../core/resumePolicy';
import { formatHumanGatedComment } from '../github/workflowCommentsIssue';
import { commentOnIssue } from '../github/githubApi';
import type { RepoInfo } from '../github/githubApi';
import type { AgentState } from '../types/agentTypes';
import type { WorkflowStage } from '../types/workflowTypes';

export type CandidateDecision =
  | { readonly kind: 'spawn_fresh' }
  | { readonly kind: 'take_over_adwId'; readonly adwId: string; readonly derivedStage: WorkflowStage }
  | { readonly kind: 'defer_live_holder'; readonly holderPid: number }
  | { readonly kind: 'skip_terminal'; readonly adwId: string; readonly terminalStage: 'completed' | 'discarded' | 'paused' | 'paused_auth' }
  | { readonly kind: 'escalate_human_gated'; readonly adwId: string };

export interface EvaluateCandidateInput {
  readonly issueNumber: number;
  readonly repoInfo: RepoInfo;
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
  readonly getWorktreePath: (branchName: string, baseRepoPath?: string) => string;
  readonly writeTopLevelState: (adwId: string, state: Partial<AgentState>) => void;
  readonly commentOnIssue: (issueNumber: number, body: string, repoInfo: RepoInfo) => void;
}

export function buildDefaultTakeoverDeps(): TakeoverDeps {
  return {
    acquireIssueSpawnLock: (repoInfo, issueNumber, ownPid) =>
      acquireIssueSpawnLock(repoInfo, issueNumber, ownPid),
    releaseIssueSpawnLock: (repoInfo, issueNumber) =>
      releaseIssueSpawnLock(repoInfo, issueNumber),
    readSpawnLockRecord: (repoInfo, issueNumber) =>
      readSpawnLockRecord(repoInfo, issueNumber),
    resolveAdwId: (issueNumber, repoInfo) => {
      try {
        const json = execSync(
          `gh issue view ${issueNumber} --repo ${repoInfo.owner}/${repoInfo.repo} --json comments --jq '.comments'`,
          { encoding: 'utf-8' },
        );
        const comments = JSON.parse(json) as { body: string }[];
        return extractLatestAdwId(comments);
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
    resetWorktree: (worktreePath, branch) => resetWorktreeToRemote(worktreePath, branch),
    deriveStageFromRemote: (issueNumber, adwId, repoInfo) =>
      deriveStageFromRemote(issueNumber, adwId, repoInfo),
    getWorktreePath: (branchName, baseRepoPath) => getWorktreePath(branchName, baseRepoPath),
    writeTopLevelState: (adwId, state) => AgentStateManager.writeTopLevelState(adwId, state),
    commentOnIssue: (issueNumber, body, repoInfo) => commentOnIssue(issueNumber, body, repoInfo),
  };
}

let _defaultDeps: TakeoverDeps | null = null;

function recoverViaResetFromRemote(
  d: TakeoverDeps,
  input: EvaluateCandidateInput,
  adwId: string,
  state: AgentState,
): CandidateDecision {
  if (state.branchName) {
    const wtPath = d.getWorktreePath(state.branchName);
    d.resetWorktree(wtPath, state.branchName);
  }
  const derivedStage = d.deriveStageFromRemote(input.issueNumber, adwId, input.repoInfo);
  return { kind: 'take_over_adwId', adwId, derivedStage };
}

export function evaluateCandidate(
  input: EvaluateCandidateInput,
  deps?: TakeoverDeps,
): CandidateDecision {
  const d = deps ?? (_defaultDeps ??= buildDefaultTakeoverDeps());
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

  // Branch 5: retriable (abandoned) — worktreeReset → remoteReconcile → takeover.
  if (cls === 'retriable') {
    return recoverViaResetFromRemote(d, input, adwId, state);
  }

  // phase_timeout: the watchdog killed the agent and handlePhaseTimeout exited the
  // orchestrator (dead PID). Recovery is otherwise unbounded — a phase that wedges
  // deterministically would be auto-resumed every tick forever (money fire). Cap the
  // automatic resumes; escalate to human_gated when the bound is reached (issue #639).
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
    return recoverViaResetFromRemote(d, input, adwId, state);
  }

  // Branch 6 & 7: active (*_running / starting / resuming).
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
    // Dead PID (or post-SIGKILL): proceed with takeover.
    return recoverViaResetFromRemote(d, input, adwId, state);
  }

  // Branch 8: defensive fallthrough — awaiting_merge / human_gated / resumable.
  return { kind: 'spawn_fresh' };
}
