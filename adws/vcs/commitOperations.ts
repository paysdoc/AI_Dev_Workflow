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

type ExecError = { stderr?: unknown; stdout?: unknown; message?: unknown };

/**
 * Returns true when the error is a `--force-with-lease` refusal: the remote
 * branch advanced to a commit ADW never had, so the lease comparison failed.
 * Git writes the rejection to stderr with one of two marker strings depending
 * on whether `--force-if-includes` or plain `--force-with-lease` refused it.
 */
function isLeaseRejection(error: unknown): boolean {
  const e = error as ExecError;
  const text = [e.stderr, e.stdout, e.message]
    .map((v) => (v == null ? '' : String(v)))
    .join('\n');
  return text.includes('stale info') || text.includes('remote ref updated since checkout');
}

/**
 * Pushes the current branch to origin with upstream tracking.
 *
 * Uses `--force-with-lease --force-if-includes` so a branch ADW itself
 * rewrote (rebase / squash / amend) lands on the remote while a branch
 * the remote advanced to an unseen commit is refused safely.
 *
 * A fetch is attempted first so the lease compares against the true remote
 * tip. A failed fetch is tolerated — a first push has no remote ref to fetch.
 *
 * On a genuine lease refusal (remote moved underneath ADW) a distinct,
 * actionable error is thrown so the PR phase surfaces a terminal failure
 * rather than resuming `pr_creating` into the same push indefinitely.
 *
 * @param branchName - The branch name to push
 * @param cwd - Optional working directory to run the command in
 */
export function pushBranch(branchName: string, cwd?: string): void {
  // Refresh the remote-tracking ref so the lease compares against the true
  // current remote. A first push has no remote ref to fetch — swallow error.
  try {
    execSync(`git fetch origin "${branchName}"`, { stdio: 'pipe', cwd });
  } catch {
    // no remote ref yet — first push, proceed
  }

  try {
    execSync(
      `git push --force-with-lease --force-if-includes -u origin "${branchName}"`,
      { stdio: 'pipe', cwd },
    );
  } catch (error) {
    if (isLeaseRejection(error)) {
      const e = error as ExecError;
      throw new Error(
        `force-with-lease push rejected for branch "${branchName}": the remote was moved ` +
          `underneath ADW — the origin has commits ADW has never seen and must not be ` +
          `auto-resumed into the same push. ` +
          `Manual remedy: git fetch && git log origin/${branchName} — if the local tip ` +
          `is correct, push manually with: git push --force-with-lease origin ${branchName}. ` +
          `Original error: ${String(e.stderr ?? e.message ?? error)}`,
      );
    }
    throw error;
  }

  log(`Pushed branch to origin`, 'success');
}
