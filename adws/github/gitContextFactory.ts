/**
 * Boundary factory — constructs a GitContext from ambient ADW identity.
 *
 * This file is a thin ADW adapter that injects framework-global config
 * (REPO_ROOT, TARGET_REPOS_DIR, GITHUB_PAT) into the package primitives.
 * All raw git/gh has been absorbed into the `adws/gitContext/` package (issue #700).
 */

import { GitContext } from '../gitContext';
import type { GitContextOptions, TokenProvider } from '../gitContext/types';
import { readLocalRepoInfo, resolveBootstrapGitIdentity } from '../providers/github/githubIdentity';
import { ghAuthToken } from '../providers/github/ghAuthToken';
import { isGitHubAppConfigured, getInstallationToken } from './githubAppAuth';
import { createGitHubTokenProvider } from '../providers/github/githubTokenProvider';
import { REPO_ROOT, TARGET_REPOS_DIR, GITHUB_PAT } from '../core/environment';
import { log } from '../core/utils';
import type { RepoIdentifier } from '../providers/types';

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
// Token provider construction
// ---------------------------------------------------------------------------

/**
 * The GitHub implementation of the TokenProvider port, resolved afresh on
 * every command. `alternateIdentityPat` is caller-supplied — only
 * `gitContextForRepo` sets it, reproducing today's asymmetry where
 * `gitContextForSync` has no PAT to serve an elevated request with (see
 * module notes on `gitContextForRepo`).
 */
function buildTokenProvider(alternateIdentityPat?: string): TokenProvider {
  return createGitHubTokenProvider({
    pat: GITHUB_PAT,
    alternateIdentityPat,
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
  const gitIdentity = resolveBootstrapGitIdentity();
  const options: GitContextOptions = {
    owner,
    repo,
    selfHost,
    // No alternateIdentityPat: this factory has never set GitContextOptions.pat,
    // so an elevated request here falls back to the resolved token, unchanged.
    tokenProvider: buildTokenProvider(),
    gitIdentity,
    frameworkRepoRoot: REPO_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
  };
  return new GitContext(options, { logger: log });
}

/** Returns a fresh GitContext for the given repo. */
export function gitContextForRepo(repoInfo: RepoIdentifier, opts?: { selfHost?: boolean }): GitContext {
  const { owner, repo } = repoInfo;
  const gitIdentity = resolveBootstrapGitIdentity();
  const sh = getSelfHostIdentity();
  const selfHost = opts?.selfHost ?? (owner === sh.owner && repo === sh.repo && !!sh.owner);
  return new GitContext({
    owner, repo, selfHost, gitIdentity,
    frameworkRepoRoot: REPO_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
    // GITHUB_PAT plays both roles here: a resolution-order candidate after the
    // App mint, and the credential served to alternateIdentity requests
    // (PR approval, Projects V2 writes) — preserving this factory's existing
    // asymmetry with gitContextForSync exactly.
    tokenProvider: buildTokenProvider(GITHUB_PAT),
  }, { logger: log });
}
