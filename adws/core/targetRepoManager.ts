/**
 * Target repository workspace management — shim adapter (issue #700).
 *
 * Clone/fetch/default-branch logic has been absorbed into the structurally-exempt
 * `adws/gitContext/repoWorkspace.ts`. This file re-exports helpers at the stable
 * import path for trigger_cron, trigger_webhook, workflowInit, and prReviewPhase,
 * and provides `ensureTargetRepoWorkspace` as a thin wrapper that delegates to
 * `ensureRepoWorkspace` with a caller-supplied `getDefaultBranch` thunk (a
 * boundary-minted CodeHost, per #797) — fixing the ambient-auth `gh repo view`
 * crash in the old `fetchLatestRefs`.
 *
 * Since #793 the core clones exactly the URL it is handed, so this shim is
 * the site that hands it a ready one: it converts a published HTTPS clone
 * URL to SSH (`convertToSshUrl`, ADW-owned and host-neutral since #844)
 * before calling into the core.
 *
 * Zero raw git/gh strings remain in this file.
 */

import type { TargetRepoInfo } from '../types/issueTypes';
import { TARGET_REPOS_DIR } from './config';
import { log } from './utils';
import {
  getTargetRepoWorkspacePath as _getWorkspacePath,
  isRepoCloned,
  cloneRepo,
  ensureRepoWorkspace,
} from '../gitContext';
import { convertToSshUrl } from './sshCloneUrl';

// ---------------------------------------------------------------------------
// Path helpers — bind TARGET_REPOS_DIR at the shim boundary
// ---------------------------------------------------------------------------

/** Returns the workspace path: `TARGET_REPOS_DIR/{owner}/{repo}` */
export function getTargetRepoWorkspacePath(owner: string, repo: string): string {
  return _getWorkspacePath(owner, repo, TARGET_REPOS_DIR);
}

// Re-export utilities at the stable paths
export { isRepoCloned, convertToSshUrl };

/**
 * Clones a target repository (HTTPS → SSH conversion included).
 * @deprecated Prefer {@link ensureTargetRepoWorkspace}.
 */
export function cloneTargetRepo(cloneUrl: string, workspacePath: string): void {
  cloneRepo(convertToSshUrl(cloneUrl), workspacePath, {
    log: (msg) => log(msg, 'info'),
  });
}

// ---------------------------------------------------------------------------
// ensureTargetRepoWorkspace
// ---------------------------------------------------------------------------

/**
 * Ensures a target repository workspace exists and is up-to-date.
 * Clones the repo if not present; fetches + reads default branch if already cloned.
 *
 * `getDefaultBranch` is invoked only on the already-cloned (fetch) branch —
 * never on a first clone, where the workspace does not exist yet. Callers
 * pass a boundary-minted CodeHost's `getDefaultBranch()`, deferred exactly
 * long enough that the boundary's lazy provider mint never runs against a
 * not-yet-cloned workspace.
 *
 * Returns the absolute workspace path.
 */
export function ensureTargetRepoWorkspace(targetRepo: TargetRepoInfo, getDefaultBranch: () => string): string {
  const { owner, repo, cloneUrl } = targetRepo;

  return ensureRepoWorkspace(owner, repo, convertToSshUrl(cloneUrl), {
    targetReposDir: TARGET_REPOS_DIR,
    getDefaultBranch,
    log,
  });
}
