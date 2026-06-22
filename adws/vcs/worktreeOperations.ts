/**
 * Git worktree utility — reverse lookup only.
 *
 * All worktree creation/removal/reset/list operations are now methods on GitContext.
 * This file retains only `getMainRepoPath`, an explicit-cwd reverse lookup used by
 * claudeAgent.ts to set ADW_MAIN_REPO_PATH in subprocess environments.
 */

import { execSync } from 'child_process';

/**
 * Gets the path of the main repository (not a worktree).
 * Accepts an explicit `cwd` so it never defaults to `process.cwd()`.
 *
 * @param cwd - Working directory for the git command (typically the current worktree path)
 * @returns The absolute path to the main repository
 * @throws Error if unable to determine the main repository path
 */
export function getMainRepoPath(cwd?: string): string {
  try {
    const output = execSync('git worktree list --porcelain', { encoding: 'utf-8', cwd });
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        const wtPath = line.substring('worktree '.length);
        if (!wtPath.includes('.worktrees')) {
          return wtPath;
        }
      }
    }

    throw new Error('Could not find main repository in worktree list');
  } catch (error) {
    throw new Error(`Failed to get main repository path: ${error}`);
  }
}
