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
 *
 * Since #794, the boundary also mints the forge provider triple (IssueTracker /
 * CodeHost / BoardManager) bound to the SAME identity the GitContext receives, in
 * the same call — see `buildLaunchBoundary`. `buildLaunchGitContext` is now the
 * context-only view of that one call.
 */

import { GitContext } from '../gitContext';
import type { GitIdentity, TokenProvider } from '../gitContext';
import type { TargetRepoInfo } from '../types/issueTypes';
import type { RepoInfo } from '../github/githubApi';
import { getRepoInfo } from '../github/githubApi';
import { resolveBootstrapGitIdentity } from '../providers/github/githubIdentity';
import { ghAuthToken } from '../providers/github/ghAuthToken';
import { isGitHubAppConfigured, getInstallationToken } from '../github/githubAppAuth';
import { resolveContextToken } from '../providers/github/tokenResolver';
import { createGitHubTokenProvider } from '../providers/github/githubTokenProvider';
// Deep imports only — never the `../providers` barrel, which re-exports the
// GitHub adapter and closes an import cycle back through `../../core` (#792).
import { mintBoundProviders, loadProviderConfig, createRepoContext, type MintProvidersOptions, type ProviderConfig } from '../providers/repoContext';
import type { BoundProviders, RepoContext, RepoIdentifier } from '../providers/types';
import { Platform } from '../providers/types';
import { REPO_ROOT, TARGET_REPOS_DIR, GITHUB_PAT } from './environment';
import { log } from './utils';
import { sameRepoIdentity } from './repoIdentityCrossCheck';

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
  /** The RepoIdentifier's declared platform. Defaults to Platform.GitHub (matches buildRepoIdentifier). */
  platform?: Platform;
  /** Loads provider platform selection for a workspace directory. Defaults to loadProviderConfig from providers/repoContext. */
  loadProviderConfig?: (dir: string) => ProviderConfig;
  /** Mints the bound provider triple. Defaults to mintBoundProviders from providers/repoContext. */
  mintProviders?: (options: MintProvidersOptions) => BoundProviders;
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
 * The result of one launch-boundary call: a GitContext and the forge provider
 * triple bound to the SAME `{owner, repo}` identity, resolved exactly once.
 * Frozen — neither field can be re-pointed at another repository after the
 * boundary hands the result over.
 */
export interface LaunchBoundary {
  readonly gitContext: GitContext;
  /** The boundary's repo identity — the same owner/repo the GitContext carries. */
  readonly repoId: RepoIdentifier;
  /** Providers bound to `repoId`. Minted on first access, then memoised. */
  readonly providers: BoundProviders;
}

/**
 * Freezes a `LaunchBoundary`, deferring provider minting to first access via a
 * memoised getter. Deferral keeps the boundary CALL free of the provider
 * config's I/O and its throw-on-unrecognised-platform failure mode — both
 * would otherwise land before a not-yet-cloned target workspace exists (see
 * `buildLaunchBoundary`'s doc comment).
 */
function freezeBoundary(gitContext: GitContext, repoId: RepoIdentifier, mint: () => BoundProviders): LaunchBoundary {
  let minted: BoundProviders | undefined;
  return Object.freeze({
    gitContext,
    repoId,
    get providers(): BoundProviders {
      return (minted ??= mint());
    },
  });
}

/**
 * Builds exactly one GitContext from the process launch identity, and mints
 * the forge provider triple bound to that SAME identity, in the same call.
 * `{owner, repo}` is resolved exactly once and fed to both — no second read
 * of `--target-repo` or the local git remote for the providers.
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
 * resolution on the clock while this function runs is the context's own
 * construction-time validating probe — its answer is discarded, and every
 * command the returned context runs resolves a fresh credential.
 *
 * Providers are minted LAZILY, on first access to `.providers`, and memoised:
 * building the boundary performs no provider-config read and cannot fail
 * because of one. Provider platform selection still comes from
 * `.adw/providers.md`, read from `gitContext.basePath` — the identity-derived
 * workspace path, never a caller-supplied `cwd` — via `deps.loadProviderConfig`
 * (defaults to `loadProviderConfig`). Selection is then handed to
 * `deps.mintProviders` (defaults to `mintBoundProviders`), which refuses an
 * unimplemented or unparseable platform BY NAME rather than substituting
 * GitHub — the same refusal `createRepoContext` raises today, surfacing at the
 * same moment: the first provider request, not the boundary call.
 */
export function buildLaunchBoundary(
  targetRepo: TargetRepoInfo | null,
  deps: LaunchGitContextDeps = {},
): LaunchBoundary {
  const getInfo = deps.getRepoInfo ?? getRepoInfo;
  const resolveIdentity = deps.resolveGitIdentity ?? resolveLaunchGitIdentity;
  const frameworkRepoRoot = deps.frameworkRepoRoot ?? REPO_ROOT;
  const targetReposDir = deps.targetReposDir ?? TARGET_REPOS_DIR;
  const tokenProvider = deps.tokenProvider
    ?? (deps.resolveToken ? tokenProviderFromResolver(deps.resolveToken) : createLaunchTokenProvider());
  const loadConfig = deps.loadProviderConfig ?? loadProviderConfig;
  const mint = deps.mintProviders ?? mintBoundProviders;
  const platform = deps.platform ?? Platform.GitHub;

  const selfHost = targetRepo === null;
  const { owner, repo } = targetRepo ?? getInfo();

  const gitContext = new GitContext({
    owner,
    repo,
    selfHost,
    tokenProvider,
    gitIdentity: resolveIdentity(),
    frameworkRepoRoot,
    targetReposDir,
  }, { logger: log });
  const repoId: RepoIdentifier = { owner, repo, platform };

  return freezeBoundary(gitContext, repoId, () => {
    const config = loadConfig(gitContext.basePath);
    return mint({ repoId, codeHostPlatform: config.codeHost, issueTrackerPlatform: config.issueTracker });
  });
}

/**
 * The context-only view of a `buildLaunchBoundary` call — unchanged behaviour
 * for every existing caller. Building a context this way performs no
 * provider-config read and gains no new failure mode: it is exactly what this
 * function did before providers existed.
 */
export function buildLaunchGitContext(
  targetRepo: TargetRepoInfo | null,
  deps: LaunchGitContextDeps = {},
): GitContext {
  return buildLaunchBoundary(targetRepo, deps).gitContext;
}

/**
 * Binds the boundary's providers to a validated workspace directory —
 * `createRepoContext({ repoId, cwd, providers: boundary.providers })`, the
 * same cwd/`origin` validation as today, from the one file the guard
 * sanctions. `repoId` (default: the boundary's) must name the boundary's
 * repository — a caller-supplied identity for a DIFFERENT repository is
 * refused rather than silently handed providers bound to the wrong one.
 */
export function bindWorkspaceContext(
  boundary: LaunchBoundary,
  cwd: string,
  repoId: RepoIdentifier = boundary.repoId,
): RepoContext {
  if (!sameRepoIdentity(repoId, boundary.repoId)) {
    throw new Error(
      `bindWorkspaceContext: ${repoId.owner}/${repoId.repo} does not match the launch boundary's ${boundary.repoId.owner}/${boundary.repoId.repo}`,
    );
  }
  return createRepoContext({ repoId, cwd, providers: boundary.providers });
}
