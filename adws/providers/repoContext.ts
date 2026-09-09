/**
 * RepoContext factory with entry-point validation.
 *
 * Constructs an immutable, validated RepoContext at workflow entry points,
 * replacing the mutable global singleton in targetRepoRegistry.ts.
 *
 * Also the transitional home of ADW's environment→config wiring for the
 * GitLab and Jira adapters (#818); `forgeProviders()` (#823) replaces this
 * file and moves that wiring to `adws/core/`.
 */

import { gitContextForRepo } from '../github/gitContextFactory';
import type { GitContext } from '../gitContext';
import { notifyReviewTransition, type NotifierDeps } from '../github/hitlBoardNotifier';
import { resolveAdwLabelDefinition } from '../core/adwLabels';
import { isGitHubAppConfigured } from '../core/githubAppAuth';

import {
  type BoardManager,
  type BoundProviders,
  type CodeHost,
  type IssueTracker,
  type RepoContext,
  type RepoIdentifier,
  BoardStatus,
  Platform,
  validateRepoIdentifier,
} from './types';
import { createGitHubIssueTracker, type GitHubIssueTrackerDeps } from './github/githubIssueTracker';
import { createGitHubCodeHost } from './github/githubCodeHost';
import { createGitHubBoardManager } from './github/githubBoardManager';
import { createGhRepoApi } from './github/ghRepoApi';
import { createGitLabCodeHost } from './gitlab/gitlabCodeHost';
import type { GitLabConfig } from './gitlab/gitlabApiClient';
import type { JiraAuth } from './jira/jiraApiClient';
import type { ProvidersConfig } from '../core/projectConfig';
import { GITLAB_TOKEN, GITLAB_INSTANCE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PAT, GITHUB_PAT } from '../core/environment';
import { log } from '../core/logger';
import { validateWorkingDirectory, parseOwnerRepoFromUrl } from './workspaceValidation';
import { loadProviderConfig, parsePlatform } from '../core/providerConfig';

export { validateWorkingDirectory, parseOwnerRepoFromUrl } from './workspaceValidation';
export { loadProviderConfig } from '../core/providerConfig';
export type { ProviderConfig } from '../core/providerConfig';

/** Options for creating a RepoContext. */
export interface RepoContextOptions {
  repoId: RepoIdentifier;
  cwd: string;
  codeHostPlatform?: Platform;
  issueTrackerPlatform?: Platform;
  providersConfig?: ProvidersConfig;
  /** Boundary-minted providers. When supplied, resolution is skipped and these instances are reused. */
  providers?: BoundProviders;
}

/** Options for {@link mintBoundProviders}. */
export interface MintProvidersOptions {
  repoId: RepoIdentifier;
  /** The boundary's context — every GitHub provider runs its `gh` commands over this, never one it constructs itself. */
  gitContext: GitContext;
  codeHostPlatform: Platform;
  issueTrackerPlatform: Platform;
}

/**
 * Validates that the git remote `origin` in the working directory matches
 * the declared RepoIdentifier (case-insensitive owner/repo comparison).
 */
export function validateGitRemote(cwd: string, repoId: RepoIdentifier): void {
  let remoteUrl: string;
  try {
    remoteUrl = gitContextForRepo(repoId).remoteUrl(cwd);
  } catch {
    throw new Error(
      `Failed to get git remote URL in ${cwd}. Ensure the repository has an 'origin' remote configured.`,
    );
  }

  const parsed = parseOwnerRepoFromUrl(remoteUrl);
  if (!parsed) {
    throw new Error(
      `Could not parse owner/repo from git remote URL: ${remoteUrl}`,
    );
  }

  if (parsed.owner.toLowerCase() !== repoId.owner.toLowerCase()) {
    throw new Error(
      `Git remote does not match declared repo. Remote owner "${parsed.owner}" !== declared owner "${repoId.owner}"`,
    );
  }

  if (parsed.repo.toLowerCase() !== repoId.repo.toLowerCase()) {
    throw new Error(
      `Git remote does not match declared repo. Remote repo "${parsed.repo}" !== declared repo "${repoId.repo}"`,
    );
  }
}

/** Injected reader/lister for the HITL Slack notifier, over the SAME context the tracker runs its `gh` commands on — ADW's wiring, not the adapter's; the notifier module stays untouched. */
function buildNotifierDeps(ctx: GitContext, repoId: RepoIdentifier): NotifierDeps {
  const gh = createGhRepoApi(ctx);
  return {
    readIssue: (issueNumber) => {
      try {
        const raw = JSON.parse(gh.fetchIssue(issueNumber)) as { title: string; labels: { name: string }[] };
        return { title: raw.title, labels: raw.labels };
      } catch {
        return null;
      }
    },
    listOpenPRs: () => {
      try {
        const allPrs = JSON.parse(gh.fetchAllPRs()) as Array<{ number: number; body: string; state: string }>;
        return allPrs
          .filter((p) => p.state === 'OPEN')
          .map((p) => ({
            number: p.number,
            url: `https://github.com/${repoId.owner}/${repoId.repo}/pull/${p.number}`,
            body: p.body,
            state: p.state,
            headRefName: '',
            baseRefName: '',
            updatedAt: '',
          }));
      } catch {
        return null;
      }
    },
  };
}

/** Re-exported so `repoContext.test.ts` and `adwGitHubIssueTrackerDeps`'s existing callers keep resolving; the definition itself lives in `adws/core/adwLabels.ts` since #820. */
export { resolveAdwLabelDefinition } from '../core/adwLabels';

/**
 * ADW wiring (#819): the HITL Slack ping on a move to Review, and the `adw:*`
 * lazy-create catalogue, re-homed as injected seams so the adapter itself
 * never learns about Slack or about ADW's label colours. Relocates to
 * `adws/core/` with #823.
 */
export function adwGitHubIssueTrackerDeps(repoId: RepoIdentifier, ctx: GitContext): GitHubIssueTrackerDeps {
  const notifierDeps = buildNotifierDeps(ctx, repoId);
  return {
    logger: log,
    onStatusMoved: async (issueNumber, status) => {
      if (status === BoardStatus.Review) {
        await notifyReviewTransition({ issueNumber, repoInfo: repoId }, notifierDeps);
      }
    },
    resolveLabelDefinition: resolveAdwLabelDefinition,
  };
}

/**
 * Resolves an IssueTracker implementation for the given platform.
 */
export function resolveIssueTracker(
  platform: Platform,
  repoId: RepoIdentifier,
  ctx: GitContext,
): IssueTracker {
  if (platform === Platform.GitHub) {
    return createGitHubIssueTracker(ctx, repoId, adwGitHubIssueTrackerDeps(repoId, ctx));
  }
  throw new Error(`Unsupported issue tracker platform: ${platform}`);
}

/** The GitLab/Jira variables ADW's environment supplies (#818) — a value, so the wiring below is pure and testable without mocking. */
export type ForgeEnv = Readonly<Record<'GITLAB_TOKEN' | 'GITLAB_INSTANCE_URL' | 'JIRA_EMAIL' | 'JIRA_API_TOKEN' | 'JIRA_PAT', string>>;

const ADW_FORGE_ENV: ForgeEnv = { GITLAB_TOKEN, GITLAB_INSTANCE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PAT };

/** ADW wiring (#818): the GitLab adapter's injected config from the environment; the operator-facing message stays here. Relocates to adws/core with #823. */
export function gitLabConfigFromEnv(env: ForgeEnv = ADW_FORGE_ENV): GitLabConfig {
  if (!env.GITLAB_TOKEN) {
    throw new Error('GITLAB_TOKEN environment variable is required for GitLab code host. Set it in your .env file.');
  }
  return { token: env.GITLAB_TOKEN, instanceUrl: env.GITLAB_INSTANCE_URL };
}

/** ADW wiring (#818): Jira auth from the environment — Cloud (email + API token) first, then a Data Center PAT. No production caller until forgeProviders() (#823): Platform has no Jira member and adding one is new capability. */
export function jiraAuthFromEnv(env: ForgeEnv = ADW_FORGE_ENV): JiraAuth {
  if (env.JIRA_EMAIL && env.JIRA_API_TOKEN) return { email: env.JIRA_EMAIL, apiToken: env.JIRA_API_TOKEN };
  if (env.JIRA_PAT) return { pat: env.JIRA_PAT };
  throw new Error('Jira authentication not configured. Set JIRA_EMAIL + JIRA_API_TOKEN (Cloud) or JIRA_PAT (Data Center/Server).');
}

/**
 * Resolves a CodeHost implementation for the given platform. GitLab's
 * branch does not need `ctx` — its client carries its own injected config.
 */
export function resolveCodeHost(
  platform: Platform,
  repoId: RepoIdentifier,
  ctx: GitContext,
): CodeHost {
  if (platform === Platform.GitHub) {
    return createGitHubCodeHost(ctx, repoId, {
      logger: log,
      canApprovePullRequests: () => isGitHubAppConfigured() && Boolean(GITHUB_PAT),
    });
  }
  if (platform === Platform.GitLab) {
    return createGitLabCodeHost(repoId, gitLabConfigFromEnv(), { logger: log });
  }
  throw new Error(`Unsupported code host platform: ${platform}`);
}

/**
 * Resolves a BoardManager implementation for the given code host platform.
 * BoardManager is resolved from the code host platform, not the issue tracker.
 */
export function resolveBoardManager(
  platform: Platform,
  repoId: RepoIdentifier,
  ctx: GitContext,
): BoardManager {
  if (platform === Platform.GitHub) {
    return createGitHubBoardManager(ctx, repoId, { logger: log });
  }
  throw new Error(`Unsupported board manager platform: ${platform}`);
}

/**
 * Resolves which platform implements the code host and issue tracker, in
 * precedence order: explicit options, then an injected `providersConfig`,
 * then `.adw/providers.md` in `cwd`.
 */
function resolvePlatformSelection(
  options: Pick<RepoContextOptions, 'codeHostPlatform' | 'issueTrackerPlatform' | 'providersConfig'>,
  cwd: string,
): { codeHostPlatform: Platform; issueTrackerPlatform: Platform } {
  if (options.codeHostPlatform !== undefined && options.issueTrackerPlatform !== undefined) {
    return { codeHostPlatform: options.codeHostPlatform, issueTrackerPlatform: options.issueTrackerPlatform };
  }
  if (options.providersConfig) {
    return {
      codeHostPlatform: options.codeHostPlatform ?? parsePlatform(options.providersConfig.codeHost, '## Code Host'),
      issueTrackerPlatform: options.issueTrackerPlatform ?? parsePlatform(options.providersConfig.issueTracker, '## Issue Tracker'),
    };
  }
  const config = loadProviderConfig(cwd);
  return {
    codeHostPlatform: options.codeHostPlatform ?? config.codeHost,
    issueTrackerPlatform: options.issueTrackerPlatform ?? config.issueTracker,
  };
}

/**
 * Mints the frozen provider triple bound to `repoId`. No filesystem, no git, no
 * network — safe to call before any workspace exists. A platform with no
 * implementation is refused BY NAME, never substituted with GitHub.
 */
export function mintBoundProviders(options: MintProvidersOptions): BoundProviders {
  const { repoId, gitContext, codeHostPlatform, issueTrackerPlatform } = options;

  validateRepoIdentifier(repoId);

  const issueTracker = resolveIssueTracker(issueTrackerPlatform, repoId, gitContext);
  const codeHost = resolveCodeHost(codeHostPlatform, repoId, gitContext);

  let boardManager: BoardManager | undefined;
  try {
    boardManager = resolveBoardManager(codeHostPlatform, repoId, gitContext);
  } catch {
    // BoardManager is optional — platforms without support simply omit it
  }

  return Object.freeze({ issueTracker, codeHost, boardManager });
}

/**
 * Creates an immutable, validated RepoContext. Validates the repo identifier,
 * working directory, and git remote, then reuses caller-supplied `providers`
 * (boundary-minted) or mints a fresh set, and returns a frozen context object.
 */
export function createRepoContext(options: RepoContextOptions): RepoContext {
  const { repoId, cwd } = options;

  validateRepoIdentifier(repoId);
  validateWorkingDirectory(cwd);
  validateGitRemote(cwd, repoId);

  const providers = options.providers
    ?? mintBoundProviders({ repoId, gitContext: gitContextForRepo(repoId), ...resolvePlatformSelection(options, cwd) });

  return Object.freeze({ ...providers, cwd, repoId });
}
