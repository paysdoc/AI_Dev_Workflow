/**
 * Boundary-constructor adapter — builds exactly one GitContext at a process launch boundary.
 *
 * Lives in adws/core/ (not adws/gitContext/) so the gitContext package stays free of
 * ADW-global dependencies. The gitContext package is a pure, dependency-injectable
 * deep module; this adapter is the ADW-specific wiring layer.
 *
 * All raw git/gh has been absorbed into the `adws/gitContext/` package (issue #700).
 * `resolveLaunchToken` now delegates to `resolveContextToken` with no ambient-global
 * fallback — the GH_TOKEN-bleed root fix.
 */

import { GitContext } from '../gitContext';
import type { GitIdentity } from '../gitContext';
import type { TargetRepoInfo } from '../types/issueTypes';
import type { RepoInfo } from '../github/githubApi';
import { getRepoInfo } from '../github/githubApi';
import {
  isGitHubAppConfigured,
  getInstallationToken,
  resolveContextToken,
  resolveBootstrapGitIdentity,
  ghAuthToken,
} from '../gitContext';
import { REPO_ROOT, TARGET_REPOS_DIR, GITHUB_PAT } from './environment';

/**
 * Injectable seams for buildLaunchGitContext. All fields are optional;
 * production defaults are applied if omitted.
 */
export interface LaunchGitContextDeps {
  /** Returns the local git remote owner/repo. Defaults to getRepoInfo() from ../github. */
  getRepoInfo?: (cwd?: string) => RepoInfo;
  /** Returns a non-empty GitHub token for the given owner/repo. Defaults to resolveLaunchToken(). */
  resolveToken?: (owner: string, repo: string) => string;
  /** Returns a complete git identity. Defaults to resolveLaunchGitIdentity(). */
  resolveGitIdentity?: () => GitIdentity;
  /** Absolute path to the ADW framework repo root. Defaults to REPO_ROOT. */
  frameworkRepoRoot?: string;
  /** Absolute path to the directory that houses cloned target repos. Defaults to TARGET_REPOS_DIR. */
  targetReposDir?: string;
}

/**
 * Resolves a GitHub token for the given owner/repo via the veracious resolver.
 * No ambient-global (process.env.GH_TOKEN) fallback — that was the GH_TOKEN-bleed
 * vector (issue #700, PRD story 2). Throws loudly if no bound token is resolvable.
 */
export function resolveLaunchToken(owner: string, repo: string): string {
  return resolveContextToken({
    owner,
    repo,
    pat: GITHUB_PAT,
    isAppConfigured: isGitHubAppConfigured,
    mintInstallationToken: getInstallationToken,
    ghAuthToken,
  });
}

/**
 * Resolves a complete git author/committer identity.
 * Delegates to the absorbed package resolver (issue #700).
 */
export function resolveLaunchGitIdentity(): GitIdentity {
  return resolveBootstrapGitIdentity();
}

/**
 * Builds exactly one GitContext from the process launch identity.
 *
 * When `targetRepo` is non-null (i.e., `--target-repo` was present), builds a
 * TARGET context whose base path is `join(targetReposDir, owner, repo)`.
 * When `targetRepo` is null, builds a SELF-HOST context whose base path is
 * `frameworkRepoRoot`, with owner/repo taken from the local git remote via
 * `deps.getRepoInfo()`.
 */
export function buildLaunchGitContext(
  targetRepo: TargetRepoInfo | null,
  deps: LaunchGitContextDeps = {},
): GitContext {
  const getInfo = deps.getRepoInfo ?? getRepoInfo;
  const resolveToken = deps.resolveToken ?? resolveLaunchToken;
  const resolveIdentity = deps.resolveGitIdentity ?? resolveLaunchGitIdentity;
  const frameworkRepoRoot = deps.frameworkRepoRoot ?? REPO_ROOT;
  const targetReposDir = deps.targetReposDir ?? TARGET_REPOS_DIR;

  const selfHost = targetRepo === null;
  const { owner, repo } = targetRepo ?? getInfo();

  return new GitContext({
    owner,
    repo,
    selfHost,
    token: resolveToken(owner, repo),
    gitIdentity: resolveIdentity(),
    frameworkRepoRoot,
    targetReposDir,
  });
}
