/**
 * Workspace binding over the caller's own context. `validateGitRemote` reads
 * a workspace's `origin` remote through the GIVEN GitContext — never a
 * second, differently-credentialed one constructed just for this check — and
 * cross-checks it against the declared identity. `bindWorkspaceContext`
 * validates a workspace directory against a launch boundary and reuses the
 * boundary's already-minted providers; it never mints a second set.
 */

import type { GitContext } from '../gitContext';
import type { RepoContext, RepoIdentifier } from '../providers/types';
import { validateRepoIdentifier } from '../providers/types';
import { validateWorkingDirectory, parseOwnerRepoFromUrl } from '../providers/workspaceValidation';
import { sameRepoIdentity } from './repoIdentityCrossCheck';
import type { LaunchBoundary } from './launchGitContext';

/**
 * Validates that the git remote `origin` in `cwd` — read through `ctx`, the
 * context the caller already holds — matches the declared RepoIdentifier
 * (case-insensitive owner/repo comparison).
 */
export function validateGitRemote(ctx: Pick<GitContext, 'remoteUrl'>, cwd: string, repoId: RepoIdentifier): void {
  let remoteUrl: string;
  try {
    remoteUrl = ctx.remoteUrl(cwd);
  } catch {
    throw new Error(
      `Failed to get git remote URL in ${cwd}. Ensure the repository has an 'origin' remote configured.`,
    );
  }

  const parsed = parseOwnerRepoFromUrl(remoteUrl);
  if (!parsed) {
    throw new Error(
      `Could not parse owner/repo from git remote URL: ${remoteUrl}`,
    );
  }

  if (parsed.owner.toLowerCase() !== repoId.owner.toLowerCase()) {
    throw new Error(
      `Git remote does not match declared repo. Remote owner "${parsed.owner}" !== declared owner "${repoId.owner}"`,
    );
  }

  if (parsed.repo.toLowerCase() !== repoId.repo.toLowerCase()) {
    throw new Error(
      `Git remote does not match declared repo. Remote repo "${parsed.repo}" !== declared repo "${repoId.repo}"`,
    );
  }
}

/**
 * Binds the boundary's providers to a validated workspace directory —
 * `{ ...boundary.providers, cwd, repoId }`, the same cwd/`origin` validation
 * as today. `repoId` (default: the boundary's) must name the boundary's
 * repository — a caller-supplied identity for a DIFFERENT repository is
 * refused before `boundary.providers` is ever touched (no mint, no config
 * read).
 */
export function bindWorkspaceContext(
  boundary: Pick<LaunchBoundary, 'gitContext' | 'repoId' | 'providers'>,
  cwd: string,
  repoId: RepoIdentifier = boundary.repoId,
): RepoContext {
  if (!sameRepoIdentity(repoId, boundary.repoId)) {
    throw new Error(
      `bindWorkspaceContext: ${repoId.owner}/${repoId.repo} does not match the launch boundary's ${boundary.repoId.owner}/${boundary.repoId.repo}`,
    );
  }
  validateRepoIdentifier(repoId);
  validateWorkingDirectory(cwd);
  validateGitRemote(boundary.gitContext, cwd, repoId);

  return Object.freeze({ ...boundary.providers, cwd, repoId });
}
