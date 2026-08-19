/**
 * Boundary-constructor adapter — builds exactly one GitContext at a process launch boundary.
 *
 * Lives in adws/core/ (not adws/gitContext/) so the gitContext package stays free of
 * ADW-global dependencies. The gitContext package is a pure, dependency-injectable
 * deep module; this adapter is the ADW-specific wiring layer.
 *
 * All raw git/gh has been absorbed into the `adws/gitContext/` package (issue #700).
 * `resolveLaunchToken` delegates to `resolveContextToken` with no ambient-global
 * fallback — the GH_TOKEN-bleed root fix. Since #791, the built context is handed
 * a TokenProvider — the QUESTION, not a resolved answer — so a GitHub App
 * installation token minted at launch is never replayed, stale, hours into a
 * long-running orchestrator; `resolveLaunchToken` documents the resolution order
 * but is no longer itself the construction path.
 */

import { GitContext } from '../gitContext';
import type { GitIdentity, TokenProvider } from '../gitContext';
import type { TargetRepoInfo } from '../types/issueTypes';
import type { RepoInfo } from '../github/githubApi';
import { getRepoInfo } from '../github/githubApi';
import {
  isGitHubAppConfigured,
  getInstallationToken,
  resolveContextToken,
  resolveBootstrapGitIdentity,
  ghAuthToken,
  createGitHubTokenProvider,
} from '../gitContext';
import { REPO_ROOT, TARGET_REPOS_DIR, GITHUB_PAT } from './environment';

/**
 * Injectable seams for buildLaunchGitContext. All fields are optional;
 * production defaults are applied if omitted.
 */
export interface LaunchGitContextDeps {
  /** Returns the local git remote owner/repo. Defaults to getRepoInfo() from ../github. */
  getRepoInfo?: (cwd?: string) => RepoInfo;
  /**
   * Returns a non-empty GitHub token for the given owner/repo. Adapted into a
   * TokenProvider when `tokenProvider` is not supplied — so injecting this
   * still yields per-command resolution, one call per command. Defaults to
   * `createLaunchTokenProvider()` when neither is supplied.
   */
  resolveToken?: (owner: string, repo: string) => string;
  /** The supported credential path. Takes precedence over `resolveToken` when both are supplied. */
  tokenProvider?: TokenProvider;
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
 *
 * Documents the resolution order; no longer itself the construction path — see
 * `createLaunchTokenProvider`.
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
 * The production TokenProvider for the launch boundary — the GitHub
 * implementation of the port, resolved afresh on every command. Carries no
 * `alternateIdentityPat`: `buildLaunchGitContext` has never set a PAT on
 * `GitContextOptions.pat`, so adding one here would be a behaviour change,
 * not a refactor.
 */
export function createLaunchTokenProvider(): TokenProvider {
  return createGitHubTokenProvider({
    pat: GITHUB_PAT,
    isAppConfigured: isGitHubAppConfigured,
    mintInstallationToken: getInstallationToken,
    ghAuthToken,
  });
}

/** Adapts the `resolveToken` injection seam into a TokenProvider — one resolution per command, exactly as a native provider. */
function tokenProviderFromResolver(resolveToken: (owner: string, repo: string) => string): TokenProvider {
  return {
    credentialEnv: ({ owner, repo }) => ({ GH_TOKEN: resolveToken(owner, repo) }),
  };
}

/**
 * Builds exactly one GitContext from the process launch identity.
 *
 * When `targetRepo` is non-null (i.e., `--target-repo` was present), builds a
 * TARGET context whose base path is `join(targetReposDir, owner, repo)`.
 * When `targetRepo` is null, builds a SELF-HOST context whose base path is
 * `frameworkRepoRoot`, with owner/repo taken from the local git remote via
 * `deps.getRepoInfo()`.
 *
 * Hands the context a TokenProvider, never a resolved credential string —
 * `deps.tokenProvider` takes precedence, then `deps.resolveToken` adapted into
 * a provider, then the production `createLaunchTokenProvider()`. The only
 * resolution on the clock
 * while this function runs is the context's own construction-time validating
 * probe — its answer is discarded, and every command the returned context runs
 * resolves a fresh credential.
 */
export function buildLaunchGitContext(
  targetRepo: TargetRepoInfo | null,
  deps: LaunchGitContextDeps = {},
): GitContext {
  const getInfo = deps.getRepoInfo ?? getRepoInfo;
  const resolveIdentity = deps.resolveGitIdentity ?? resolveLaunchGitIdentity;
  const frameworkRepoRoot = deps.frameworkRepoRoot ?? REPO_ROOT;
  const targetReposDir = deps.targetReposDir ?? TARGET_REPOS_DIR;
  const tokenProvider = deps.tokenProvider
    ?? (deps.resolveToken ? tokenProviderFromResolver(deps.resolveToken) : createLaunchTokenProvider());

  const selfHost = targetRepo === null;
  const { owner, repo } = targetRepo ?? getInfo();

  return new GitContext({
    owner,
    repo,
    selfHost,
    tokenProvider,
    gitIdentity: resolveIdentity(),
    frameworkRepoRoot,
    targetReposDir,
  });
}
