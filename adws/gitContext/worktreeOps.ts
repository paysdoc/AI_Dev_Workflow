/**
 * Internal worktree operations for GitContext.
 *
 * Pure functions over (basePath, env, log) using only Node built-ins.
 * No imports from adws/* — package purity constraint (PRD stories 19/20).
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { GitContextLogger, WorktreeForIssueResult } from './types';

const PROTECTED_BRANCHES = ['main', 'master', 'develop'];

const noop: GitContextLogger = () => {};

function sanitizeBranchName(branch: string): string {
  return branch.replace(/[/\\:*?"<>|`]/g, '-');
}

export function worktreePathFor(basePath: string, branch: string): string {
  return path.join(basePath, '.worktrees', sanitizeBranchName(branch));
}

function exec(cmd: string, cwd: string, env: NodeJS.ProcessEnv): string {
  return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', cwd, env }).trim();
}

function getDefaultBranchFromGit(basePath: string, env: NodeJS.ProcessEnv): string {
  try {
    const ref = exec('git symbolic-ref refs/remotes/origin/HEAD', basePath, env);
    return ref.replace('refs/remotes/origin/', '');
  } catch {
    return 'main';
  }
}

function deleteLocalBranchInternal(basePath: string, branchName: string, env: NodeJS.ProcessEnv): void {
  if (PROTECTED_BRANCHES.includes(branchName)) return;
  try {
    execSync(`git branch -D "${branchName}"`, { stdio: 'pipe', cwd: basePath, env });
  } catch {
    // Branch may not exist locally — non-fatal
  }
}

function killProcessesInDir(dirPath: string): void {
  try {
    const output = execSync(`lsof +D "${dirPath}" -t`, { encoding: 'utf-8' });
    const pids = output
      .split('\n')
      .map((line) => parseInt(line.trim(), 10))
      .filter((pid) => !isNaN(pid) && pid !== process.pid);

    if (pids.length === 0) return;

    pids.forEach((pid) => {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ }
    });

    execSync('sleep 0.5', { stdio: 'pipe' });

    pids.filter((pid) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    }).forEach((pid) => {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
    });
  } catch {
    // lsof not available or no processes — proceed silently
  }
}

interface CheckoutStatus {
  checkedOut: boolean;
  path: string | null;
  isMainRepo: boolean;
}

function isBranchCheckedOutElsewhere(basePath: string, branch: string, env: NodeJS.ProcessEnv): CheckoutStatus {
  try {
    const output = exec('git worktree list --porcelain', basePath, env);
    const lines = output.split('\n');

    let currentPath: string | null = null;
    let mainRepoPath: string | null = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentPath = line.substring('worktree '.length);
        if (!currentPath.includes('.worktrees') && !mainRepoPath) {
          mainRepoPath = currentPath;
        }
      } else if (line.startsWith('branch ') && currentPath) {
        const checkedOut = line.substring('branch '.length).replace('refs/heads/', '');
        if (checkedOut === branch) {
          return { checkedOut: true, path: currentPath, isMainRepo: currentPath === mainRepoPath };
        }
      }
    }

    return { checkedOut: false, path: null, isMainRepo: false };
  } catch {
    return { checkedOut: false, path: null, isMainRepo: false };
  }
}

function freeBranchFromMainRepo(basePath: string, branch: string, env: NodeJS.ProcessEnv, log: GitContextLogger): void {
  log(`Freeing branch '${branch}' from main repository at ${basePath}`, 'info');

  try {
    const status = exec('git status --porcelain', basePath, env);

    if (status.trim()) {
      log('Found uncommitted changes in main repository, auto-committing...', 'info');
      execSync('git add -A', { stdio: 'pipe', cwd: basePath, env });
      execSync('git commit -m "WIP: auto-commit before switching to worktree"', { stdio: 'pipe', cwd: basePath, env });
      try {
        execSync(`git push -u origin "${branch}"`, { stdio: 'pipe', cwd: basePath, env });
      } catch {
        log('Warning: could not push branch to origin', 'warn');
      }
    }

    const defaultBranch = getDefaultBranchFromGit(basePath, env);
    execSync(`git checkout "${defaultBranch}"`, { stdio: 'pipe', cwd: basePath, env });
    log(`Switched main repository to '${defaultBranch}'`, 'success');
  } catch (error) {
    throw new Error(`Failed to free branch '${branch}' from main repository: ${error}`);
  }
}

// ── create / ensure ──────────────────────────────────────────────────────────

export function getWorktreeForBranch(basePath: string, branch: string, env: NodeJS.ProcessEnv): string | null {
  try {
    const expected = worktreePathFor(basePath, branch);
    const output = exec('git worktree list --porcelain', basePath, env);
    const lines = output.split('\n');

    let currentPath: string | null = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentPath = line.substring('worktree '.length);
        if (currentPath === expected) return expected;
      } else if (line.startsWith('branch ') && currentPath?.includes('.worktrees')) {
        const checkedOut = line.substring('branch '.length).replace('refs/heads/', '');
        if (checkedOut === branch) return currentPath;
      }
    }

    if (fs.existsSync(expected)) return expected;
    return null;
  } catch {
    return null;
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

  let branchExists = false;
  try {
    execSync(`git rev-parse --verify "${branch}"`, gitOpts);
    branchExists = true;
  } catch {
    try {
      execSync(`git rev-parse --verify "origin/${branch}"`, gitOpts);
      branchExists = true;
    } catch {
      try {
        execSync(`git fetch origin "${branch}"`, gitOpts);
        execSync(`git rev-parse --verify "origin/${branch}"`, gitOpts);
        branchExists = true;
      } catch {
        branchExists = false;
      }
    }
  }

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

// ── query ────────────────────────────────────────────────────────────────────

export function listWorktrees(basePath: string, env: NodeJS.ProcessEnv): string[] {
  try {
    const output = exec('git worktree list --porcelain', basePath, env);
    const worktrees: string[] = [];
    for (const line of output.split('\n')) {
      if (line.startsWith('worktree ')) {
        const wtPath = line.substring('worktree '.length);
        if (wtPath.includes('.worktrees')) worktrees.push(wtPath);
      }
    }
    return worktrees;
  } catch {
    return [];
  }
}

export function worktreeExists(basePath: string, branch: string, env: NodeJS.ProcessEnv): boolean {
  return getWorktreeForBranch(basePath, branch, env) !== null;
}

export function findWorktreeForIssue(
  basePath: string,
  prefix: string,
  aliases: string[],
  issueNumber: number,
  env: NodeJS.ProcessEnv,
  log: GitContextLogger,
): WorktreeForIssueResult | null {
  try {
    const allPrefixes = [prefix, ...aliases];
    const pattern = new RegExp('^(' + allPrefixes.join('|') + ')-issue-' + issueNumber + '-');
    const output = exec('git worktree list --porcelain', basePath, env);
    const lines = output.split('\n');

    let currentPath: string | null = null;
    let currentBranch: string | null = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentPath = line.substring('worktree '.length);
        currentBranch = null;
      } else if (line.startsWith('branch ')) {
        currentBranch = line.substring('branch '.length).replace('refs/heads/', '');
      } else if (line === '' && currentPath?.includes('.worktrees/') && currentBranch) {
        if (pattern.test(path.basename(currentPath))) {
          log(`Found existing worktree for issue #${issueNumber} at ${currentPath}`, 'info');
          return { worktreePath: currentPath, branchName: currentBranch };
        }
        currentPath = null;
        currentBranch = null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ── remove ───────────────────────────────────────────────────────────────────

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

function parseWorktreeBranches(basePath: string, env: NodeJS.ProcessEnv): Map<string, string> {
  const output = exec('git worktree list --porcelain', basePath, env);
  const result = new Map<string, string>();
  let currentPath: string | null = null;

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.substring('worktree '.length);
    } else if (line.startsWith('branch ') && currentPath?.includes('.worktrees/')) {
      result.set(currentPath, line.substring('branch '.length).replace('refs/heads/', ''));
    } else if (line === '') {
      currentPath = null;
    }
  }

  return result;
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

// ── copy env ─────────────────────────────────────────────────────────────────

export function copyEnvToWorktree(basePath: string, wtPath: string, log: GitContextLogger = noop): void {
  for (const name of ['.env', '.env.local']) {
    const src = path.join(basePath, name);
    const dst = path.join(wtPath, name);
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, dst);
        log(`Copied ${name} to worktree at ${wtPath}`, 'info');
      } catch (e) {
        log(`Warning: failed to copy ${name}: ${e}`, 'warn');
      }
    }
  }
}

// ── reset ────────────────────────────────────────────────────────────────────

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

export { noop as noopLogger };
