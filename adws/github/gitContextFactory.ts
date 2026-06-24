/**
 * Boundary factory — constructs a GitContext from ambient ADW identity.
 *
 * This file is a thin ADW adapter that injects framework-global config
 * (REPO_ROOT, TARGET_REPOS_DIR, GITHUB_PAT) into the package primitives.
 * All raw git/gh has been absorbed into the `adws/gitContext/` package (issue #700).
 */

import { GitContext } from '../gitContext';
import type { GitContextOptions } from '../gitContext/types';
import {
  isGitHubAppConfigured,
  getInstallationToken,
  readLocalRepoInfo,
  resolveBootstrapGitIdentity,
  resolveContextToken,
  ghAuthToken,
} from '../gitContext';
import { REPO_ROOT, TARGET_REPOS_DIR, GITHUB_PAT } from '../core/environment';
import type { RepoInfo } from './githubApi';

interface FactoryInput {
  owner: string;
  repo: string;
  selfHost: boolean;
}

/**
 * Derives git author/committer identity from ambient config.
 * Delegates to the absorbed package resolver (issue #700).
 */
export function deriveGitIdentity() {
  return resolveBootstrapGitIdentity();
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

function resolveToken(owner: string, repo: string): string {
  return resolveContextToken({
    owner,
    repo,
    pat: GITHUB_PAT,
    isAppConfigured: isGitHubAppConfigured,
    mintInstallationToken: getInstallationToken,
    ghAuthToken,
  });
}

// ---------------------------------------------------------------------------
// Self-host identity cache
// ---------------------------------------------------------------------------

let selfHostOwnerCache: string | undefined;
let selfHostRepoCache: string | undefined;

function getSelfHostIdentity(): { owner: string; repo: string } {
  if (selfHostOwnerCache === undefined) {
    try {
      const info = readLocalRepoInfo(REPO_ROOT);
      selfHostOwnerCache = info.owner;
      selfHostRepoCache = info.repo;
    } catch {
      selfHostOwnerCache = '';
      selfHostRepoCache = '';
    }
  }
  return { owner: selfHostOwnerCache!, repo: selfHostRepoCache! };
}

export function clearSelfHostCache(): void {
  selfHostOwnerCache = undefined;
  selfHostRepoCache = undefined;
}

// ---------------------------------------------------------------------------
// readLocalRepoInfo — re-exported from package for downstream importers
// (githubApi.getRepoInfo, orchestratorLib, upgradeClaim, trigger_webhook, etc.)
// ---------------------------------------------------------------------------

export { readLocalRepoInfo };

// ---------------------------------------------------------------------------
// GitContext factories
// ---------------------------------------------------------------------------

export async function gitContextFor({ owner, repo, selfHost }: FactoryInput): Promise<GitContext> {
  return gitContextForSync({ owner, repo, selfHost });
}

/** Synchronous variant — all resolution is synchronous under the hood. */
export function gitContextForSync({ owner, repo, selfHost }: FactoryInput): GitContext {
  const token = resolveToken(owner, repo);
  const gitIdentity = resolveBootstrapGitIdentity();
  const options: GitContextOptions = {
    owner,
    repo,
    selfHost,
    token,
    gitIdentity,
    frameworkRepoRoot: REPO_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
  };
  return new GitContext(options);
}

/** Returns a fresh GitContext for the given repo. */
export function gitContextForRepo(repoInfo: RepoInfo, opts?: { selfHost?: boolean }): GitContext {
  const { owner, repo } = repoInfo;
  const token = resolveToken(owner, repo);
  const gitIdentity = resolveBootstrapGitIdentity();
  const sh = getSelfHostIdentity();
  const selfHost = opts?.selfHost ?? (owner === sh.owner && repo === sh.repo && !!sh.owner);
  return new GitContext({
    owner, repo, selfHost, token, gitIdentity,
    frameworkRepoRoot: REPO_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
    pat: GITHUB_PAT,
  });
}
