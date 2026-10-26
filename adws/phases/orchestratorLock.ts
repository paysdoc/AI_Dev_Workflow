/**
 * initializeWorkflow and initializePRReviewWorkflow take the issue's spawn lock (claimIssueSpawnLock) before they write
 * any state, and exit 0 when it is refused. runWithOrchestratorLifecycle then runs under that lock, takes it itself only
 * for a config that came through neither, and releases it in a finally block on normal exit.
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
import { log } from '../core/logger';
import { getProcessStartTime } from '../core/processLiveness';
import type { AgentIdentifier } from '../types/agentTypes';

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

export interface SpawnLockClaim {
  readonly repoId: RepoIdentifier;
  readonly issueNumber: number;
  /** Null only for a manual launch that has not resolved its adwId yet; its refusal reaches the console alone, and it counts no resume. */
  readonly adwId: string | null;
  readonly orchestratorName: AgentIdentifier;
}

function spawnLockRefusal(issueNumber: number, holderPid?: number): string {
  return `Spawn lock for issue #${issueNumber} is held by pid ${holderPid ?? 'unknown'}; exiting without running a phase`;
}

function recordSpawnLockRefusal({ repoId, issueNumber, adwId, orchestratorName }: SpawnLockClaim): void {
  const message = spawnLockRefusal(issueNumber, readSpawnLockRecord(repoId, issueNumber)?.pid);
  if (adwId === null) {
    log(message, 'warn');
    return;
  }
  AgentStateManager.appendLog(AgentStateManager.initializeState(adwId, orchestratorName), message);
}

// Only the launch that holds the lock resumes the workflow, so this is where a resume is counted, once.
function countResumeAttempt(adwId: string): void {
  const state = AgentStateManager.readTopLevelState(adwId);
  if (state?.workflowStage !== 'phase_timeout') return;
  AgentStateManager.writeTopLevelState(adwId, { resumeAttempts: (state.resumeAttempts ?? 0) + 1 });
}

/** True only for the record acquireIssueSpawnLock writes for this process, so a reused pid does not count. */
function holdsIssueSpawnLock(repoId: RepoIdentifier, issueNumber: number): boolean {
  const record = readSpawnLockRecord(repoId, issueNumber);
  return record?.pid === process.pid && record.pidStartedAt === (getProcessStartTime(process.pid) ?? '');
}

/**
 * Takes the issue's spawn lock under this process, retrying per `wait` (default: no retry), and counts the resume when
 * it holds the lock of a workflow stopped at phase_timeout. Called before the launch writes any state, so a launch
 * refused here has written only the refusal to its execution log: the holder's pid, stage and resume budget stay as they were.
 */
export async function claimIssueSpawnLock(claim: SpawnLockClaim, wait: LockWait = SINGLE_ATTEMPT): Promise<boolean> {
  const { repoId, issueNumber, adwId } = claim;
  const acquired = acquireIssueSpawnLock(repoId, issueNumber, process.pid) || await retryAcquire(repoId, issueNumber, wait);
  if (!acquired) {
    recordSpawnLockRefusal(claim);
    return false;
  }
  if (adwId !== null) countResumeAttempt(adwId);
  return true;
}

/**
 * Runs fn wrapped in the full orchestrator lifecycle:
 * lock-acquire → heartbeat-start → fn → heartbeat-stop → lock-release.
 *
 * Returns false if the lock was not acquired (caller should log a warning and process.exit(0));
 * the refusal is also written to the orchestrator's execution log, naming the holder.
 * A refused lock is retried per `wait` (default: no retry) before the refusal is logged.
 * A lock this process already holds, as both initialisers leave it, counts as acquired.
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
  const acquired = holdsIssueSpawnLock(repoId, config.issueNumber)
    || acquireIssueSpawnLock(repoId, config.issueNumber, process.pid)
    || await retryAcquire(repoId, config.issueNumber, wait);
  if (!acquired) {
    const holder = readSpawnLockRecord(repoId, config.issueNumber);
    AgentStateManager.appendLog(config.orchestratorStatePath, spawnLockRefusal(config.issueNumber, holder?.pid));
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
