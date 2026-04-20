/**
 * Deterministic worktree reset module.
 *
 * Returns an arbitrary worktree to an exact copy of `origin/<branch>`, discarding
 * ALL unpushed local work: staged changes, unstaged changes, untracked files,
 * ignored files, unpushed local commits, and any partial merge or rebase state.
 *
 * This is a takeover primitive — not a merge helper. Call it before resuming work
 * on an issue after a dead or wedged orchestrator.
 */

import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import * as path from 'path';
import { log } from '../core';

function resolveGitDir(worktreePath: string): string {
  try {
    const raw = execSync('git rev-parse --git-dir', {
      encoding: 'utf-8',
      stdio: 'pipe',
      cwd: worktreePath,
    }).trim();
    return path.isAbsolute(raw) ? raw : path.resolve(worktreePath, raw);
  } catch (error) {
    throw new Error(`Failed to resolve git dir for worktree ${worktreePath}: ${error}`);
  }
}

function abortInProgressMerge(worktreePath: string, gitDir: string): void {
  const mergeHead = path.join(gitDir, 'MERGE_HEAD');
  if (!existsSync(mergeHead)) return;

  try {
    execSync('git merge --abort', { stdio: 'pipe', cwd: worktreePath });
    log('Aborted in-progress merge', 'info');
    return;
  } catch (error) {
    log(`git merge --abort failed (${error}), removing merge state files`, 'info');
  }

  rmSync(mergeHead, { force: true });
  const mergeMsg = path.join(gitDir, 'MERGE_MSG');
  const mergeMode = path.join(gitDir, 'MERGE_MODE');
  if (existsSync(mergeMsg)) rmSync(mergeMsg, { force: true });
  if (existsSync(mergeMode)) rmSync(mergeMode, { force: true });
  log('Removed merge state files (fallback)', 'info');
}

function abortInProgressRebase(worktreePath: string, gitDir: string): void {
  const rebaseApply = path.join(gitDir, 'rebase-apply');
  const rebaseMerge = path.join(gitDir, 'rebase-merge');
  if (!existsSync(rebaseApply) && !existsSync(rebaseMerge)) return;

  try {
    execSync('git rebase --abort', { stdio: 'pipe', cwd: worktreePath });
    log('Aborted in-progress rebase', 'info');
    return;
  } catch (error) {
    log(`git rebase --abort failed (${error}), removing rebase state directories`, 'info');
  }

  rmSync(rebaseApply, { recursive: true, force: true });
  rmSync(rebaseMerge, { recursive: true, force: true });
  log('Removed rebase state directories (fallback)', 'info');
}

/**
 * Resets the worktree at `worktreePath` to exactly match `origin/<branch>`.
 *
 * WARNING: All unpushed local commits, staged changes, unstaged changes,
 * untracked files, ignored files, and any partial merge or rebase state in the
 * target worktree are permanently discarded. There is no recovery path.
 *
 * @param worktreePath - Absolute path to the worktree to reset
 * @param branch - The remote branch name to reset to (origin/<branch>)
 */
export function resetWorktreeToRemote(worktreePath: string, branch: string): void {
  const gitDir = resolveGitDir(worktreePath);

  abortInProgressMerge(worktreePath, gitDir);
  abortInProgressRebase(worktreePath, gitDir);

  try {
    execSync(`git fetch origin "${branch}"`, { stdio: 'pipe', cwd: worktreePath });
  } catch (error) {
    throw new Error(`Failed to fetch origin/${branch} in ${worktreePath}: ${error}`);
  }

  try {
    execSync(`git reset --hard "origin/${branch}"`, { stdio: 'pipe', cwd: worktreePath });
  } catch (error) {
    throw new Error(`Failed to reset to origin/${branch} in ${worktreePath}: ${error}`);
  }

  try {
    execSync('git clean -fdx', { stdio: 'pipe', cwd: worktreePath });
  } catch (error) {
    throw new Error(`Failed to clean worktree ${worktreePath}: ${error}`);
  }

  log(`Reset ${worktreePath} to origin/${branch}`, 'success');
}
