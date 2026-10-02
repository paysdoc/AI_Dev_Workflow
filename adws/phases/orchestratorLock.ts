/**
 * Contract: call acquireOrchestratorLock immediately after initializeWorkflow returns.
 * Call releaseOrchestratorLock in a finally block on normal exit.
 *
 * Abnormal-exit handlers (handleWorkflowError, handleWorkflowDiscarded,
 * handleRateLimitPause) call process.exit synchronously — the finally block
 * does not run on those paths. The lock file remains on disk; the next caller's
 * acquireIssueSpawnLock reclaims it via processLiveness.isProcessLive after
 * detecting a dead PID or a start-time mismatch (PID reuse).
 */

import { acquireIssueSpawnLock, releaseIssueSpawnLock, readSpawnLockRecord } from '../triggers/spawnGate';
import type { RepoIdentifier } from '@paysdoc/devplatform';
import type { WorkflowConfig } from './workflowInit';
import { resolveWorkflowRepoId } from './workflowRepoIdentity';
import { startHeartbeat, stopHeartbeat } from '../core/heartbeat';
import { AgentStateManager } from '../core/agentState';
import { HEARTBEAT_TICK_INTERVAL_MS } from '../core/config';

export function acquireOrchestratorLock(config: WorkflowConfig): boolean {
  return acquireIssueSpawnLock(resolveWorkflowRepoId(config), config.issueNumber, process.pid);
}

export function releaseOrchestratorLock(config: WorkflowConfig): void {
  releaseIssueSpawnLock(resolveWorkflowRepoId(config), config.issueNumber);
}

export interface LockWait {
  readonly attempts: number;
  readonly retryMs: number;
  /** Injectable so tests need no real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const SINGLE_ATTEMPT: LockWait = { attempts: 1, retryMs: 0 };

/**
 * The cron dispatches the merge orchestrator for an awaiting_merge issue on every tick, and it holds the issue's
 * spawn lock while it reads the PR, so a PR review on that issue waits it out instead of dropping the review.
 * 30 s stays well inside HEARTBEAT_STALE_THRESHOLD_MS: no heartbeat runs until the lock is held.
 */
export const MERGE_POLL_LOCK_WAIT: LockWait = { attempts: 15, retryMs: 2_000 };

const sleepFor = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The attempts after the first, which the caller has already made. */
async function retryAcquire(repoId: RepoIdentifier, issueNumber: number, wait: LockWait): Promise<boolean> {
  for (let attempt = 2; attempt <= wait.attempts; attempt++) {
    await (wait.sleep ?? sleepFor)(wait.retryMs);
    if (acquireIssueSpawnLock(repoId, issueNumber, process.pid)) return true;
  }
  return false;
}

/**
 * Runs fn wrapped in the full orchestrator lifecycle:
 * lock-acquire → heartbeat-start → fn → heartbeat-stop → lock-release.
 *
 * Returns false if the lock was not acquired (caller should log a warning and process.exit(0));
 * the refusal is also written to the orchestrator's execution log, naming the holder.
 * A refused lock is retried per `wait` (default: no retry) before the refusal is logged.
 * Returns true on normal completion (phases ran, lock released).
 *
 * NOTE: if fn calls process.exit() internally (via handleWorkflowError), the finally block
 * does NOT run — the lock stays on disk for staleness reclaim by the next caller.
 */
export async function runWithOrchestratorLifecycle(
  config: WorkflowConfig,
  fn: () => Promise<void>,
  wait: LockWait = SINGLE_ATTEMPT,
): Promise<boolean> {
  const repoId = resolveWorkflowRepoId(config);
  const acquired = acquireIssueSpawnLock(repoId, config.issueNumber, process.pid) || await retryAcquire(repoId, config.issueNumber, wait);
  if (!acquired) {
    const holder = readSpawnLockRecord(repoId, config.issueNumber);
    AgentStateManager.appendLog(
      config.orchestratorStatePath,
      `Spawn lock for issue #${config.issueNumber} is held by pid ${holder?.pid ?? 'unknown'}; exiting without running a phase`,
    );
    return false;
  }
  const heartbeat = startHeartbeat(config.adwId, HEARTBEAT_TICK_INTERVAL_MS);
  try {
    await fn();
  } finally {
    stopHeartbeat(heartbeat);
    releaseIssueSpawnLock(resolveWorkflowRepoId(config), config.issueNumber);
  }
  return true;
}

/**
 * Lower-level variant for orchestrators that don't use WorkflowConfig (adwMerge).
 * Same semantics as runWithOrchestratorLifecycle.
 */
export async function runWithRawOrchestratorLifecycle(
  repoInfo: RepoIdentifier,
  issueNumber: number,
  adwId: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  if (!acquireIssueSpawnLock(repoInfo, issueNumber, process.pid)) {
    return false;
  }
  const heartbeat = startHeartbeat(adwId, HEARTBEAT_TICK_INTERVAL_MS);
  try {
    await fn();
  } finally {
    stopHeartbeat(heartbeat);
    releaseIssueSpawnLock(repoInfo, issueNumber);
  }
  return true;
}
