/**
 * Git worktree operations for ADW workflows.
 *
 * Most operations have migrated to GitContext (#661).
 * Only getMainRepoPath remains for agents that need the ADW repo root — it now
 * delegates to an injected GitContext rather than constructing its own (#822).
 */

import type { GitContext } from '../gitContext';

/**
 * Gets the path of the main repository (not a worktree).
 * The main repository is the first worktree listed that doesn't contain '.worktrees'.
 *
 * @param gitContext - The launch-boundary GitContext to resolve the path through
 * @param cwd - Working directory for the git command
 * @returns The absolute path to the main repository
 * @throws Error if unable to determine the main repository path
 */
export function getMainRepoPath(gitContext: Pick<GitContext, 'mainRepoPath'>, cwd: string): string {
  return gitContext.mainRepoPath(cwd);
}
