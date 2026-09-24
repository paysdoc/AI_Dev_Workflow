/**
 * ADW's wiring layer over `@paysdoc/devplatform` — the one place identity is
 * resolved, credentials are minted (`createForgeCredentials`) and the one
 * `GitContext` plus its bound provider triple are constructed. This is the
 * only sanctioned construction site (see `adws/guard/constructionRule.ts`).
 *
 * Since #791, the built context is handed a TokenProvider — the QUESTION,
 * not a resolved answer — so a GitHub App installation token minted at
 * launch is never replayed, stale, hours into a long-running orchestrator.
 *
 * Since #794, the boundary also mints the forge provider triple (IssueTracker /
 * CodeHost / BoardManager) bound to the SAME identity the GitContext receives, in
 * the same call — see `buildLaunchBoundary`. `buildLaunchGitContext` is now the
 * context-only view of that one call. Since #823 the boundary constructs its one
 * `GitContext` directly and assembles the providers through the library's
 * `forgeProviders()` — ADW's own wiring (environment reads, the GitHub Slack/label
 * seams) lives in `forgeWiring.ts`; workspace binding lives in `workspaceBinding.ts`.
 */

import { GitContext } from '@paysdoc/devplatform/git';
import type { GitIdentity, TokenProvider } from '@paysdoc/devplatform/git';
import type { TargetRepoInfo } from '../types/issueTypes';
import { readLocalRepoIdentity } from './localRepoIdentity';
import { readGitHubAppConfig } from './githubAppAuth';
import {
  createForgeCredentials,
  forgeProviders,
  type ForgeCredentials,
  type ForgeCredentialsOptions,
  type ForgeSelection,
  type ForgeProviderDeps,
  type ForgeProvidersOptions,
} from '@paysdoc/devplatform/providers';
import { buildAdwForgeDeps } from './forgeWiring';
import { loadProviderConfig, type ProviderConfig } from './providerConfig';
import type { BoundProviders, RepoIdentifier } from '@paysdoc/devplatform';
import { Platform } from '@paysdoc/devplatform';
import { REPO_ROOT, TARGET_REPOS_DIR, GITHUB_PAT } from './environment';
import { log } from './utils';

/**
 * Injectable seams for buildLaunchGitContext. All fields are optional;
 * production defaults are applied if omitted.
 */
export interface LaunchGitContextDeps {
  /** Returns the local git remote identity as a RepoIdentifier. Defaults to readLocalRepoIdentity(). */
  getRepoInfo?: (cwd?: string) => RepoIdentifier;
  /**
   * Returns a non-empty GitHub token for the given owner/repo. Adapted into a
   * TokenProvider when `tokenProvider` is not supplied — so injecting this
   * still yields per-command resolution, one call per command.
   */
  resolveToken?: (owner: string, repo: string) => string;
  /** The supported credential path. Takes precedence over `resolveToken` when both are supplied. */
  tokenProvider?: TokenProvider;
  /** Returns a complete git identity. */
  resolveGitIdentity?: () => GitIdentity;
  /** Absolute path to the ADW framework repo root. Defaults to REPO_ROOT. */
  frameworkRepoRoot?: string;
  /** Absolute path to the directory that houses cloned target repos. Defaults to TARGET_REPOS_DIR. */
  targetReposDir?: string;
  /** The RepoIdentifier's declared platform. Defaults to Platform.GitHub (matches buildRepoIdentifier). */
  platform?: Platform;
  /** Loads provider forge selection for a workspace directory. Defaults to loadProviderConfig from ./providerConfig. */
  loadProviderConfig?: (dir: string) => ProviderConfig;
  /** Assembles the bound provider triple. Defaults to the library's forgeProviders(). Deliberately a property-access seam, unflagged by the construction rule. */
  forgeProviders?: (options: ForgeProvidersOptions) => BoundProviders;
  /**
   * Builds ADW's ForgeProviderDeps (logger, GitHub seams, GitLab/Jira config) for the
   * selected forges. Defaults to buildAdwForgeDeps from ./forgeWiring. The third
   * argument is a thunk resolving to the boundary's own memoised `BoundProviders` —
   * invoked only at notification time (a status move), never during assembly, since
   * this function itself runs inside the lazy mint, before the providers it resolves
   * to exist.
   */
  forgeDeps?: (config: ProviderConfig, repoId: RepoIdentifier, resolveProviders: () => BoundProviders) => ForgeProviderDeps;
  /**
   * Mints the launch `TokenProvider` and bootstrap `GitIdentity` for whatever
   * the seams above did not supply. Defaults to the library's
   * `createForgeCredentials()`. Deliberately a property-access seam,
   * unflagged by the construction rule.
   */
  forgeCredentials?: (options: ForgeCredentialsOptions) => ForgeCredentials;
}

/** ADW's launch credentials are GitHub-keyed by convention — the same convention `readLocalRepoIdentity` uses for `platform: Platform.GitHub`. Provider forge selection still comes from `.adw/providers.md` at first `.providers` access (deferred, unchanged). */
const LAUNCH_CREDENTIAL_FORGE: ForgeSelection = { codeHost: 'github', issueTracker: 'github' };

/** The one place ADW's environment reaches the library's credential factory. `alternateIdentityPat = GITHUB_PAT` preserves #819 parity: `'alternateIdentity'` requests get the PAT, `'default'` requests resolve App token → PAT → `gh auth token`. */
export function launchCredentialsOptions(identity: RepoIdentifier): ForgeCredentialsOptions {
  return {
    forge: LAUNCH_CREDENTIAL_FORGE,
    identity,
    deps: {
      github: {
        appConfig: readGitHubAppConfig(),
        pat: GITHUB_PAT,
        alternateIdentityPat: GITHUB_PAT,
      },
    },
  };
}

/** Adapts the `resolveToken` injection seam into a TokenProvider — one resolution per command, exactly as a native provider. */
function tokenProviderFromResolver(resolveToken: (owner: string, repo: string) => string): TokenProvider {
  return {
    credentialEnv: ({ owner, repo }) => ({ GH_TOKEN: resolveToken(owner, repo) }),
  };
}

/**
 * Resolves the launch `TokenProvider` and bootstrap `GitIdentity`. When both
 * `deps.tokenProvider`/`deps.resolveToken` AND `deps.resolveGitIdentity` are
 * injected, returns them directly — no environment or `git config` read, so
 * every existing `baseDeps()` test stays hermetic. Otherwise mints whichever
 * is missing via `deps.forgeCredentials` (defaults to `createForgeCredentials`).
 */
function resolveLaunchCredentials(
  repoId: RepoIdentifier,
  deps: LaunchGitContextDeps,
): { tokenProvider: TokenProvider; gitIdentity: GitIdentity } {
  const injectedProvider = deps.tokenProvider
    ?? (deps.resolveToken ? tokenProviderFromResolver(deps.resolveToken) : undefined);
  const injectedIdentity = deps.resolveGitIdentity?.();

  if (injectedProvider && injectedIdentity) {
    return { tokenProvider: injectedProvider, gitIdentity: injectedIdentity };
  }

  const mint = deps.forgeCredentials ?? createForgeCredentials;
  const minted = mint(launchCredentialsOptions(repoId));
  return {
    tokenProvider: injectedProvider ?? minted.tokenProvider,
    gitIdentity: injectedIdentity ?? minted.gitIdentity,
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
 * see `resolveLaunchCredentials` for the injection/mint order. The only
 * resolution on the clock while this function runs is the context's own
 * construction-time validating probe — its answer is discarded, and every
 * command the returned context runs resolves a fresh credential.
 *
 * Providers are assembled LAZILY, on first access to `.providers`, and
 * memoised: building the boundary performs no provider-config read and
 * cannot fail because of one. Provider forge selection still comes from
 * `.adw/providers.md`, read from `gitContext.basePath` — the identity-derived
 * workspace path, never a caller-supplied `cwd` — via `deps.loadProviderConfig`
 * (defaults to `loadProviderConfig`). Selection is handed to `deps.forgeProviders`
 * (defaults to the library's `forgeProviders`), together with ADW's own wiring
 * built by `deps.forgeDeps` (defaults to `buildAdwForgeDeps`) — which refuses
 * an unimplemented or unparseable forge name BY NAME rather than substituting
 * GitHub, surfacing at the same moment as before: the first provider request,
 * not the boundary call.
 */
export function buildLaunchBoundary(
  targetRepo: TargetRepoInfo | null,
  deps: LaunchGitContextDeps = {},
): LaunchBoundary {
  const getInfo = deps.getRepoInfo ?? readLocalRepoIdentity;
  const frameworkRepoRoot = deps.frameworkRepoRoot ?? REPO_ROOT;
  const targetReposDir = deps.targetReposDir ?? TARGET_REPOS_DIR;
  const loadConfig = deps.loadProviderConfig ?? loadProviderConfig;
  const assemble = deps.forgeProviders ?? forgeProviders;
  const buildForgeDeps = deps.forgeDeps ?? buildAdwForgeDeps;
  const platform = deps.platform ?? Platform.GitHub;

  const selfHost = targetRepo === null;
  const { owner, repo } = targetRepo ?? getInfo();
  const repoId: RepoIdentifier = { owner, repo, platform };

  const { tokenProvider, gitIdentity } = resolveLaunchCredentials(repoId, deps);

  const gitContext = new GitContext({
    owner,
    repo,
    selfHost,
    tokenProvider,
    gitIdentity,
    frameworkRepoRoot,
    targetReposDir,
  }, { logger: log });

  // assembleProviders closes over a thunk (`() => boundary.providers`) that
  // resolves only once minting has completed — the notifier deps built by
  // buildForgeDeps need to read through the very providers this function is
  // still assembling. Safe: the closure is only invoked later (at
  // notification time), long after the `const boundary` below has
  // initialized.
  const assembleProviders = (): BoundProviders => {
    const config = loadConfig(gitContext.basePath);
    return assemble({
      forge: { codeHost: config.codeHost, issueTracker: config.issueTracker },
      identity: repoId,
      tokenProvider,
      gitContext,
      deps: buildForgeDeps(config, repoId, () => boundary.providers),
    });
  };

  const boundary = freezeBoundary(gitContext, repoId, assembleProviders);
  return boundary;
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
