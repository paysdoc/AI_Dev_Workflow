/**
 * Worktree query operations for GitContext.
 *
 * Pure functions over (basePath, env) using only Node built-ins.
 * No imports from adws/* — package purity constraint (PRD stories 19/20).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GitContextLogger, WorktreeForIssueResult } from './types';
import { worktreePathFor, exec } from './worktreeOpsHelpers';

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
