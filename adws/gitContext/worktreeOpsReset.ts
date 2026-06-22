/**
 * Worktree reset operations for GitContext.
 *
 * Pure functions over (basePath, env, log) using only Node built-ins.
 * No imports from adws/* — package purity constraint (PRD stories 19/20).
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { GitContextLogger } from './types';
import { worktreePathFor, exec } from './worktreeOpsHelpers';

function resolveGitDir(wtPath: string, env: NodeJS.ProcessEnv): string {
  try {
    const raw = exec('git rev-parse --git-dir', wtPath, env);
    return path.isAbsolute(raw) ? raw : path.resolve(wtPath, raw);
  } catch (error) {
    throw new Error(`Failed to resolve git dir for worktree ${wtPath}: ${error}`);
  }
}

function abortMerge(wtPath: string, gitDir: string, env: NodeJS.ProcessEnv, log: GitContextLogger): void {
  const mergeHead = path.join(gitDir, 'MERGE_HEAD');
  if (!fs.existsSync(mergeHead)) return;

  try {
    execSync('git merge --abort', { stdio: 'pipe', cwd: wtPath, env });
    log('Aborted in-progress merge', 'info');
    return;
  } catch (error) {
    log(`git merge --abort failed (${error}), removing merge state files`, 'info');
  }

  fs.rmSync(mergeHead, { force: true });
  for (const f of ['MERGE_MSG', 'MERGE_MODE']) {
    const p = path.join(gitDir, f);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
  log('Removed merge state files (fallback)', 'info');
}

function abortRebase(wtPath: string, gitDir: string, env: NodeJS.ProcessEnv, log: GitContextLogger): void {
  const rebaseApply = path.join(gitDir, 'rebase-apply');
  const rebaseMerge = path.join(gitDir, 'rebase-merge');
  if (!fs.existsSync(rebaseApply) && !fs.existsSync(rebaseMerge)) return;

  try {
    execSync('git rebase --abort', { stdio: 'pipe', cwd: wtPath, env });
    log('Aborted in-progress rebase', 'info');
    return;
  } catch (error) {
    log(`git rebase --abort failed (${error}), removing rebase state`, 'info');
  }

  fs.rmSync(rebaseApply, { recursive: true, force: true });
  fs.rmSync(rebaseMerge, { recursive: true, force: true });
  log('Removed rebase state directories (fallback)', 'info');
}

export function resetWorktree(
  basePath: string,
  branch: string,
  env: NodeJS.ProcessEnv,
  log: GitContextLogger,
): void {
  const wtPath = worktreePathFor(basePath, branch);
  const gitDir = resolveGitDir(wtPath, env);

  abortMerge(wtPath, gitDir, env, log);
  abortRebase(wtPath, gitDir, env, log);

  try {
    execSync(`git fetch origin "${branch}"`, { stdio: 'pipe', cwd: wtPath, env });
  } catch (error) {
    throw new Error(`Failed to fetch origin/${branch} in ${wtPath}: ${error}`);
  }

  try {
    execSync(`git reset --hard "origin/${branch}"`, { stdio: 'pipe', cwd: wtPath, env });
  } catch (error) {
    throw new Error(`Failed to reset to origin/${branch} in ${wtPath}: ${error}`);
  }

  try {
    execSync('git clean -fdx', { stdio: 'pipe', cwd: wtPath, env });
  } catch (error) {
    throw new Error(`Failed to clean worktree ${wtPath}: ${error}`);
  }

  log(`Reset ${wtPath} to origin/${branch}`, 'success');
}
