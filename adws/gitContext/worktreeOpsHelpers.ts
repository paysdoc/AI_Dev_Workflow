/**
 * Shared internal helpers for worktree operation modules.
 * Not part of the public worktreeOps barrel — internal use only.
 *
 * Pure functions over (basePath, env, log) using only Node built-ins.
 * No imports from adws/* — package purity constraint (PRD stories 19/20).
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { GitContextLogger } from './types';

const PROTECTED_BRANCHES = ['main', 'master', 'develop'];

export const noop: GitContextLogger = () => {};

function sanitizeBranchName(branch: string): string {
  return branch.replace(/[/\\:*?"<>|`]/g, '-');
}

export function worktreePathFor(basePath: string, branch: string): string {
  return path.join(basePath, '.worktrees', sanitizeBranchName(branch));
}

export function exec(cmd: string, cwd: string, env: NodeJS.ProcessEnv): string {
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

export function deleteLocalBranchInternal(basePath: string, branchName: string, env: NodeJS.ProcessEnv): void {
  if (PROTECTED_BRANCHES.includes(branchName)) return;
  try {
    execSync(`git branch -D "${branchName}"`, { stdio: 'pipe', cwd: basePath, env });
  } catch {
    // Branch may not exist locally — non-fatal
  }
}

export function killProcessesInDir(dirPath: string): void {
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

export function isBranchCheckedOutElsewhere(basePath: string, branch: string, env: NodeJS.ProcessEnv): CheckoutStatus {
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

export function freeBranchFromMainRepo(basePath: string, branch: string, env: NodeJS.ProcessEnv, log: GitContextLogger): void {
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

export function parseWorktreeBranches(basePath: string, env: NodeJS.ProcessEnv): Map<string, string> {
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
