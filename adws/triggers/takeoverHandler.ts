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
import type { RepoInfo } from '../github/githubApi';
import type { AgentState } from '../types/agentTypes';
import type { WorkflowStage } from '../types/workflowTypes';

export type CandidateDecision =
  | { readonly kind: 'spawn_fresh' }
  | { readonly kind: 'take_over_adwId'; readonly adwId: string; readonly derivedStage: WorkflowStage }
  | { readonly kind: 'defer_live_holder'; readonly holderPid: number }
  | { readonly kind: 'skip_terminal'; readonly adwId: string; readonly terminalStage: 'completed' | 'discarded' | 'paused' };

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
  };
}

function isRunningStage(stage: string): boolean {
  return (
    stage.endsWith('_running') ||
    stage === 'starting' ||
    stage === 'resuming'
  );
}

let _defaultDeps: TakeoverDeps | null = null;

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

  // Branch 3: terminal stages — completed / discarded.
  if (stage === 'completed' || stage === 'discarded') {
    releaseLock();
    return { kind: 'skip_terminal', adwId, terminalStage: stage as 'completed' | 'discarded' };
  }

  // Branch 4: paused — scanPauseQueue is the sole resumer; no-op here.
  if (stage === 'paused') {
    releaseLock();
    return { kind: 'skip_terminal', adwId, terminalStage: 'paused' };
  }

  // Branch 5: abandoned — worktreeReset → remoteReconcile → takeover.
  if (stage === 'abandoned') {
    if (state.branchName) {
      const wtPath = d.getWorktreePath(state.branchName);
      d.resetWorktree(wtPath, state.branchName);
    }
    const derivedStage = d.deriveStageFromRemote(issueNumber, adwId, repoInfo);
    return { kind: 'take_over_adwId', adwId, derivedStage };
  }

  // Branch 6 & 7: *_running / starting / resuming.
  if (isRunningStage(stage)) {
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
    if (state.branchName) {
      const wtPath = d.getWorktreePath(state.branchName);
      d.resetWorktree(wtPath, state.branchName);
    }
    const derivedStage = d.deriveStageFromRemote(issueNumber, adwId, repoInfo);
    return { kind: 'take_over_adwId', adwId, derivedStage };
  }

  // Branch 8: defensive fallthrough for unknown stages.
  return { kind: 'spawn_fresh' };
}
