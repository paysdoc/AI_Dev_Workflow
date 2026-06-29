/**
 * Package-private worktree create/ensure ops for GitContext.
 * Injects runner and fs for testability — no base-path computation here.
 */

import { log } from '../core/utils';
import { worktreeQueryOps } from './worktreeQueryOps';

type Runner = (command: string, cwd: string) => string;

interface FsDeps {
  existsSync: (p: string) => boolean;
  mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
  copyFileSync: (src: string, dest: string) => void;
}

interface WorktreePaths {
  worktreesDir: string;
  worktreePath: string;
  baseCwd: string;
}

export type { FsDeps as WorktreeCreateFsDeps };

interface BranchCheckoutStatus {
  checkedOut: boolean;
  path: string | null;
  isMainRepo: boolean;
}

function isBranchCheckedOutElsewhere(run: Runner, baseCwd: string, branchName: string): BranchCheckoutStatus {
  try {
    const output = run('git worktree list --porcelain', baseCwd);
    const lines = output.split('\n');
    let currentWorktreePath: string | null = null;
    let mainRepoPath: string | null = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentWorktreePath = line.substring('worktree '.length);
        if (!currentWorktreePath.includes('.worktrees') && !mainRepoPath) {
          mainRepoPath = currentWorktreePath;
        }
      } else if (line.startsWith('branch ') && currentWorktreePath) {
        const checkedOutBranch = line.substring('branch '.length).replace('refs/heads/', '');
        if (checkedOutBranch === branchName) {
          return {
            checkedOut: true,
            path: currentWorktreePath,
            isMainRepo: currentWorktreePath === mainRepoPath,
          };
        }
      }
    }

    return { checkedOut: false, path: null, isMainRepo: false };
  } catch {
    return { checkedOut: false, path: null, isMainRepo: false };
  }
}

function freeBranchFromMainRepo(run: Runner, baseCwd: string, branchName: string): void {
  log(`Freeing branch '${branchName}' from main repository at ${baseCwd}`, 'info');
  try {
    const status = run('git status --porcelain', baseCwd);
    if (status.trim()) {
      log('Found uncommitted changes in main repository, auto-committing...', 'info');
      run('git add -A', baseCwd);
      run('git commit -m "WIP: auto-commit before switching to worktree"', baseCwd);
      log('Auto-committed changes', 'success');
      try {
        run(`git push -u origin "${branchName}"`, baseCwd);
        log(`Pushed branch '${branchName}' to origin`, 'success');
      } catch (pushError) {
        log(`Warning: Could not push branch to origin: ${pushError}`, 'info');
      }
    }
    // get default branch by inspecting origin/HEAD
    let defaultBranch = 'main';
    try {
      defaultBranch = run('git rev-parse --abbrev-ref origin/HEAD', baseCwd).replace('origin/', '').trim();
    } catch {
      // fall back to 'main'
    }
    run(`git checkout "${defaultBranch}"`, baseCwd);
    log(`Switched main repository to '${defaultBranch}'`, 'success');
  } catch (error) {
    throw new Error(`Failed to free branch '${branchName}' from main repository: ${error}`);
  }
}

/**
 * Copies .env and .env.local from baseCwd (the repo root) to the worktree.
 */
function copyEnvToWorktree(
  fs: FsDeps,
  baseCwd: string,
  worktreePath: string,
): void {
  for (const name of ['.env', '.env.local']) {
    const src = baseCwd + '/' + name;
    const dest = worktreePath + '/' + name;
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      log(`Copied ${name} file to worktree at ${worktreePath}`, 'info');
    } else {
      log(`No ${name} file found in ${baseCwd}, skipping copy`, 'info');
    }
  }
}

function resolveBranchExists(run: Runner, baseCwd: string, branchName: string): boolean {
  try {
    run(`git rev-parse --verify "${branchName}"`, baseCwd);
    return true;
  } catch { /* branch not found locally */ }
  try {
    run(`git rev-parse --verify "origin/${branchName}"`, baseCwd);
    return true;
  } catch { /* branch not found on remote */ }
  try {
    run(`git fetch origin "${branchName}"`, baseCwd);
    run(`git rev-parse --verify "origin/${branchName}"`, baseCwd);
    log(`Fetched branch '${branchName}' from origin`, 'info');
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a worktree for an existing branch (or creates a new one from baseBranch).
 * Returns the worktree path.
 */
function createWorktree(
  run: Runner,
  fs: FsDeps,
  paths: WorktreePaths,
  branchName: string,
  baseBranch?: string,
): string {
  if (!branchName || !branchName.trim()) throw new Error('branchName must be a non-empty string');

  const { worktreesDir, worktreePath, baseCwd } = paths;

  if (!fs.existsSync(worktreesDir)) {
    fs.mkdirSync(worktreesDir, { recursive: true });
  }

  try {
    const branchExists = resolveBranchExists(run, baseCwd, branchName);

    if (branchExists) {
      const checkoutStatus = isBranchCheckedOutElsewhere(run, baseCwd, branchName);
      if (checkoutStatus.checkedOut) {
        if (checkoutStatus.isMainRepo) {
          log(`Branch '${branchName}' is checked out in main repository, freeing it...`, 'info');
          freeBranchFromMainRepo(run, baseCwd, branchName);
        } else if (checkoutStatus.path) {
          log(`Branch '${branchName}' is already checked out at ${checkoutStatus.path}, reusing`, 'info');
          return checkoutStatus.path;
        }
      }
      run(`git worktree add "${worktreePath}" "${branchName}"`, baseCwd);
      log(`Created worktree for existing branch '${branchName}' at ${worktreePath}`, 'success');
    } else if (baseBranch) {
      try { run(`git fetch origin "${baseBranch}"`, baseCwd); } catch { /* non-fatal */ }
      try {
        const localHash = run(`git rev-parse "${baseBranch}"`, baseCwd);
        const remoteHash = run(`git rev-parse "origin/${baseBranch}"`, baseCwd);
        if (localHash !== remoteHash) {
          log(`Local ${baseBranch} differs from origin/${baseBranch}, using remote ref`, 'warn');
        }
      } catch { /* non-fatal */ }
      run(`git worktree add -b "${branchName}" "${worktreePath}" "origin/${baseBranch}"`, baseCwd);
      log(`Created worktree with new branch '${branchName}' from 'origin/${baseBranch}' at ${worktreePath}`, 'success');
    } else {
      throw new Error(`Branch '${branchName}' does not exist and no base branch was provided`);
    }

    return worktreePath;
  } catch (error) {
    throw new Error(`Failed to create worktree for branch '${branchName}': ${error}`);
  }
}

/**
 * Creates a worktree with a new branch from an optional base (defaults to HEAD).
 */
function createWorktreeForNewBranch(
  run: Runner,
  fs: FsDeps,
  paths: WorktreePaths,
  branchName: string,
  baseBranch?: string,
): string {
  if (!branchName || !branchName.trim()) throw new Error('branchName must be a non-empty string');

  const { worktreesDir, worktreePath, baseCwd } = paths;

  if (!fs.existsSync(worktreesDir)) {
    fs.mkdirSync(worktreesDir, { recursive: true });
  }

  try {
    let base = 'HEAD';
    if (baseBranch) {
      try { run(`git fetch origin "${baseBranch}"`, baseCwd); } catch { /* non-fatal */ }
      base = `origin/${baseBranch}`;
    }
    run(`git worktree add -b "${branchName}" "${worktreePath}" "${base}"`, baseCwd);
    log(`Created worktree with new branch '${branchName}' at ${worktreePath}`, 'success');
    return worktreePath;
  } catch (error) {
    throw new Error(`Failed to create worktree with new branch '${branchName}': ${error}`);
  }
}

/**
 * Ensures a worktree exists for the branch, creating if needed.
 * Copies env files into the worktree.
 */
function ensureWorktree(
  run: Runner,
  fs: FsDeps,
  paths: WorktreePaths,
  branchName: string,
  baseBranch?: string,
): string {
  const existingPath = worktreeQueryOps.getWorktreeForBranch(run, fs, paths.baseCwd, paths.worktreePath, branchName);
  if (existingPath) {
    log(`Worktree for branch '${branchName}' already exists at ${existingPath}, reusing`, 'info');
    copyEnvToWorktree(fs, paths.baseCwd, existingPath);
    return existingPath;
  }

  log(`Worktree for branch '${branchName}' does not exist, creating new worktree...`, 'info');
  const worktreePath = createWorktree(run, fs, paths, branchName, baseBranch);
  copyEnvToWorktree(fs, paths.baseCwd, worktreePath);
  return worktreePath;
}

export const worktreeCreateOps = {
  createWorktree,
  createWorktreeForNewBranch,
  ensureWorktree,
  copyEnvToWorktree,
};
