/**
 * Worktree create/ensure operations for GitContext.
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
  isBranchCheckedOutElsewhere,
  freeBranchFromMainRepo,
  copyEnvToWorktree,
} from './worktreeOpsHelpers';
import { getWorktreeForBranch } from './worktreeOpsQuery';

function resolveBranchExists(basePath: string, branch: string, env: NodeJS.ProcessEnv): boolean {
  const gitOpts = { stdio: 'pipe' as const, cwd: basePath, env };
  try {
    execSync(`git rev-parse --verify "${branch}"`, gitOpts);
    return true;
  } catch { /* not local */ }
  try {
    execSync(`git rev-parse --verify "origin/${branch}"`, gitOpts);
    return true;
  } catch { /* not remote */ }
  try {
    execSync(`git fetch origin "${branch}"`, gitOpts);
    execSync(`git rev-parse --verify "origin/${branch}"`, gitOpts);
    return true;
  } catch {
    return false;
  }
}

export function createWorktree(
  basePath: string,
  branch: string,
  baseBranch: string | undefined,
  env: NodeJS.ProcessEnv,
  log: GitContextLogger,
): string {
  if (!branch?.trim()) throw new Error('branchName must be a non-empty string');

  const wtPath = worktreePathFor(basePath, branch);
  const wtDir = path.join(basePath, '.worktrees');
  const gitOpts = { stdio: 'pipe' as const, cwd: basePath, env };

  if (!fs.existsSync(wtDir)) fs.mkdirSync(wtDir, { recursive: true });

  const branchExists = resolveBranchExists(basePath, branch, env);

  try {
    if (branchExists) {
      const status = isBranchCheckedOutElsewhere(basePath, branch, env);
      if (status.checkedOut) {
        if (status.isMainRepo) {
          freeBranchFromMainRepo(basePath, branch, env, log);
        } else if (status.path) {
          log(`Branch '${branch}' already checked out at ${status.path}, reusing`, 'info');
          return status.path;
        }
      }
      execSync(`git worktree add "${wtPath}" "${branch}"`, gitOpts);
      log(`Created worktree for existing branch '${branch}' at ${wtPath}`, 'success');
    } else if (baseBranch) {
      try { execSync(`git fetch origin "${baseBranch}"`, gitOpts); } catch { /* non-fatal */ }
      execSync(`git worktree add -b "${branch}" "${wtPath}" "origin/${baseBranch}"`, gitOpts);
      log(`Created worktree with new branch '${branch}' from 'origin/${baseBranch}' at ${wtPath}`, 'success');
    } else {
      throw new Error(`Branch '${branch}' does not exist and no base branch was provided`);
    }
    return wtPath;
  } catch (error) {
    throw new Error(`Failed to create worktree for branch '${branch}': ${error}`);
  }
}

export function createWorktreeForNewBranch(
  basePath: string,
  branch: string,
  baseBranch: string | undefined,
  env: NodeJS.ProcessEnv,
  log: GitContextLogger,
): string {
  if (!branch?.trim()) throw new Error('branchName must be a non-empty string');

  const wtPath = worktreePathFor(basePath, branch);
  const wtDir = path.join(basePath, '.worktrees');
  const gitOpts = { stdio: 'pipe' as const, cwd: basePath, env };

  if (!fs.existsSync(wtDir)) fs.mkdirSync(wtDir, { recursive: true });

  try {
    let base = 'HEAD';
    if (baseBranch) {
      try { execSync(`git fetch origin "${baseBranch}"`, gitOpts); } catch { /* non-fatal */ }
      base = `origin/${baseBranch}`;
    }
    execSync(`git worktree add -b "${branch}" "${wtPath}" "${base}"`, gitOpts);
    log(`Created worktree with new branch '${branch}' at ${wtPath}`, 'success');
    return wtPath;
  } catch (error) {
    throw new Error(`Failed to create worktree with new branch '${branch}': ${error}`);
  }
}

export function ensureWorktree(
  basePath: string,
  branch: string,
  baseBranch: string | undefined,
  env: NodeJS.ProcessEnv,
  log: GitContextLogger,
): string {
  const existing = getWorktreeForBranch(basePath, branch, env);
  if (existing) {
    log(`Worktree for '${branch}' already exists at ${existing}, reusing`, 'info');
    copyEnvToWorktree(basePath, existing, log);
    return existing;
  }
  const wtPath = createWorktree(basePath, branch, baseBranch, env, log);
  copyEnvToWorktree(basePath, wtPath, log);
  return wtPath;
}
