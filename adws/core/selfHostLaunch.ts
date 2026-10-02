/**
 * `GitContext.selfHost` only records that no `--target-repo` was passed, and the cron and webhook triggers pass one
 * for the framework's own repository too. A launch for that repository keeps the framework's own
 * `.claude/settings.json`, so the guardrails gate must see it as self-host. `GitContext.selfHost` itself stays as it is
 * because it also picks the worktree base path.
 */

import type { GitContext } from '@paysdoc/devplatform/git';
import type { RepoIdentity } from '../types/agentTypes';
import { REPO_ROOT } from './environment';
import { readLocalRepoIdentity } from './localRepoIdentity';
import { sameRepoIdentity } from './repoIdentityCrossCheck';

let frameworkIdentity: RepoIdentity | null | undefined;

/** `null` when the framework checkout has no readable `origin`; every `selfHost: false` launch is then a target. */
function readFrameworkIdentityOnce(): RepoIdentity | null {
  if (frameworkIdentity !== undefined) return frameworkIdentity;
  try {
    frameworkIdentity = readLocalRepoIdentity(REPO_ROOT);
  } catch {
    frameworkIdentity = null;
  }
  return frameworkIdentity;
}

/** Test-only seam: clears the memoised framework identity so the next call re-reads it. */
export function resetFrameworkIdentityMemo(): void {
  frameworkIdentity = undefined;
}

/** Anything short of an explicit `selfHost: false`, including no GitContext at all, counts as self-host and never injects. */
export function isSelfHostLaunch(gitContext: Pick<GitContext, 'selfHost' | 'owner' | 'repo'> | undefined): boolean {
  if (gitContext?.selfHost !== false) return true;
  const framework = readFrameworkIdentityOnce();
  return framework !== null && sameRepoIdentity(framework, gitContext);
}
