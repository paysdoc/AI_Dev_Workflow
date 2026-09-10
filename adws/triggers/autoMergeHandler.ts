/**
 * Auto-merge utilities for ADW.
 *
 * Provides mergeWithConflictResolution() and its supporting functions,
 * used by adwMerge.tsx to merge PRs with conflict resolution support.
 */

import * as path from 'path';
import { log, MAX_AUTO_MERGE_ATTEMPTS } from '../core';
import type { CodeHost } from '../providers/types';
import { runClaudeAgentWithCommand } from '../agents';
import type { GitContext } from '../gitContext';

const maxAttempts = MAX_AUTO_MERGE_ATTEMPTS;

/**
 * Performs a dry-run merge to detect conflicts without modifying the working tree.
 * Returns true if conflicts are detected, false if the merge would succeed cleanly.
 */
function checkMergeConflicts(baseBranch: string, cwd: string, ctx: GitContext): boolean {
  try {
    ctx.fetchRemote(baseBranch, cwd);
  } catch (error) {
    log(`Failed to fetch origin/${baseBranch}: ${error}`, 'warn');
    return false;
  }

  try {
    ctx.mergeBranch(`origin/${baseBranch}`, cwd, { noCommit: true, noFf: true });
    // Merge succeeded cleanly — abort to restore state and report no conflicts
    ctx.abortMerge(cwd);
    return false;
  } catch {
    // Merge failed — conflicts detected; abort to clean up
    ctx.abortMerge(cwd);
    return true;
  }
}

/**
 * Initiates a real merge (with conflict markers) then invokes the /resolve_conflict agent.
 * Returns true if the agent resolved conflicts and committed successfully.
 */
async function resolveConflictsViaAgent(
  adwId: string,
  specPath: string,
  baseBranch: string,
  logsDir: string,
  cwd: string,
  ctx: GitContext,
): Promise<boolean> {
  // Start the actual merge so conflict markers appear in working tree
  try {
    ctx.fetchRemote(baseBranch, cwd);
    ctx.mergeBranch(`origin/${baseBranch}`, cwd, { noEdit: true });
    // If no conflict, the merge succeeded without needing agent resolution
    log(`Merge from origin/${baseBranch} succeeded cleanly — no agent resolution needed`, 'info');
    return true;
  } catch {
    // Expected when conflicts exist — agent will resolve them
  }

  const outputFile = path.join(logsDir, `resolve-conflict-${Date.now()}.jsonl`);
  log(`Invoking /resolve_conflict agent for adwId=${adwId}, baseBranch=${baseBranch}`, 'info');

  const result = await runClaudeAgentWithCommand(
    '/resolve_conflict',
    [adwId, specPath, baseBranch],
    'conflict-resolver',
    outputFile,
    'sonnet',
    undefined,
    undefined,
    undefined,
    cwd,
    undefined,
    undefined,
    undefined,
    { selfHost: ctx.selfHost, adwId }
  );

  if (result.success) {
    log(`Conflict resolution agent succeeded`, 'success');
  } else {
    log(`Conflict resolution agent failed: ${result.output.substring(0, 200)}`, 'error');
  }

  return result.success;
}

/**
 * Pushes the current branch to origin.
 * Returns true on success, false on failure.
 */
function pushBranchChanges(branchName: string, cwd: string, ctx: GitContext): boolean {
  try {
    ctx.pushBranch(branchName, cwd);
    log(`Pushed branch '${branchName}' to origin`, 'success');
    return true;
  } catch (error) {
    log(`Failed to push branch '${branchName}': ${error}`, 'error');
    return false;
  }
}

/**
 * Returns true when the merge error indicates a conflict (race condition).
 * Checks for known GitHub CLI / git conflict-related error strings.
 */
export function isMergeConflictError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes('conflict') ||
    lower.includes('not mergeable') ||
    lower.includes('cannot be cleanly created') ||
    lower.includes('merge conflict') ||
    lower.includes('dirty') ||
    lower.includes('behind')
  );
}

/**
 * Syncs the local worktree to origin/<headBranch> so subsequent operations
 * reason about the same commit GitHub will merge. Best-effort — failures are
 * logged as warnings and the loop proceeds against the existing worktree.
 */
function syncWorktreeToOriginHead(headBranch: string, cwd: string, ctx: GitContext): void {
  try {
    ctx.fetchAndResetToRemote(headBranch, cwd);
  } catch (error) {
    log(`Failed to sync worktree to origin/${headBranch}: ${error}`, 'warn');
  }
}

/**
 * Core retry loop: resolve conflicts → push → merge.
 * Extracted so it can be reused by both the webhook auto-merge handler and the
 * in-process autoMergePhase.
 *
 * @returns `{ success: true }` on successful merge, or `{ success: false, error }` after
 *          exhausting retries or encountering a non-conflict failure.
 */
export async function mergeWithConflictResolution(
  prNumber: number,
  codeHost: Pick<CodeHost, 'mergePullRequest'>,
  headBranch: string,
  baseBranch: string,
  worktreePath: string,
  adwId: string,
  logsDir: string,
  specPath: string,
  gitContext: GitContext,
): Promise<{ success: boolean; error?: string }> {
  const ctx = gitContext;
  let lastMergeError = '';

  // Pull origin's view of the head branch into the worktree so checkMergeConflicts and resolveConflictsViaAgent reason about the same commit GitHub will merge.
  syncWorktreeToOriginHead(headBranch, worktreePath, ctx);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Auto-merge attempt ${attempt}/${maxAttempts} for PR #${prNumber}`, 'info');

    const hasConflicts = checkMergeConflicts(baseBranch, worktreePath, ctx);

    if (hasConflicts) {
      log(`Merge conflicts detected on attempt ${attempt}, invoking /resolve_conflict`, 'info');
      const resolved = await resolveConflictsViaAgent(adwId, specPath, baseBranch, logsDir, worktreePath, ctx);
      if (!resolved) {
        log(`Conflict resolution failed on attempt ${attempt}, retrying`, 'warn');
        continue;
      }
    }

    const pushed = pushBranchChanges(headBranch, worktreePath, ctx);
    if (!pushed) {
      log(`Push failed on attempt ${attempt}, retrying`, 'warn');
      continue;
    }

    const mergeResult = codeHost.mergePullRequest(prNumber);
    if (mergeResult.success) {
      log(`PR #${prNumber} merged successfully on attempt ${attempt}`, 'success');
      return { success: true };
    }

    lastMergeError = mergeResult.error || '';
    log(`Merge failed on attempt ${attempt}: ${lastMergeError}`, 'warn');

    if (!isMergeConflictError(lastMergeError)) {
      log(`Non-conflict merge failure — stopping retries for PR #${prNumber}`, 'error');
      break;
    }
  }

  return { success: false, error: lastMergeError };
}
