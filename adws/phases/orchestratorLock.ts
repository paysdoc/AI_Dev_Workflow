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
