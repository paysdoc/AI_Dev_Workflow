/**
 * Worktree remove operations for GitContext.
 *
 * Pure functions over (basePath, env, log) using only Node built-ins.
 * No imports from adws/* — package purity constraint (PRD stories 19/20).
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { GitContextLogger } from './types';
import {
  worktreePathFor,
  deleteLocalBranchInternal,
  killProcessesInDir,
  parseWorktreeBranches,
} from './worktreeOpsHelpers';
import { listWorktrees } from './worktreeOpsQuery';

export function removeWorktree(
  basePath: string,
  branch: string,
  env: NodeJS.ProcessEnv,
  log: GitContextLogger,
): boolean {
  const wtPath = worktreePathFor(basePath, branch);
  const gitOpts = { stdio: 'pipe' as const, cwd: basePath, env };

  try {
    killProcessesInDir(wtPath);
    execSync(`git worktree remove "${wtPath}" --force`, gitOpts);
    log(`Removed worktree for branch '${branch}' at ${wtPath}`, 'success');
    deleteLocalBranchInternal(basePath, branch, env);
    return true;
  } catch {
    if (fs.existsSync(wtPath)) {
      try {
        killProcessesInDir(wtPath);
        execSync('git worktree prune', gitOpts);
        fs.rmSync(wtPath, { recursive: true, force: true });
        log(`Removed orphaned worktree directory at ${wtPath}`, 'info');
        deleteLocalBranchInternal(basePath, branch, env);
        return true;
      } catch (cleanupError) {
        log(`Failed to cleanup worktree at ${wtPath}: ${cleanupError}`, 'error');
        return false;
      }
    }
    log(`Worktree for branch '${branch}' does not exist at ${wtPath}`, 'info');
    return false;
  }
}

export function removeWorktreesForIssue(
  basePath: string,
  issueNumber: number,
  env: NodeJS.ProcessEnv,
  log: GitContextLogger,
): number {
  const worktrees = listWorktrees(basePath, env);
  const pattern = new RegExp(`-issue-${issueNumber}-`);
  const matching = worktrees.filter((wtPath) => pattern.test(path.basename(wtPath)));

  if (matching.length === 0) {
    log(`No worktrees found matching issue #${issueNumber}`, 'info');
    return 0;
  }

  log(`Found ${matching.length} worktree(s) matching issue #${issueNumber}`, 'info');
  const branches = parseWorktreeBranches(basePath, env);
  const gitOpts = { stdio: 'pipe' as const, cwd: basePath, env };
  let removed = 0;

  for (const wtPath of matching) {
    killProcessesInDir(wtPath);
    const branchName = branches.get(wtPath);
    try {
      execSync(`git worktree remove "${wtPath}" --force`, gitOpts);
      log(`Removed worktree at ${wtPath}`, 'success');
      if (branchName) deleteLocalBranchInternal(basePath, branchName, env);
      removed += 1;
    } catch {
      if (fs.existsSync(wtPath)) {
        try {
          fs.rmSync(wtPath, { recursive: true, force: true });
          if (branchName) deleteLocalBranchInternal(basePath, branchName, env);
          removed += 1;
        } catch (e) {
          log(`Failed to cleanup worktree at ${wtPath}: ${e}`, 'error');
        }
      }
    }
  }

  try { execSync('git worktree prune', gitOpts); } catch { /* non-fatal */ }
  log(`Removed ${removed} worktree(s) for issue #${issueNumber}`, 'success');
  return removed;
}
