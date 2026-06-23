/**
 * Package-private takeover-reset orchestration for GitContext.
 * Injects both the runner and fs functions for testability.
 */

import * as path from 'path';

type Runner = (command: string, cwd: string) => string;

interface FsDeps {
  existsSync: (p: string) => boolean;
  rmSync: (p: string, opts?: { force?: boolean; recursive?: boolean }) => void;
}

function resolveGitDir(run: Runner, worktreePath: string): string {
  const raw = run('git rev-parse --git-dir', worktreePath);
  return path.isAbsolute(raw) ? raw : path.resolve(worktreePath, raw);
}

function abortMerge(run: Runner, fs: FsDeps, worktreePath: string, gitDir: string): void {
  const mergeHead = path.join(gitDir, 'MERGE_HEAD');
  if (!fs.existsSync(mergeHead)) return;
  try {
    run('git merge --abort', worktreePath);
    return;
  } catch {
    // fallback to fs removal
  }
  fs.rmSync(mergeHead, { force: true });
  const mergeMsg = path.join(gitDir, 'MERGE_MSG');
  const mergeMode = path.join(gitDir, 'MERGE_MODE');
  if (fs.existsSync(mergeMsg)) fs.rmSync(mergeMsg, { force: true });
  if (fs.existsSync(mergeMode)) fs.rmSync(mergeMode, { force: true });
}

function abortRebase(run: Runner, fs: FsDeps, worktreePath: string, gitDir: string): void {
  const rebaseApply = path.join(gitDir, 'rebase-apply');
  const rebaseMerge = path.join(gitDir, 'rebase-merge');
  if (!fs.existsSync(rebaseApply) && !fs.existsSync(rebaseMerge)) return;
  try {
    run('git rebase --abort', worktreePath);
    return;
  } catch {
    // fallback to fs removal
  }
  fs.rmSync(rebaseApply, { recursive: true, force: true });
  fs.rmSync(rebaseMerge, { recursive: true, force: true });
}

function resetWorktree(run: Runner, fs: FsDeps, worktreePath: string, branch: string): void {
  const gitDir = resolveGitDir(run, worktreePath);
  abortMerge(run, fs, worktreePath, gitDir);
  abortRebase(run, fs, worktreePath, gitDir);

  try {
    run(`git fetch origin "${branch}"`, worktreePath);
  } catch (error) {
    throw new Error(`Failed to fetch origin/${branch} in ${worktreePath}: ${error}`);
  }
  try {
    run(`git reset --hard "origin/${branch}"`, worktreePath);
  } catch (error) {
    throw new Error(`Failed to reset to origin/${branch} in ${worktreePath}: ${error}`);
  }
  try {
    run('git clean -fdx', worktreePath);
  } catch (error) {
    throw new Error(`Failed to clean worktree ${worktreePath}: ${error}`);
  }
}

export const worktreeResetOps = { resetWorktree };
