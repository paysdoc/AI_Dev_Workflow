/**
 * Four recovery paths, decided by decideRetryAction:
 *   merge_blocked  → awaiting_merge  (clears mergeRetryCount)
 *   human_gated    → phase_timeout   (re-arms resumeAttempts to 0)
 *   review_failed  → phase_timeout   (re-arms resumeAttempts to 0; review re-runs)
 *   paused         → drops any pause-queue entry for the adwId, respawns the
 *                     orchestrator resolveResumeSpawn resolves from top-level
 *                     state, and posts the resumed comment
 *
 * No-op for paused_auth (the auth queue scanner owns recovery once login is
 * restored), for every active stage (starting, resuming, any *_running — a
 * live orchestrator must never be duplicated), and for any other stage.
 */

import { log } from '../core/logger';
import { AgentStateManager } from '../core/agentState';
import { extractLatestAdwId } from './cronStageResolver';
import { classifyStageString } from '../core/stageClassifier';
import { readPauseQueue, removeFromPauseQueue, type PausedWorkflow } from '../core/pauseQueue';
import { acquireIssueSpawnLock, releaseIssueSpawnLock } from './spawnGate';
import { spawnDetached } from './webhookGatekeeper';
import { postIssueStageComment } from '../phases/phaseCommentHelpers';
import { resolveResumeSpawn } from '../core/resolveResumeSpawn';
import type { AgentState } from '../types/agentTypes';
import type { LaunchBoundary } from '../core';
import type { WorkflowStage } from '../types/workflowTypes';
import type { WorkflowContext } from '../forge/workflowCommentsIssue';

export type RetryAction =
  | { readonly kind: 'reset_merge_blocked' }
  | { readonly kind: 'rearm_phase_timeout'; readonly from: 'human_gated' | 'review_failed' }
  | { readonly kind: 'resume_paused' }
  | { readonly kind: 'noop'; readonly reason: 'no_state' | 'paused_auth' | 'active' | 'not_retriable' };

/** Total and pure: no I/O, no logging. */
export function decideRetryAction(stage: string | undefined): RetryAction {
  if (!stage) return { kind: 'noop', reason: 'no_state' };
  if (stage === 'merge_blocked') return { kind: 'reset_merge_blocked' };
  if (stage === 'human_gated') return { kind: 'rearm_phase_timeout', from: 'human_gated' };
  if (stage === 'review_failed') return { kind: 'rearm_phase_timeout', from: 'review_failed' };
  if (stage === 'paused') return { kind: 'resume_paused' };
  if (stage === 'paused_auth') return { kind: 'noop', reason: 'paused_auth' };
  if (classifyStageString(stage) === 'active') return { kind: 'noop', reason: 'active' };
  return { kind: 'noop', reason: 'not_retriable' };
}

export interface RetryHandlerDeps {
  readTopLevelState: (adwId: string) => AgentState | null;
  writeTopLevelState: (adwId: string, state: Partial<AgentState>) => void;
  findPauseQueueEntry: (adwId: string) => PausedWorkflow | null;
  removeFromPauseQueue: (adwId: string) => void;
  acquireIssueSpawnLock: (issueNumber: number) => boolean;
  releaseIssueSpawnLock: (issueNumber: number) => void;
  spawnDetached: (command: string, args: string[]) => void;
  postStageComment: (issueNumber: number, stage: WorkflowStage, ctx: WorkflowContext) => void;
  targetRepoArgs: readonly string[];
}

/** Binds the spawn lock and comment poster to the boundary's own repoId/providers — never a cwd-derived identity. */
export function buildRetryHandlerDeps(boundary: LaunchBoundary, targetRepoArgs: readonly string[]): RetryHandlerDeps {
  return {
    readTopLevelState: (id) => AgentStateManager.readTopLevelState(id),
    writeTopLevelState: (id, state) => AgentStateManager.writeTopLevelState(id, state),
    findPauseQueueEntry: (id) => readPauseQueue().find((entry) => entry.adwId === id) ?? null,
    removeFromPauseQueue: (id) => removeFromPauseQueue(id),
    acquireIssueSpawnLock: (issueNumber) => acquireIssueSpawnLock(boundary.repoId, issueNumber, process.pid),
    releaseIssueSpawnLock: (issueNumber) => releaseIssueSpawnLock(boundary.repoId, issueNumber),
    spawnDetached: (command, args) => spawnDetached(command, args),
    postStageComment: (issueNumber, stage, ctx) => postIssueStageComment(boundary.providers, issueNumber, stage, ctx),
    targetRepoArgs,
  };
}

/**
 * Removes the queue entry before spawning so the scanner cannot resume the
 * same adwId a second time. Writes no top-level state: the child rewrites its
 * own stage at init, exactly as it does after a scanner resume.
 */
function resumePausedWorkflow(issueNumber: number, adwId: string, state: AgentState, deps: RetryHandlerDeps): boolean {
  if (state.issueNumber !== issueNumber) {
    log(`Retry #${issueNumber}: top-level state for adwId=${adwId} belongs to issue #${state.issueNumber ?? 'none'} not #${issueNumber}; ignoring`, 'warn');
    return false;
  }

  if (!deps.acquireIssueSpawnLock(issueNumber)) {
    log(`Retry #${issueNumber}: spawn lock held for issue #${issueNumber} — a live orchestrator or an in-flight resume owns it; ignoring`, 'warn');
    return false;
  }

  const entry = deps.findPauseQueueEntry(adwId);
  deps.removeFromPauseQueue(adwId);
  log(`Retry #${issueNumber}: adwId=${adwId} ${entry ? 'evicted its pause-queue entry' : 'had no pause-queue entry (already evicted)'} before respawn`);

  const { script, args } = resolveResumeSpawn(state);
  try {
    deps.spawnDetached('bunx', ['tsx', script, ...args, ...deps.targetRepoArgs]);
  } catch (err) {
    log(`Retry #${issueNumber}: spawn failed for adwId=${adwId} (${script}): ${err}`, 'error');
    return false;
  } finally {
    deps.releaseIssueSpawnLock(issueNumber);
  }

  deps.postStageComment(issueNumber, 'resumed', { issueNumber, adwId, pausedAtPhase: entry?.pausedAtPhase });
  log(`Retry #${issueNumber}: resumed adwId=${adwId} → ${script}`, 'success');
  return true;
}

function logRetryNoop(issueNumber: number, adwId: string, stage: string | undefined, reason: 'no_state' | 'paused_auth' | 'active' | 'not_retriable'): void {
  if (reason === 'paused_auth') {
    log(`Retry #${issueNumber}: adwId=${adwId} is paused_auth; the auth queue scanner resumes it automatically once login is restored, ignoring`);
    return;
  }
  if (reason === 'active') {
    log(`Retry #${issueNumber}: adwId=${adwId} is active (stage=${stage}); a running orchestrator cannot be duplicated, ignoring`);
    return;
  }
  log(`Retry #${issueNumber}: adwId=${adwId} not human-gated (stage=${stage ?? 'none'}), ignoring`);
}

/** Returns true only when a reset, re-arm, or resume was performed. */
export function handleRetryDirective(
  issueNumber: number,
  comments: readonly { body: string }[],
  deps: RetryHandlerDeps,
): boolean {
  const adwId = extractLatestAdwId([...comments]);
  if (!adwId) {
    log(`Retry directive on issue #${issueNumber}: no adw-id in comments, ignoring`, 'warn');
    return false;
  }

  const state = deps.readTopLevelState(adwId);
  if (!state) {
    log(`Retry #${issueNumber}: adwId=${adwId} not human-gated (stage=none), ignoring`);
    return false;
  }

  const action = decideRetryAction(state.workflowStage);

  switch (action.kind) {
    case 'reset_merge_blocked':
      deps.writeTopLevelState(adwId, { workflowStage: 'awaiting_merge', mergeRetryCount: 0 });
      log(`Retry #${issueNumber}: reset adwId=${adwId} merge_blocked → awaiting_merge, cleared retry counter`, 'success');
      return true;

    case 'rearm_phase_timeout':
      deps.writeTopLevelState(adwId, { workflowStage: 'phase_timeout', resumeAttempts: 0 });
      log(`Retry #${issueNumber}: re-armed adwId=${adwId} ${action.from} → phase_timeout, cleared resume counter`, 'success');
      return true;

    case 'resume_paused':
      return resumePausedWorkflow(issueNumber, adwId, state, deps);

    case 'noop':
      logRetryNoop(issueNumber, adwId, state.workflowStage, action.reason);
      return false;
  }
}
