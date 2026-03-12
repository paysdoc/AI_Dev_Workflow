/**
 * Git worktree cleanup functions.
 *
 * Provides functions to remove git worktrees for ADW workflows.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { log } from '../core';
import { getWorktreePath } from './worktreeOperations';
import { listWorktrees } from './worktreeQuery';
import { deleteLocalBranch } from './branchOperations';

/**
 * Kills processes that have open files in the given directory.
 * Uses `lsof` to discover PIDs, sends SIGTERM first (graceful),
 * then SIGKILL if processes survive after 500ms.
 * Filters out the current process PID to avoid self-termination.
 *
 * @param directoryPath - The absolute path to scan for running processes
 */
export function killProcessesInDirectory(directoryPath: string): void {
  try {
    const output = execSync(`lsof +D "${directoryPath}" -t`, { encoding: 'utf-8' });
    const pids = output
      .split('\n')
      .map((line) => parseInt(line.trim(), 10))
      .filter((pid) => !isNaN(pid) && pid !== process.pid);

    if (pids.length === 0) {
      return;
    }

    log(`Found ${pids.length} process(es) in ${directoryPath}, sending SIGTERM`, 'info');
    pids.forEach((pid) => {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Process may have already exited
      }
    });

    // Wait 500ms then check for survivors
    execSync('sleep 0.5', { stdio: 'pipe' });

    const survivors = pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });

    if (survivors.length > 0) {
      log(`${survivors.length} process(es) still running, sending SIGKILL`, 'info');
      survivors.forEach((pid) => {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process may have already exited
        }
      });
    }
  } catch {
    // lsof not available or no processes found — proceed silently
  }
}

/**
 * Removes a worktree for the given branch.
 *
 * @param branchName - The name of the branch whose worktree should be removed
 * @param cwd - Optional working directory for git commands (for external target repos)
 * @returns True if the worktree was successfully removed, false if it didn't exist
 */
export function removeWorktree(branchName: string, cwd?: string): boolean {
  const worktreePath = getWorktreePath(branchName, cwd);

  try {
    killProcessesInDirectory(worktreePath);
    execSync(`git worktree remove "${worktreePath}" --force`, { stdio: 'pipe', cwd });
    log(`Removed worktree for branch '${branchName}' at ${worktreePath}`, 'success');
    deleteLocalBranch(branchName, cwd);
    return true;
  } catch (_error) {
    if (fs.existsSync(worktreePath)) {
      try {
        killProcessesInDirectory(worktreePath);
        execSync('git worktree prune', { stdio: 'pipe', cwd });
        fs.rmSync(worktreePath, { recursive: true, force: true });
        log(`Removed orphaned worktree directory at ${worktreePath}`, 'info');
        deleteLocalBranch(branchName, cwd);
        return true;
      } catch (cleanupError) {
        log(`Failed to cleanup worktree directory at ${worktreePath}: ${cleanupError}`, 'error');
        return false;
      }
    }

    log(`Worktree for branch '${branchName}' does not exist at ${worktreePath}`, 'info');
    return false;
  }
}

/**
 * Parses `git worktree list --porcelain` output to extract path-to-branch mappings.
 * Only includes worktrees under `.worktrees/`.
 *
 * @param cwd - Optional working directory for the git command (for external target repos)
 */
function parseWorktreeBranches(cwd?: string): Map<string, string> {
  const output = execSync('git worktree list --porcelain', { encoding: 'utf-8', cwd });
  const lines = output.split('\n');
  const result = new Map<string, string>();

  let currentPath: string | null = null;

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      currentPath = line.substring('worktree '.length);
    } else if (line.startsWith('branch ') && currentPath?.includes('.worktrees/')) {
      const branchName = line.substring('branch '.length).replace('refs/heads/', '');
      result.set(currentPath, branchName);
    } else if (line === '') {
      currentPath = null;
    }
  }

  return result;
}

/**
 * Removes all worktrees matching the given issue number.
 *
 * @param issueNumber - The GitHub issue number whose worktrees should be removed
 * @param cwd - Optional working directory for git commands (for external target repos)
 * @returns The number of worktrees successfully removed
 */
export function removeWorktreesForIssue(issueNumber: number, cwd?: string): number {
  const worktrees = listWorktrees(cwd);
  const pattern = new RegExp(`-issue-${issueNumber}-`);
  const matching = worktrees.filter((wtPath) => pattern.test(path.basename(wtPath)));

  if (matching.length === 0) {
    log(`No worktrees found matching issue #${issueNumber}`, 'info');
    return 0;
  }

  log(`Found ${matching.length} worktree(s) matching issue #${issueNumber}`, 'info');

  const worktreeBranches = parseWorktreeBranches(cwd);
  let removedCount = 0;

  matching.forEach((wtPath) => {
    killProcessesInDirectory(wtPath);
    const branchName = worktreeBranches.get(wtPath);

    try {
      log(`Removing worktree at ${wtPath}`, 'info');
      execSync(`git worktree remove "${wtPath}" --force`, { stdio: 'pipe', cwd });
      log(`Removed worktree at ${wtPath}`, 'success');
      if (branchName) {
        deleteLocalBranch(branchName, cwd);
      }
      removedCount += 1;
    } catch (error) {
      if (fs.existsSync(wtPath)) {
        try {
          fs.rmSync(wtPath, { recursive: true, force: true });
          log(`Removed orphaned worktree directory at ${wtPath}`, 'info');
          if (branchName) {
            deleteLocalBranch(branchName, cwd);
          }
          removedCount += 1;
        } catch (cleanupError) {
          log(`Failed to cleanup worktree directory at ${wtPath}: ${cleanupError}`, 'error');
        }
      } else {
        log(`Failed to remove worktree at ${wtPath}: ${error}`, 'error');
      }
    }
  });

  try {
    execSync('git worktree prune', { stdio: 'pipe', cwd });
  } catch (pruneError) {
    log(`Failed to prune worktrees: ${pruneError}`, 'error');
  }

  log(`Removed ${removedCount} worktree(s) for issue #${issueNumber}`, 'success');
  return removedCount;
}
