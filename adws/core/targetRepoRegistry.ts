/**
 * Central target repo registry.
 *
 * Provides a single source of truth for which repository ADW is operating on.
 * Entry points (triggers, orchestrators) initialize the registry once at startup,
 * and all GitHub API functions read from it by default.
 */

import type { RepoInfo } from '../github/githubApi';
import { getRepoInfo } from '../github/githubApi';
import { log } from './utils';

let registryRepoInfo: RepoInfo | null = null;

/**
 * Sets the target repository in the central registry.
 * Should be called once per process/event at the entry point.
 */
export function setTargetRepo(repoInfo: RepoInfo): void {
  registryRepoInfo = repoInfo;
  log(`Target repo registry set: ${repoInfo.owner}/${repoInfo.repo}`);
}

/**
 * Returns the target repository from the central registry.
 * Falls back to `getRepoInfo()` (local git remote) if the registry has not been initialized.
 */
export function getTargetRepo(): RepoInfo {
  if (registryRepoInfo) {
    return registryRepoInfo;
  }
  log('Target repo registry not initialized, falling back to local git remote', 'warn');
  return getRepoInfo();
}

/**
 * Clears the target repository from the registry.
 * Used by triggers between webhook events.
 */
export function clearTargetRepo(): void {
  registryRepoInfo = null;
}

/**
 * Returns true if the target repository registry has been initialized.
 */
export function hasTargetRepo(): boolean {
  return registryRepoInfo !== null;
}
