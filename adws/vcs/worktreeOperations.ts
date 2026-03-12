/**
 * Git worktree operations for ADW workflows.
 *
 * Provides functions to manage git worktrees, enabling ADW workflows to run
 * in isolated directories without changing the branch of the main repository.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { log } from '../core';
import { getDefaultBranch } from './branchOperations';

/**
 * Result of checking if a branch is checked out elsewhere.
 */
export interface BranchCheckoutStatus {
  checkedOut: boolean;
  path: string | null;
  isMainRepo: boolean;
}

/**
 * Sanitizes a branch name for use as a directory name.
 * Replaces special characters with dashes.
 *
 * @param branchName - The branch name to sanitize
 * @returns A safe directory name derived from the branch name
 */
function sanitizeBranchName(branchName: string): string {
  return branchName.replace(/[/\\:*?"<>|`]/g, '-');
}

/**
 * Gets the worktrees directory path based on the main repository path.
 * This ensures worktree paths are always relative to the actual git repository,
 * not process.cwd() which may differ when running from different contexts.
 *
 * @param baseRepoPath - Optional base repo path (for external target repos)
 * @returns The absolute path to the worktrees directory
 */
export function getWorktreesDir(baseRepoPath?: string): string {
  const mainRepoPath = baseRepoPath || getMainRepoPath();
  return path.join(mainRepoPath, '.worktrees');
}

/**
 * Gets the path of the main repository (not a worktree).
 * The main repository is the first worktree listed that doesn't contain '.worktrees'.
 *
 * @param cwd - Optional working directory for the git command
 * @returns The absolute path to the main repository
 * @throws Error if unable to determine the main repository path
 */
export function getMainRepoPath(cwd?: string): string {
  try {
    const output = execSync('git worktree list --porcelain', { encoding: 'utf-8', cwd });
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        const wtPath = line.substring('worktree '.length);
        if (!wtPath.includes('.worktrees')) {
          return wtPath;
        }
      }
    }

    throw new Error('Could not find main repository in worktree list');
  } catch (error) {
    throw new Error(`Failed to get main repository path: ${error}`);
  }
}

/**
 * Copies the .env and .env.local files from the main repository to the worktree.
 * This is necessary because these files are in .gitignore and won't be included in worktrees.
 *
 * @param worktreePath - The absolute path to the worktree
 */
export function copyEnvToWorktree(worktreePath: string): void {
  try {
    const mainRepoPath = getMainRepoPath();
    const sourceEnvPath = path.join(mainRepoPath, '.env');
    const destEnvPath = path.join(worktreePath, '.env');

    if (fs.existsSync(sourceEnvPath)) {
      fs.copyFileSync(sourceEnvPath, destEnvPath);
      log(`Copied .env file to worktree at ${worktreePath}`, 'info');
    } else {
      log(`No .env file found in main repository at ${mainRepoPath}, skipping copy`, 'info');
    }

    const sourceEnvLocalPath = path.join(mainRepoPath, '.env.local');
    const destEnvLocalPath = path.join(worktreePath, '.env.local');

    if (fs.existsSync(sourceEnvLocalPath)) {
      fs.copyFileSync(sourceEnvLocalPath, destEnvLocalPath);
      log(`Copied .env.local file to worktree at ${worktreePath}`, 'info');
    } else {
      log(`No .env.local file found in main repository at ${mainRepoPath}, skipping copy`, 'info');
    }
  } catch (error) {
    log(`Warning: Failed to copy .env to worktree: ${error}`, 'info');
  }
}

/**
 * Checks if a branch is currently checked out in the main repository or another worktree.
 *
 * @param branchName - The branch name to check
 * @returns Status object with checkedOut flag, path where it's checked out, and isMainRepo flag
 */
export function isBranchCheckedOutElsewhere(branchName: string, cwd?: string): BranchCheckoutStatus {
  try {
    const output = execSync('git worktree list --porcelain', { encoding: 'utf-8', cwd });
    const lines = output.split('\n');

    let currentWorktreePath: string | null = null;
    let mainRepoPath: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('worktree ')) {
        currentWorktreePath = line.substring('worktree '.length);
        if (!currentWorktreePath.includes('.worktrees') && !mainRepoPath) {
          mainRepoPath = currentWorktreePath;
        }
      }

      if (line.startsWith('branch ') && currentWorktreePath) {
        const branchRef = line.substring('branch '.length);
        const checkedOutBranch = branchRef.replace('refs/heads/', '');

        if (checkedOutBranch === branchName) {
          const isMainRepo = currentWorktreePath === mainRepoPath;
          return {
            checkedOut: true,
            path: currentWorktreePath,
            isMainRepo,
          };
        }
      }
    }

    return { checkedOut: false, path: null, isMainRepo: false };
  } catch {
    return { checkedOut: false, path: null, isMainRepo: false };
  }
}

/**
 * Frees a branch from the main repository by committing/pushing changes
 * and switching to the default branch.
 *
 * @param branchName - The branch name to free from the main repository
 * @throws Error if unable to free the branch
 */
export function freeBranchFromMainRepo(branchName: string, cwd?: string): void {
  const mainRepoPath = getMainRepoPath(cwd);
  log(`Freeing branch '${branchName}' from main repository at ${mainRepoPath}`, 'info');

  try {
    // Check for uncommitted changes
    const status = execSync('git status --porcelain', {
      encoding: 'utf-8',
      cwd: mainRepoPath,
    });

    if (status.trim()) {
      log(`Found uncommitted changes in main repository, auto-committing...`, 'info');
      execSync('git add -A', { stdio: 'pipe', cwd: mainRepoPath });
      execSync('git commit -m "WIP: auto-commit before switching to worktree"', {
        stdio: 'pipe',
        cwd: mainRepoPath,
      });
      log(`Auto-committed changes`, 'success');

      // Push the branch
      try {
        execSync(`git push -u origin "${branchName}"`, { stdio: 'pipe', cwd: mainRepoPath });
        log(`Pushed branch '${branchName}' to origin`, 'success');
      } catch (pushError) {
        log(`Warning: Could not push branch to origin: ${pushError}`, 'info');
      }
    }

    // Switch to default branch and pull latest changes
    const defaultBranch = getDefaultBranch(mainRepoPath);
    execSync(`git checkout "${defaultBranch}" && git pull`, { stdio: 'pipe', cwd: mainRepoPath });
    log(`Switched main repository to '${defaultBranch}' and pulled latest changes`, 'success');
  } catch (error) {
    throw new Error(`Failed to free branch '${branchName}' from main repository: ${error}`);
  }
}

/**
 * Returns the path where a worktree for the given branch should be located.
 *
 * @param branchName - The name of the branch
 * @param baseRepoPath - Optional base repo path (for external target repos)
 * @returns The absolute path to the worktree directory
 */
export function getWorktreePath(branchName: string, baseRepoPath?: string): string {
  const sanitizedName = sanitizeBranchName(branchName);
  return path.join(getWorktreesDir(baseRepoPath), sanitizedName);
}

/**
 * Checks if a worktree already exists for the given branch.
 *
 * @param branchName - The name of the branch to check
 * @returns True if a worktree exists for the branch
 */
export function worktreeExists(branchName: string, cwd?: string): boolean {
  try {
    const output = execSync('git worktree list --porcelain', { encoding: 'utf-8', cwd });
    const worktreePath = getWorktreePath(branchName, cwd);

    // Parse worktree list output to find matching worktree
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        const wtPath = line.substring('worktree '.length);
        if (wtPath === worktreePath) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

// Re-export query functions (backward compatibility)
export {
  listWorktrees,
  findWorktreeForIssue,
  type WorktreeForIssueResult,
} from './worktreeQuery';

// Re-export creation functions
export {
  createWorktree,
  createWorktreeForNewBranch,
  ensureWorktree,
  getWorktreeForBranch,
} from './worktreeCreation';

// Re-export cleanup functions
export {
  killProcessesInDirectory,
  removeWorktree,
  removeWorktreesForIssue,
} from './worktreeCleanup';
