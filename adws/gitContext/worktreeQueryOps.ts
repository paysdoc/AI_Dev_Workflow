/**
 * Package-private worktree query ops for GitContext.
 * Injects the runner and fs for testability — no base-path computation here.
 */

import * as path from 'path';

export type Runner = (command: string, cwd: string) => string;

export interface FsDeps {
  existsSync: (p: string) => boolean;
}

export interface WorktreeForIssueResult {
  worktreePath: string;
  branchName: string;
}

/**
 * Lists all worktrees under the .worktrees/ directory (excludes the main repo).
 */
function listWorktrees(run: Runner, baseCwd: string): string[] {
  try {
    const output = run('git worktree list --porcelain', baseCwd);
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

/**
 * Finds the first worktree matching the given issue prefixes and number.
 * Accepts a pre-resolved prefixes array so the package stays free of ADW core imports.
 */
function findWorktreeForIssue(
  run: Runner,
  baseCwd: string,
  prefixes: readonly string[],
  issueNumber: number,
): WorktreeForIssueResult | null {
  try {
    const pattern = new RegExp('^(' + prefixes.join('|') + ')-issue-' + issueNumber + '-');
    const output = run('git worktree list --porcelain', baseCwd);
    const lines = output.split('\n');

    let currentWorktreePath: string | null = null;
    let currentBranch: string | null = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentWorktreePath = line.substring('worktree '.length);
        currentBranch = null;
      } else if (line.startsWith('branch ')) {
        currentBranch = line.substring('branch '.length).replace('refs/heads/', '');
      } else if (line === '' && currentWorktreePath && currentBranch) {
        if (currentWorktreePath.includes('.worktrees/')) {
          const dirName = path.basename(currentWorktreePath);
          if (pattern.test(dirName)) {
            return { worktreePath: currentWorktreePath, branchName: currentBranch };
          }
        }
        currentWorktreePath = null;
        currentBranch = null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Gets the existing worktree path for a branch, or null if not found.
 * Checks by exact path, then by branch name under .worktrees/, then by orphan directory.
 */
function getWorktreeForBranch(
  run: Runner,
  fs: FsDeps,
  baseCwd: string,
  expectedWorktreePath: string,
  branchName: string,
): string | null {
  try {
    const output = run('git worktree list --porcelain', baseCwd);
    const lines = output.split('\n');
    let currentWorktreePath: string | null = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentWorktreePath = line.substring('worktree '.length);
        if (currentWorktreePath === expectedWorktreePath) return expectedWorktreePath;
      } else if (line.startsWith('branch ') && currentWorktreePath) {
        const checkedOutBranch = line.substring('branch '.length).replace('refs/heads/', '');
        if (checkedOutBranch === branchName && currentWorktreePath.includes('.worktrees')) {
          return currentWorktreePath;
        }
      }
    }

    if (fs.existsSync(expectedWorktreePath)) return expectedWorktreePath;
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns the path of the main repository (the first worktree entry NOT under .worktrees).
 * Throws if no such entry is found — preserves the throw-on-failure contract of the legacy caller.
 */
function mainRepoPath(run: Runner, cwd: string): string {
  const output = run('git worktree list --porcelain', cwd);
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      const wtPath = line.substring('worktree '.length);
      if (!wtPath.includes('.worktrees')) return wtPath;
    }
  }
  throw new Error('Could not find main repository in worktree list');
}

/**
 * Returns branch names from `git worktree list --porcelain`.
 * Strips `refs/heads/` prefix; returns [] on failure.
 */
function worktreeBranches(run: Runner, cwd: string): string[] {
  try {
    const output = run('git worktree list --porcelain', cwd);
    const branches: string[] = [];
    for (const line of output.split('\n')) {
      if (line.startsWith('branch ')) {
        const branch = line.substring('branch '.length).replace('refs/heads/', '').trim();
        if (branch) branches.push(branch);
      }
    }
    return branches;
  } catch {
    return [];
  }
}

export const worktreeQueryOps = { listWorktrees, findWorktreeForIssue, getWorktreeForBranch, mainRepoPath, worktreeBranches };
