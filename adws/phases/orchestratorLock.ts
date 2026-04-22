/**
 * Orchestrator-lifetime spawn lock helper.
 *
 * Contract: call acquireOrchestratorLock immediately after initializeWorkflow returns.
 * Call releaseOrchestratorLock in a finally block on normal exit.
 *
 * Abnormal-exit handlers (handleWorkflowError, handleWorkflowDiscarded,
 * handleRateLimitPause) call process.exit synchronously — the finally block
 * does not run on those paths. The lock file remains on disk; the next caller's
 * acquireIssueSpawnLock reclaims it via processLiveness.isProcessLive after
 * detecting a dead PID or a start-time mismatch (PID reuse).
 */

import { acquireIssueSpawnLock, releaseIssueSpawnLock } from '../triggers/spawnGate';
import { getRepoInfo } from '../github/githubApi';
import type { RepoInfo } from '../github/githubApi';
import type { WorkflowConfig } from './workflowInit';
import { startHeartbeat, stopHeartbeat } from '../core/heartbeat';
import { HEARTBEAT_TICK_INTERVAL_MS } from '../core/config';

function resolveRepoInfo(config: WorkflowConfig): RepoInfo {
  if (config.targetRepo) {
    return { owner: config.targetRepo.owner, repo: config.targetRepo.repo };
  }
  return getRepoInfo();
}

export function acquireOrchestratorLock(config: WorkflowConfig): boolean {
  return acquireIssueSpawnLock(resolveRepoInfo(config), config.issueNumber, process.pid);
}

export function releaseOrchestratorLock(config: WorkflowConfig): void {
  releaseIssueSpawnLock(resolveRepoInfo(config), config.issueNumber);
}

/**
 * Runs fn wrapped in the full orchestrator lifecycle:
 * lock-acquire → heartbeat-start → fn → heartbeat-stop → lock-release.
 *
 * Returns false if the lock was not acquired (caller should log a warning and process.exit(0)).
 * Returns true on normal completion (phases ran, lock released).
 *
 * NOTE: if fn calls process.exit() internally (via handleWorkflowError), the finally block
 * does NOT run — the lock stays on disk for staleness reclaim by the next caller.
 */
export async function runWithOrchestratorLifecycle(
  config: WorkflowConfig,
  fn: () => Promise<void>,
): Promise<boolean> {
  if (!acquireIssueSpawnLock(resolveRepoInfo(config), config.issueNumber, process.pid)) {
    return false;
  }
  const heartbeat = startHeartbeat(config.adwId, HEARTBEAT_TICK_INTERVAL_MS);
  try {
    await fn();
  } finally {
    stopHeartbeat(heartbeat);
    releaseIssueSpawnLock(resolveRepoInfo(config), config.issueNumber);
  }
  return true;
}

/**
 * Lower-level variant for orchestrators that don't use WorkflowConfig (adwMerge).
 * Same semantics as runWithOrchestratorLifecycle.
 */
export async function runWithRawOrchestratorLifecycle(
  repoInfo: RepoInfo,
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
