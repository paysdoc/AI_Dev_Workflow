/**
 * Auto-merge utilities for ADW.
 *
 * Provides mergeWithConflictResolution() and its supporting functions,
 * used by adwMerge.tsx to merge PRs with conflict resolution support.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { log, MAX_AUTO_MERGE_ATTEMPTS } from '../core';
import { mergePR, type RepoInfo } from '../github';
import { runClaudeAgentWithCommand } from '../agents';

const maxAttempts = MAX_AUTO_MERGE_ATTEMPTS;

/**
 * Performs a dry-run merge to detect conflicts without modifying the working tree.
 * Returns true if conflicts are detected, false if the merge would succeed cleanly.
 */
function checkMergeConflicts(baseBranch: string, cwd: string): boolean {
  try {
    execSync(`git fetch origin "${baseBranch}"`, { stdio: 'pipe', cwd });
  } catch (error) {
    log(`Failed to fetch origin/${baseBranch}: ${error}`, 'warn');
    return false;
  }

  try {
    execSync(`git merge --no-commit --no-ff "origin/${baseBranch}"`, { stdio: 'pipe', cwd });
    // Merge succeeded cleanly — abort to restore state and report no conflicts
    try { execSync('git merge --abort', { stdio: 'pipe', cwd }); } catch { /* already clean */ }
    return false;
  } catch {
    // Merge failed — conflicts detected; abort to clean up
    try { execSync('git merge --abort', { stdio: 'pipe', cwd }); } catch { /* ignore */ }
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
  cwd: string
): Promise<boolean> {
  // Start the actual merge so conflict markers appear in working tree
  try {
    execSync(`git fetch origin "${baseBranch}"`, { stdio: 'pipe', cwd });
    execSync(`git merge "origin/${baseBranch}" --no-edit`, { stdio: 'pipe', cwd });
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
    cwd
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
function pushBranchChanges(branchName: string, cwd: string): boolean {
  try {
    execSync(`git push origin "${branchName}"`, { stdio: 'pipe', cwd });
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
function isMergeConflictError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes('conflict') ||
    lower.includes('not mergeable') ||
    lower.includes('merge conflict') ||
    lower.includes('dirty') ||
    lower.includes('behind')
  );
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
  repoInfo: RepoInfo,
  headBranch: string,
  baseBranch: string,
  worktreePath: string,
  adwId: string,
  logsDir: string,
  specPath: string,
): Promise<{ success: boolean; error?: string }> {
  let lastMergeError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Auto-merge attempt ${attempt}/${maxAttempts} for PR #${prNumber}`, 'info');

    const hasConflicts = checkMergeConflicts(baseBranch, worktreePath);

    if (hasConflicts) {
      log(`Merge conflicts detected on attempt ${attempt}, invoking /resolve_conflict`, 'info');
      const resolved = await resolveConflictsViaAgent(adwId, specPath, baseBranch, logsDir, worktreePath);
      if (!resolved) {
        log(`Conflict resolution failed on attempt ${attempt}, retrying`, 'warn');
        continue;
      }
    }

    const pushed = pushBranchChanges(headBranch, worktreePath);
    if (!pushed) {
      log(`Push failed on attempt ${attempt}, retrying`, 'warn');
      continue;
    }

    const mergeResult = mergePR(prNumber, repoInfo);
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

