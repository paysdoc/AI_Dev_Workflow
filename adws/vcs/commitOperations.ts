/**
 * Git commit and push operations - committing changes, pushing branches, and cost file management.
 */

import { execSync } from 'child_process';
import { log } from '../core';
import { getCurrentBranch, PROTECTED_BRANCHES } from './branchOperations';

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
 * Pushes the current branch to origin with upstream tracking.
 * @param branchName - The branch name to push
 * @param cwd - Optional working directory to run the command in
 */
export function pushBranch(branchName: string, cwd?: string): void {
  execSync(`git push -u origin "${branchName}"`, { stdio: 'pipe', cwd });
  log(`Pushed branch to origin`, 'success');
}

/**
 * Pulls the latest changes from origin using rebase on the current branch.
 * Intended for callers that need to sync before computing cost data.
 * @param cwd - Optional working directory to run the command in
 */
export function pullLatestCostBranch(cwd?: string): void {
  const branch = getCurrentBranch(cwd);

  if (!branch) {
    throw new Error('Cannot pull latest cost branch: no current branch detected (detached HEAD)');
  }

  execSync(`git fetch origin "${branch}"`, { stdio: 'pipe', cwd });
  execSync(`git rebase --autostash "origin/${branch}"`, { stdio: 'pipe', cwd });
  log(`Pulled latest changes from origin/${branch}`, 'success');
}

export interface CommitCostFilesOptions {
  repoName?: string;
  cwd?: string;
}

/**
 * Stages, commits, and pushes cost-related CSV files.
 * Supports two modes:
 * - Project: repoName provided — stages all changes in projects/<repoName>/
 * - All projects: no repoName — stages all changes under projects/
 *
 * Returns true if changes were committed, false if no changes or on failure.
 */
export function commitAndPushCostFiles(options: CommitCostFilesOptions = {}): boolean {
  const { repoName, cwd } = options;

  try {
    let addPath: string;
    let statusPath: string;
    let commitMessage: string;

    if (repoName) {
      // Project mode
      addPath = `"projects/${repoName}/"`;
      statusPath = `"projects/${repoName}/"`;
      commitMessage = `cost: update cost data for ${repoName}`;
    } else {
      // All projects mode
      addPath = 'projects/';
      statusPath = '"projects/"';
      commitMessage = 'cost: update cost data for all projects';
    }

    const status = execSync(
      `git status --porcelain -- ${statusPath}`,
      { encoding: 'utf-8', cwd },
    ).trim();

    if (!status) {
      log(`No cost CSV changes to commit`, 'info');
      return false;
    }

    execSync(`git add ${addPath}`, { stdio: 'pipe', cwd });
    execSync(
      `git commit -m "${commitMessage}"`,
      { stdio: 'pipe', cwd },
    );

    const branch = getCurrentBranch(cwd);

    if (!branch) {
      throw new Error('Cannot push cost files: no current branch detected (detached HEAD)');
    }

    execSync(`git fetch origin "${branch}"`, { stdio: 'pipe', cwd });
    execSync(`git rebase --autostash "origin/${branch}"`, { stdio: 'pipe', cwd });
    execSync(`git push origin "${branch}"`, { stdio: 'pipe', cwd });

    log(`Committed and pushed cost CSV files`, 'success');
    return true;
  } catch (error) {
    log(`Failed to commit cost CSV files: ${error}`, 'error');
    return false;
  }
}
