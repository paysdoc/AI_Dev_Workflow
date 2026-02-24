/**
 * Git worktree creation functions.
 *
 * Provides functions to create and ensure git worktrees for ADW workflows.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import { log } from '../core';
import {
  getWorktreePath,
  getWorktreesDir,
  isBranchCheckedOutElsewhere,
  freeBranchFromMainRepo,
  copyEnvToWorktree,
} from './worktreeOperations';

/**
 * Gets the existing worktree path for a branch if it exists.
 *
 * @param branchName - The name of the branch to look up
 * @returns The worktree path if it exists, null otherwise
 */
export function getWorktreeForBranch(branchName: string, baseRepoPath?: string): string | null {
  try {
    const output = execSync('git worktree list --porcelain', { encoding: 'utf-8', cwd: baseRepoPath });
    const expectedWorktreePath = getWorktreePath(branchName, baseRepoPath);

    // Parse worktree list output to find matching worktree
    const lines = output.split('\n');
    let currentWorktreePath: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('worktree ')) {
        currentWorktreePath = line.substring('worktree '.length);
        // Check if this is the expected path
        if (currentWorktreePath === expectedWorktreePath) {
          return expectedWorktreePath;
        }
      }

      // Also check by branch name to find worktrees at unexpected paths
      if (line.startsWith('branch ') && currentWorktreePath) {
        const branchRef = line.substring('branch '.length);
        const checkedOutBranch = branchRef.replace('refs/heads/', '');

        if (checkedOutBranch === branchName && currentWorktreePath.includes('.worktrees')) {
          log(
            `Found worktree for branch '${branchName}' at unexpected path ${currentWorktreePath}`,
            'info'
          );
          return currentWorktreePath;
        }
      }
    }

    // Also check if the directory exists even if git doesn't track it
    if (fs.existsSync(expectedWorktreePath)) {
      log(`Found orphaned worktree directory at ${expectedWorktreePath}, will attempt to reuse`, 'info');
      return expectedWorktreePath;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Creates a new worktree for the given branch.
 * If baseBranch is provided, creates the worktree starting from that branch.
 *
 * @param branchName - The name of the branch to checkout in the worktree
 * @param baseBranch - Optional base branch to create the worktree from
 * @returns The absolute path to the created worktree
 * @throws Error if worktree creation fails
 */
export function createWorktree(branchName: string, baseBranch?: string, baseRepoPath?: string): string {
  if (!branchName || !branchName.trim()) {
    throw new Error('branchName must be a non-empty string');
  }

  const worktreePath = getWorktreePath(branchName, baseRepoPath);
  const worktreesDir = getWorktreesDir(baseRepoPath);

  // Ensure worktrees directory exists
  if (!fs.existsSync(worktreesDir)) {
    fs.mkdirSync(worktreesDir, { recursive: true });
  }

  const gitOpts = baseRepoPath ? { stdio: 'pipe' as const, cwd: baseRepoPath } : { stdio: 'pipe' as const };

  try {
    // Check if the branch exists remotely or locally
    let branchExists = false;
    try {
      execSync(`git rev-parse --verify "${branchName}"`, gitOpts);
      branchExists = true;
    } catch {
      // Branch doesn't exist locally, check remote
      try {
        execSync(`git rev-parse --verify "origin/${branchName}"`, gitOpts);
        branchExists = true;
      } catch {
        branchExists = false;
      }
    }

    if (branchExists) {
      // Check if branch is checked out elsewhere before attempting worktree add
      const checkoutStatus = isBranchCheckedOutElsewhere(branchName);

      if (checkoutStatus.checkedOut) {
        if (checkoutStatus.isMainRepo) {
          // Branch is checked out in main repo, free it first
          log(`Branch '${branchName}' is checked out in main repository, freeing it...`, 'info');
          freeBranchFromMainRepo(branchName);
        } else if (checkoutStatus.path) {
          // Branch is checked out in another worktree, reuse that worktree
          log(
            `Branch '${branchName}' is already checked out at ${checkoutStatus.path}, reusing existing worktree`,
            'info'
          );
          return checkoutStatus.path;
        }
      }

      // Branch exists, create worktree for existing branch
      execSync(`git worktree add "${worktreePath}" "${branchName}"`, gitOpts);
      log(`Created worktree for existing branch '${branchName}' at ${worktreePath}`, 'success');
    } else if (baseBranch) {
      // Branch doesn't exist, create worktree with new branch from base
      execSync(`git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`, gitOpts);
      log(`Created worktree with new branch '${branchName}' from '${baseBranch}' at ${worktreePath}`, 'success');
    } else {
      // No base branch provided and branch doesn't exist
      throw new Error(`Branch '${branchName}' does not exist and no base branch was provided`);
    }

    return worktreePath;
  } catch (error) {
    throw new Error(`Failed to create worktree for branch '${branchName}': ${error}`);
  }
}

/**
 * Creates a worktree and a new branch in one operation.
 * The new branch is created from the current HEAD of the repository.
 *
 * @param branchName - The name of the new branch to create
 * @param baseBranch - Optional base branch to create the new branch from (defaults to HEAD)
 * @returns The absolute path to the created worktree
 * @throws Error if worktree creation fails
 */
export function createWorktreeForNewBranch(branchName: string, baseBranch?: string): string {
  if (!branchName || !branchName.trim()) {
    throw new Error('branchName must be a non-empty string');
  }

  const worktreePath = getWorktreePath(branchName);
  const worktreesDir = getWorktreesDir();

  // Ensure worktrees directory exists
  if (!fs.existsSync(worktreesDir)) {
    fs.mkdirSync(worktreesDir, { recursive: true });
  }

  try {
    const base = baseBranch || 'HEAD';
    execSync(`git worktree add -b "${branchName}" "${worktreePath}" "${base}"`, { stdio: 'pipe' });
    log(`Created worktree with new branch '${branchName}' at ${worktreePath}`, 'success');
    return worktreePath;
  } catch (error) {
    throw new Error(`Failed to create worktree with new branch '${branchName}': ${error}`);
  }
}

/**
 * Ensures a worktree exists for the given branch, creating it if necessary.
 * If the worktree already exists, logs a warning and returns the existing path.
 *
 * @param branchName - The name of the branch
 * @param baseBranch - Optional base branch to create the worktree from (for new branches)
 * @returns The absolute path to the worktree
 */
export function ensureWorktree(branchName: string, baseBranch?: string, baseRepoPath?: string): string {
  const existingPath = getWorktreeForBranch(branchName, baseRepoPath);

  if (existingPath) {
    log(`Worktree for branch '${branchName}' already exists at ${existingPath}, reusing`, 'info');
    copyEnvToWorktree(existingPath);
    return existingPath;
  }

  log(`Worktree for branch '${branchName}' does not exist, creating new worktree...`, 'info');
  const worktreePath = createWorktree(branchName, baseBranch, baseRepoPath);
  copyEnvToWorktree(worktreePath);
  return worktreePath;
}
