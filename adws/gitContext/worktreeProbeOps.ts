/**
 * Package-private worktree-probe op module for GitContext.
 * Handles reads that inspect an arbitrary worktree path supplied by the caller,
 * as opposed to the context's own base path (which worktreeQueryOps covers).
 */

import * as path from 'path';

export type WorktreeRegistration = 'healthy' | 'locked' | 'prunable' | 'missing';

type Runner = (command: string, cwd: string) => string;

function resolveGitDir(run: Runner, worktreePath: string): string | null {
  try {
    const raw = run('git rev-parse --git-dir', worktreePath).trim();
    return path.isAbsolute(raw) ? raw : path.resolve(worktreePath, raw);
  } catch {
    return null;
  }
}

function currentBranchSymbolic(run: Runner, worktreePath: string): string | null {
  try {
    return run('git symbolic-ref --short HEAD', worktreePath).trim() || null;
  } catch {
    return null;
  }
}

function worktreeRegistration(run: Runner, worktreePath: string): WorktreeRegistration {
  try {
    const output = run('git worktree list --porcelain', worktreePath);
    const lines = output.split('\n');
    let currentPath: string | null = null;
    let isLocked = false;
    let isPrunable = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentPath = line.slice('worktree '.length);
        isLocked = false;
        isPrunable = false;
      } else if (line.startsWith('locked') && currentPath === worktreePath) {
        isLocked = true;
      } else if (line.startsWith('prunable') && currentPath === worktreePath) {
        isPrunable = true;
      } else if (line === '' && currentPath === worktreePath) {
        if (isLocked) return 'locked';
        if (isPrunable) return 'prunable';
        return 'healthy';
      }
    }
    // Handle the last entry when trailing blank line is absent (e.g. after .trim())
    if (currentPath === worktreePath) {
      if (isLocked) return 'locked';
      if (isPrunable) return 'prunable';
      return 'healthy';
    }
    return 'missing';
  } catch {
    return 'missing';
  }
}

export const worktreeProbeOps = { resolveGitDir, currentBranchSymbolic, worktreeRegistration };
