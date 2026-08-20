/**
 * Target repository workspace management — shim adapter (issue #700).
 *
 * Clone/fetch/default-branch logic has been absorbed into the structurally-exempt
 * `adws/gitContext/repoWorkspace.ts`. This file re-exports helpers at the stable
 * import path for trigger_cron, trigger_webhook, workflowInit, and prReviewPhase,
 * and provides `ensureTargetRepoWorkspace` as a thin wrapper that builds a veracious
 * GitContext and delegates to `ensureRepoWorkspace` — fixing the ambient-auth
 * `gh repo view` crash in the old `fetchLatestRefs`.
 *
 * Since #793 the core clones exactly the URL it is handed, so this shim is
 * the site that hands it a ready one: it converts a published GitHub HTTPS
 * clone URL to SSH (`convertToSshUrl`, now owned by the GitHub forge
 * adapter) before calling into the core.
 *
 * Zero raw git/gh strings remain in this file.
 */

import * as path from 'path';
import type { TargetRepoInfo } from '../types/issueTypes';
import { TARGET_REPOS_DIR } from './config';
import { log } from './utils';
import {
  getTargetRepoWorkspacePath as _getWorkspacePath,
  isRepoCloned,
  cloneRepo,
  ensureRepoWorkspace,
} from '../gitContext';
import { convertToSshUrl } from '../providers/github/cloneUrl';
import { gitContextForRepo } from '../github/gitContextFactory';

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
 * Default-branch resolution now runs through a GitContext with per-command veracious
 * auth — fixing the ambient-auth `gh repo view` crash that triggered the
 * `fetchLatestRefs` incident class.
 *
 * Returns the absolute workspace path.
 */
export function ensureTargetRepoWorkspace(targetRepo: TargetRepoInfo): string {
  const { owner, repo, cloneUrl } = targetRepo;
  const ctx = gitContextForRepo({ owner, repo });

  return ensureRepoWorkspace(owner, repo, convertToSshUrl(cloneUrl), {
    targetReposDir: TARGET_REPOS_DIR,
    getDefaultBranch: () => ctx.defaultBranch(),
    log,
  });
}

// ---------------------------------------------------------------------------
// fetchLatestRefs / pullLatestDefaultBranch — deprecated aliases
// ---------------------------------------------------------------------------

/**
 * @deprecated Prefer {@link ensureTargetRepoWorkspace}.
 * Fetches latest refs from origin and returns the default branch name,
 * using per-command veracious auth via a GitContext.
 */
export function fetchLatestRefs(workspacePath: string): string {
  const rel = path.relative(TARGET_REPOS_DIR, workspacePath);
  const parts = rel.split(path.sep);
  if (parts.length < 2) {
    throw new Error(`fetchLatestRefs: cannot determine owner/repo from path: ${workspacePath}`);
  }
  const [owner, repo] = parts;
  const ctx = gitContextForRepo({ owner, repo });
  const defaultBranch = ctx.defaultBranch();
  log(`Fetched latest refs for ${defaultBranch} in ${workspacePath}`, 'success');
  return defaultBranch;
}

/**
 * @deprecated Use {@link fetchLatestRefs} instead.
 */
export function pullLatestDefaultBranch(workspacePath: string): string {
  return fetchLatestRefs(workspacePath);
}
