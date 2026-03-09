/**
 * Git worktree query functions.
 *
 * Provides functions to list and find git worktrees by issue type and number.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { log, type IssueClassSlashCommand, branchPrefixMap, branchPrefixAliases } from '../core';
import { resolveTargetRepoCwd } from '../core/targetRepoRegistry';

/**
 * Result of finding a worktree by issue type and number.
 */
export interface WorktreeForIssueResult {
  worktreePath: string;
  branchName: string;
}

/**
 * Lists all existing worktrees.
 *
 * @param cwd - Optional working directory for the git command (for external target repos)
 * @returns Array of worktree paths
 */
export function listWorktrees(cwd?: string): string[] {
  try {
    const output = execSync('git worktree list --porcelain', { encoding: 'utf-8', cwd });
    const worktrees: string[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        const wtPath = line.substring('worktree '.length);
        // Skip the main worktree (the repository root)
        if (!wtPath.includes('.worktrees')) {
          continue;
        }
        worktrees.push(wtPath);
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Finds an existing worktree matching the given issue type and number.
 * Searches worktrees in `.worktrees/` whose directory name starts with
 * `{prefix}-issue-{issueNumber}-`, returning the path and branch name
 * of the first match.
 *
 * @param issueType - The issue classification slash command (e.g., '/feature')
 * @param issueNumber - The GitHub issue number
 * @returns The matching worktree path and branch name, or null if not found
 */
export function findWorktreeForIssue(
  issueType: IssueClassSlashCommand,
  issueNumber: number,
  cwd?: string,
): WorktreeForIssueResult | null {
  try {
    const prefix = branchPrefixMap[issueType];
    const aliases = branchPrefixAliases[issueType];
    const allPrefixes = [prefix, ...aliases];
    const pattern = new RegExp('^(' + allPrefixes.join('|') + ')-issue-' + issueNumber + '-');
    const resolvedCwd = resolveTargetRepoCwd(cwd);
    const output = execSync('git worktree list --porcelain', { encoding: 'utf-8', cwd: resolvedCwd });
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
            log(`Found existing worktree for ${issueType} issue #${issueNumber} at ${currentWorktreePath}`, 'info');
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
