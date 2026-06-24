/**
 * Git worktree operations for ADW workflows.
 *
 * Most operations have migrated to GitContext (#661).
 * Only getMainRepoPath remains for agents that need the ADW repo root.
 */

import { gitContextForRepo, readLocalRepoInfo } from '../github/gitContextFactory';

/**
 * Gets the path of the main repository (not a worktree).
 * The main repository is the first worktree listed that doesn't contain '.worktrees'.
 *
 * @param cwd - Working directory for the git command
 * @returns The absolute path to the main repository
 * @throws Error if unable to determine the main repository path
 */
export function getMainRepoPath(cwd: string): string {
  return gitContextForRepo(readLocalRepoInfo(cwd)).mainRepoPath(cwd);
}
