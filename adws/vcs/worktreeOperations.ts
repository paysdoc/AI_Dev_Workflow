/**
 * Only getMainRepoPath remains for agents that need the ADW repo root — it now
 * delegates to an injected GitContext rather than constructing its own.
 */

import type { GitContext } from '@paysdoc/devplatform/git';

/**
 * The main repository is the first worktree listed that doesn't contain '.worktrees'.
 *
 * @throws Error if unable to determine the main repository path
 */
export function getMainRepoPath(gitContext: Pick<GitContext, 'mainRepoPath'>, cwd: string): string {
  return gitContext.mainRepoPath(cwd);
}
