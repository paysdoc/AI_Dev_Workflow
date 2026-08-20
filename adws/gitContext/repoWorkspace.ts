/**
 * Target repository workspace management — absorbed into the gitContext package (issue #700).
 *
 * Handles workspace path resolution, cloning, and fetching for external target
 * repositories. Structurally exempt from the guard (adws/gitContext/ directory).
 *
 * All ADW-global config (TARGET_REPOS_DIR) is injected at the shim boundary in
 * targetRepoManager.ts; this module stays ADW-global-free for standalone reuse.
 * The `defaultBranch` thunk is injected so the caller can bind a veracious
 * GitContext token — fixing the ambient-auth `gh repo view` crash in fetchLatestRefs.
 *
 * The caller supplies a ready-made clone URL (issue #793, PRD story 14): this
 * module clones exactly the URL it is handed, with no rewriting and no forge
 * vocabulary. The GitHub HTTPS→SSH rewrite lives in the adapter
 * (`adws/providers/github/cloneUrl.ts`) and is applied by the ADW wiring
 * shim (`adws/core/targetRepoManager.ts`) before this module is called.
 */

import { execSync } from 'child_process';
import type { ExecSyncOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal exec seam shared by clone and fetch operations. */
export type WorkspaceExecFn = (cmd: string, opts: { cwd?: string; stdio?: ExecSyncOptions['stdio']; encoding?: string }) => void;

export interface EnsureRepoWorkspaceDeps {
  /** Absolute path to the directory housing cloned target repos (injected from ADW env). */
  targetReposDir: string;
  /** Returns the default branch name, run under per-command veracious auth. */
  getDefaultBranch: () => string;
  /** Override for hermetic tests; defaults to execSync. */
  exec?: WorkspaceExecFn;
  /** Override for hermetic tests; defaults to real fs. */
  fsDeps?: Pick<typeof fs, 'existsSync' | 'mkdirSync'>;
  /** Log function; defaults to no-op (tests control verbosity). */
  log?: Logger;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the workspace path for a target repository.
 * Format: `targetReposDir/{owner}/{repo}`
 * `targetReposDir` is injected — never reads TARGET_REPOS_DIR directly.
 */
export function getTargetRepoWorkspacePath(owner: string, repo: string, targetReposDir: string): string {
  return path.join(targetReposDir, owner, repo);
}

/** Returns true if a `.git` directory exists at workspacePath. */
export function isRepoCloned(workspacePath: string, fsDeps?: Pick<typeof fs, 'existsSync'>): boolean {
  const fsOps = fsDeps ?? fs;
  return fsOps.existsSync(path.join(workspacePath, '.git'));
}

/**
 * Clones a repository into workspacePath. Clones exactly the URL it is
 * given (issue #793) — no rewriting, no scheme translation. The caller
 * (`adws/core/targetRepoManager.ts`) is responsible for handing this
 * function a ready-made clone URL.
 */
export function cloneRepo(
  cloneUrl: string,
  workspacePath: string,
  opts?: {
    fsDeps?: Pick<typeof fs, 'mkdirSync'>;
    log?: Logger;
    exec?: WorkspaceExecFn;
  },
): void {
  const fsDeps = opts?.fsDeps ?? fs;
  const logFn = opts?.log ?? (() => {});
  const execFn = opts?.exec ?? ((cmd, o) => { execSync(cmd, { ...o as ExecSyncOptions, encoding: 'utf-8' }); });
  const parentDir = path.dirname(workspacePath);
  fsDeps.mkdirSync(parentDir, { recursive: true });

  logFn(`Cloning ${cloneUrl} into ${workspacePath}...`, 'info');
  execFn(`git clone "${cloneUrl}" "${workspacePath}"`, { stdio: 'pipe', encoding: 'utf-8' });
  logFn(`Cloned ${cloneUrl} into ${workspacePath}`, 'success');
}

// ---------------------------------------------------------------------------
// ensureRepoWorkspace
// ---------------------------------------------------------------------------

/**
 * Ensures a target repository workspace exists and is up-to-date.
 *
 * - Not cloned: clones `cloneUrl` exactly as given — no rewriting. The
 *   caller supplies a ready-made clone URL (issue #793); this function never
 *   consults forge conventions to decide what to clone.
 * - Already cloned: runs `git fetch origin` and reads the default branch through
 *   the injected `getDefaultBranch` thunk — which must run `gh repo view` under
 *   per-command veracious auth (fixes the `fetchLatestRefs` crash class). The
 *   clone URL is never consulted on this path.
 *
 * Returns the absolute workspace path.
 */
export function ensureRepoWorkspace(
  owner: string,
  repo: string,
  cloneUrl: string,
  deps: EnsureRepoWorkspaceDeps,
): string {
  const { targetReposDir, getDefaultBranch, log: logFn = () => {} } = deps;
  const fsDeps = deps.fsDeps ?? fs;
  const execFn = deps.exec ?? ((cmd, opts) => { execSync(cmd, { ...(opts as ExecSyncOptions), encoding: 'utf-8', stdio: 'pipe' }); });

  const workspacePath = getTargetRepoWorkspacePath(owner, repo, targetReposDir);

  if (isRepoCloned(workspacePath, fsDeps)) {
    logFn(`Target repo ${owner}/${repo} already cloned at ${workspacePath}`, 'info');
    execFn('git fetch origin', { cwd: workspacePath });
    const defaultBranch = getDefaultBranch();
    logFn(`Fetched latest refs for ${defaultBranch} in ${workspacePath}`, 'success');
  } else {
    cloneRepo(cloneUrl, workspacePath, { fsDeps, log: logFn, exec: execFn });
  }

  return workspacePath;
}
