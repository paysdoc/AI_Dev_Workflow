/**
 * Package-private worktree remove ops for GitContext.
 * Injects runner, fs, and killProcesses for testability.
 */

import * as path from 'path';
import { log } from '../core';
import { killProcessesInDirectory } from './processCleanup';

type Runner = (command: string, cwd: string) => string;

interface FsDeps {
  existsSync: (p: string) => boolean;
  rmSync: (p: string, opts?: { force?: boolean; recursive?: boolean }) => void;
}

function parseWorktreeBranches(run: Runner, baseCwd: string): Map<string, string> {
  const output = run('git worktree list --porcelain', baseCwd);
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
 * Removes a worktree for the given branch. Falls back to prune + rmSync on failure.
 */
function removeWorktree(
  run: Runner,
  fs: FsDeps,
  worktreePath: string,
  branchName: string,
  deleteLocalBranchFn: (branch: string) => boolean,
  baseCwd: string,
  killProcs: (dir: string) => void = killProcessesInDirectory,
): boolean {
  killProcs(worktreePath);
  try {
    run(`git worktree remove "${worktreePath}" --force`, baseCwd);
    log(`Removed worktree for branch '${branchName}' at ${worktreePath}`, 'success');
    deleteLocalBranchFn(branchName);
    return true;
  } catch {
    if (fs.existsSync(worktreePath)) {
      try {
        killProcs(worktreePath);
        run('git worktree prune', baseCwd);
        fs.rmSync(worktreePath, { recursive: true, force: true });
        log(`Removed orphaned worktree directory at ${worktreePath}`, 'info');
        deleteLocalBranchFn(branchName);
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
 * Removes all worktrees matching the given issue number.
 */
function removeWorktreesForIssue(
  run: Runner,
  fs: FsDeps,
  baseCwd: string,
  issueNumber: number,
  deleteLocalBranchFn: (branch: string) => boolean,
  killProcs: (dir: string) => void = killProcessesInDirectory,
): number {
  try {
    const output = run('git worktree list --porcelain', baseCwd);
    const worktrees: string[] = [];
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        const wtPath = line.substring('worktree '.length);
        if (wtPath.includes('.worktrees')) worktrees.push(wtPath);
      }
    }

    const pattern = new RegExp(`-issue-${issueNumber}-`);
    const matching = worktrees.filter((wtPath) => pattern.test(path.basename(wtPath)));

    if (matching.length === 0) {
      log(`No worktrees found matching issue #${issueNumber}`, 'info');
      return 0;
    }

    log(`Found ${matching.length} worktree(s) matching issue #${issueNumber}`, 'info');
    const worktreeBranches = parseWorktreeBranches(run, baseCwd);
    let removedCount = 0;

    for (const wtPath of matching) {
      killProcs(wtPath);
      const branchName = worktreeBranches.get(wtPath);
      try {
        run(`git worktree remove "${wtPath}" --force`, baseCwd);
        log(`Removed worktree at ${wtPath}`, 'success');
        if (branchName) deleteLocalBranchFn(branchName);
        removedCount += 1;
      } catch (error) {
        if (fs.existsSync(wtPath)) {
          try {
            fs.rmSync(wtPath, { recursive: true, force: true });
            log(`Removed orphaned worktree directory at ${wtPath}`, 'info');
            if (branchName) deleteLocalBranchFn(branchName);
            removedCount += 1;
          } catch (cleanupError) {
            log(`Failed to cleanup worktree directory at ${wtPath}: ${cleanupError}`, 'error');
          }
        } else {
          log(`Failed to remove worktree at ${wtPath}: ${error}`, 'error');
        }
      }
    }

    try { run('git worktree prune', baseCwd); } catch (pruneError) {
      log(`Failed to prune worktrees: ${pruneError}`, 'error');
    }

    log(`Removed ${removedCount} worktree(s) for issue #${issueNumber}`, 'success');
    return removedCount;
  } catch {
    return 0;
  }
}

export const worktreeRemoveOps = { removeWorktree, removeWorktreesForIssue };
