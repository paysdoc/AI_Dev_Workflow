/**
 * Cancel directive handler for ADW (AI Developer Workflow).
 *
 * Implements the full scorched-earth reset sequence triggered by a `## Cancel`
 * comment directive: kills orchestrator processes, removes worktrees, deletes
 * agent state directories, clears GitHub comments, and removes the issue from
 * cron dedup sets.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core/logger';
import { AGENTS_STATE_DIR } from '../core/config';
import { extractAdwIdFromComment } from '../core/workflowCommentParsing';
import { findOrchestratorStatePath, isProcessAlive } from '../core/stateHelpers';
import { removeWorktreesForIssue } from '../vcs/worktreeCleanup';
import { clearIssueComments } from '../adwClearComments';
import type { RepoInfo } from '../github/githubApi';

/** Mutable dedup sets passed in from the cron trigger so cancelled issues skip this cycle. */
export interface MutableProcessedSets {
  spawns: Set<number>;
}

/**
 * Performs the full cancel sequence for an issue:
 * 1. Extract all adwIds from comments
 * 2. Kill orchestrator processes (SIGTERM → SIGKILL)
 * 3. Remove worktrees and local branches
 * 4. Delete agents/{adwId}/ state directories
 * 5. Clear GitHub comments
 * 6. Remove issue from cron dedup sets (if provided)
 *
 * @param issueNumber - The GitHub issue number to cancel
 * @param comments - All comments on the issue (used to extract adwIds)
 * @param repoInfo - Repository identity for the GitHub API calls
 * @param cwd - Working directory for worktree operations (undefined = local repo)
 * @param processedSets - Cron dedup sets to clean; omit on webhook path
 * @returns true on completion (errors are logged but do not throw)
 */
export function handleCancelDirective(
  issueNumber: number,
  comments: readonly { body: string }[],
  repoInfo: RepoInfo,
  cwd?: string,
  processedSets?: MutableProcessedSets,
): boolean {
  log(`Cancel directive on issue #${issueNumber}: starting full cleanup sequence`);

  // 1. Extract all adwIds from comments
  const adwIds = comments
    .map(c => extractAdwIdFromComment(c.body))
    .filter((id): id is string => id !== null);
  const uniqueAdwIds = [...new Set(adwIds)];
  log(`Cancel #${issueNumber}: found ${uniqueAdwIds.length} adwId(s): ${uniqueAdwIds.join(', ') || 'none'}`);

  // 2. Kill orchestrator processes
  for (const adwId of uniqueAdwIds) {
    killOrchestratorProcess(adwId, issueNumber);
  }

  // 3. Remove worktrees and local branches
  try {
    log(`Cancel #${issueNumber}: removing worktrees`);
    removeWorktreesForIssue(issueNumber, cwd);
  } catch (error) {
    log(`Cancel #${issueNumber}: worktree removal error (continuing): ${error}`, 'warn');
  }

  // 4. Delete agent state directories
  for (const adwId of uniqueAdwIds) {
    const agentDir = path.join(AGENTS_STATE_DIR, adwId);
    try {
      log(`Cancel #${issueNumber}: deleting state dir ${agentDir}`);
      fs.rmSync(agentDir, { recursive: true, force: true });
    } catch (error) {
      log(`Cancel #${issueNumber}: failed to delete ${agentDir} (continuing): ${error}`, 'warn');
    }
  }

  // 5. Clear GitHub comments
  try {
    log(`Cancel #${issueNumber}: clearing GitHub comments`);
    const result = clearIssueComments(issueNumber, repoInfo);
    log(`Cancel #${issueNumber}: cleared ${result.deleted}/${result.total} comment(s)`);
  } catch (error) {
    log(`Cancel #${issueNumber}: comment clearing error (continuing): ${error}`, 'warn');
  }

  // 6. Remove from cron dedup sets so issue re-spawns next cycle
  if (processedSets !== undefined) {
    processedSets.spawns.delete(issueNumber);
    log(`Cancel #${issueNumber}: removed from processedSets`);
  }

  log(`Cancel #${issueNumber}: cleanup complete`, 'success');
  return true;
}

/**
 * Reads the orchestrator PID for an adwId and kills the process with SIGTERM,
 * falling back to SIGKILL if the process is still alive after a short wait.
 */
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

  // Brief synchronous wait then SIGKILL if still alive
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
