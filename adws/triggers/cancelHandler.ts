import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/logger';
import { AGENTS_STATE_DIR } from '../core/config';
import { extractAdwIdFromComment } from '../core/workflowCommentParsing';
import { findOrchestratorStatePath, isProcessAlive } from '../core/stateHelpers';
import { clearIssueComments } from '../adwClearComments';
import type { LaunchBoundary } from '../core';

/** Mutable dedup sets passed in from the cron trigger so cancelled issues skip this cycle. */
export interface MutableProcessedSets {
  spawns: Set<number>;
}

/**
 * @param cwd - Working directory for worktree operations (undefined = local repo)
 * @param processedSets - Cron dedup sets to clean; omit on webhook path
 * @returns true on completion (errors are logged but do not throw)
 */
export function handleCancelDirective(
  issueNumber: number,
  comments: readonly { body: string }[],
  boundary: LaunchBoundary,
  cwd?: string,
  processedSets?: MutableProcessedSets,
): boolean {
  log(`Cancel directive on issue #${issueNumber}: starting full cleanup sequence`);

  const adwIds = comments
    .map(c => extractAdwIdFromComment(c.body))
    .filter((id): id is string => id !== null);
  const uniqueAdwIds = [...new Set(adwIds)];
  log(`Cancel #${issueNumber}: found ${uniqueAdwIds.length} adwId(s): ${uniqueAdwIds.join(', ') || 'none'}`);

  for (const adwId of uniqueAdwIds) {
    killOrchestratorProcess(adwId, issueNumber);
  }

  try {
    log(`Cancel #${issueNumber}: removing worktrees`);
    // boundary.gitContext.selfHost (targetRepo === null) equals today's !cwd: cancelCwd is the
    // target-repo workspace path when targetRepo is set, undefined otherwise.
    boundary.gitContext.removeWorktreesForIssue(issueNumber);
  } catch (error) {
    log(`Cancel #${issueNumber}: worktree removal error (continuing): ${error}`, 'warn');
  }

  for (const adwId of uniqueAdwIds) {
    const agentDir = path.join(AGENTS_STATE_DIR, adwId);
    try {
      log(`Cancel #${issueNumber}: deleting state dir ${agentDir}`);
      fs.rmSync(agentDir, { recursive: true, force: true });
    } catch (error) {
      log(`Cancel #${issueNumber}: failed to delete ${agentDir} (continuing): ${error}`, 'warn');
    }
  }

  try {
    log(`Cancel #${issueNumber}: clearing GitHub comments`);
    const result = clearIssueComments(issueNumber, boundary.providers.issueTracker);
    log(`Cancel #${issueNumber}: cleared ${result.deleted}/${result.total} comment(s)`);
  } catch (error) {
    log(`Cancel #${issueNumber}: comment clearing error (continuing): ${error}`, 'warn');
  }

  // Remove from cron dedup sets so issue re-spawns next cycle
  if (processedSets !== undefined) {
    processedSets.spawns.delete(issueNumber);
    log(`Cancel #${issueNumber}: removed from processedSets`);
  }

  log(`Cancel #${issueNumber}: cleanup complete`, 'success');
  return true;
}

function killOrchestratorProcess(adwId: string, issueNumber: number): void {
  const statePath = findOrchestratorStatePath(adwId);
  if (!statePath) {
    log(`Cancel #${issueNumber}: no orchestrator state found for adwId=${adwId}, skipping kill`);
    return;
  }

  const stateFile = path.join(statePath, 'state.json');
  let pid: number | undefined;
  try {
    const raw = fs.readFileSync(stateFile, 'utf-8');
    const state = JSON.parse(raw) as Record<string, unknown>;
    pid = typeof state.pid === 'number' ? state.pid : undefined;
  } catch {
    log(`Cancel #${issueNumber}: could not read state file for adwId=${adwId}, skipping kill`);
    return;
  }

  if (pid === undefined) {
    log(`Cancel #${issueNumber}: no PID in state file for adwId=${adwId}, skipping kill`);
    return;
  }

  if (!isProcessAlive(pid)) {
    log(`Cancel #${issueNumber}: process ${pid} for adwId=${adwId} already dead`);
    return;
  }

  try {
    log(`Cancel #${issueNumber}: sending SIGTERM to pid=${pid} (adwId=${adwId})`);
    process.kill(pid, 'SIGTERM');
  } catch {
    log(`Cancel #${issueNumber}: SIGTERM failed for pid=${pid}, may already be dead`);
    return;
  }

  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    // spin — intentionally short, cancel is a rare manual operation
  }

  if (isProcessAlive(pid)) {
    try {
      log(`Cancel #${issueNumber}: process ${pid} still alive, sending SIGKILL`);
      process.kill(pid, 'SIGKILL');
    } catch {
      log(`Cancel #${issueNumber}: SIGKILL failed for pid=${pid}`, 'warn');
    }
  }
}
