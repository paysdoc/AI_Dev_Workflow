/**
 * Git commit and push operations - committing changes and pushing branches.
 */

import { execSync } from 'child_process';
import { log } from '../core';
import { PROTECTED_BRANCHES } from './branchOperations';

// Re-export PROTECTED_BRANCHES for consumers that import from this module
export { PROTECTED_BRANCHES };

/**
 * Stages all changes and commits with the given message.
 * @param message - The commit message
 * @param cwd - Optional working directory to run the command in
 * @returns True if changes were committed, false if no changes to commit.
 */
export function commitChanges(message: string, cwd?: string): boolean {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8', cwd });

    if (!status.trim()) {
      log('No changes to commit', 'info');
      return false;
    }

    execSync('git add -A', { stdio: 'pipe', cwd });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { stdio: 'pipe', cwd });
    log(`Committed: ${message}`, 'success');
    return true;
  } catch (error) {
    log(`Failed to commit: ${error}`, 'error');
    return false;
  }
}

/**
 * Returns the tree object hash of the current HEAD commit (the worktree's
 * committed state). Used by the build progress gate to detect novel states.
 * @param cwd - Worktree directory to inspect.
 */
export function getHeadTreeHash(cwd?: string): string {
  return execSync('git rev-parse "HEAD^{tree}"', { encoding: 'utf-8', cwd }).trim();
}

/**
 * Returns true when the worktree has staged or unstaged changes.
 * Drives the batch-boundary commit guard (clean tree → skip the /commit agent).
 * @param cwd - Worktree directory to inspect.
 */
export function hasUncommittedChanges(cwd?: string): boolean {
  return execSync('git status --porcelain', { encoding: 'utf-8', cwd }).trim().length > 0;
}

/**
 * Pushes the current branch to origin with upstream tracking.
 * @param branchName - The branch name to push
 * @param cwd - Optional working directory to run the command in
 */
export function pushBranch(branchName: string, cwd?: string): void {
  execSync(`git push -u origin "${branchName}"`, { stdio: 'pipe', cwd });
  log(`Pushed branch to origin`, 'success');
}
