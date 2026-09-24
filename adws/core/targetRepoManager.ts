/**
 * The core clones exactly the URL it is handed, so this shim is the site that
 * hands it a ready one: it converts a published HTTPS clone URL to SSH
 * (`convertToSshUrl`) before calling into the core.
 *
 * It also grants Claude Code workspace trust for the returned path in
 * `~/.claude.json` via `ensureWorkspaceTrusted` (`./workspaceTrust.ts`) — a
 * Claude-Code concern kept out of the git core.
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
} from '@paysdoc/devplatform/git';
import { convertToSshUrl } from './sshCloneUrl';
import { ensureWorkspaceTrusted } from './workspaceTrust';

export function getTargetRepoWorkspacePath(owner: string, repo: string): string {
  return _getWorkspacePath(owner, repo, TARGET_REPOS_DIR);
}

export { isRepoCloned, convertToSshUrl, ensureWorkspaceTrusted };
export type { WorkspaceTrustDeps, WorkspaceTrustResult } from './workspaceTrust';

/**
 * Clones a target repository (HTTPS → SSH conversion included).
 * @deprecated Prefer {@link ensureTargetRepoWorkspace}.
 */
export function cloneTargetRepo(cloneUrl: string, workspacePath: string): void {
  cloneRepo(convertToSshUrl(cloneUrl), workspacePath, {
    log: (msg) => log(msg, 'info'),
  });
}

/**
 * `getDefaultBranch` is invoked only on the already-cloned (fetch) branch —
 * never on a first clone, where the workspace does not exist yet. Callers
 * pass a boundary-minted CodeHost's `getDefaultBranch()`, deferred exactly
 * long enough that the boundary's lazy provider mint never runs against a
 * not-yet-cloned workspace.
 *
 * Also grants Claude Code workspace trust for the returned path
 * (`ensureWorkspaceTrusted`) on both branches — clone and fetch converge on
 * this single return point. Trust is a nicety, never a gate: it never throws
 * and its result is not consulted, so a missing/corrupt/unwritable
 * `~/.claude.json` never blocks the ensure. The key written is this exact
 * returned path — never realpath'd — because that is the string Claude Code
 * names in its trust warning.
 *
 * Returns the absolute workspace path.
 */
export function ensureTargetRepoWorkspace(targetRepo: TargetRepoInfo, getDefaultBranch: () => string): string {
  const { owner, repo, cloneUrl } = targetRepo;

  const workspacePath = ensureRepoWorkspace(owner, repo, convertToSshUrl(cloneUrl), {
    targetReposDir: TARGET_REPOS_DIR,
    getDefaultBranch,
    log,
  });
  ensureWorkspaceTrusted(workspacePath, { log });
  return workspacePath;
}
