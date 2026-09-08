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

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { gitContextForRepo } from '../github/gitContextFactory';

import {
  type BoardManager,
  type BoundProviders,
  type CodeHost,
  type IssueTracker,
  type RepoContext,
  type RepoIdentifier,
  Platform,
  validateRepoIdentifier,
} from './types';
import { createGitHubIssueTracker } from './github/githubIssueTracker';
import { createGitHubCodeHost } from './github/githubCodeHost';
import { createGitHubBoardManager } from './github/githubBoardManager';
import { createGitLabCodeHost } from './gitlab/gitlabCodeHost';
import type { GitLabConfig } from './gitlab/gitlabApiClient';
import type { JiraAuth } from './jira/jiraApiClient';
import type { ProvidersConfig } from '../core/projectConfig';
import { GITLAB_TOKEN, GITLAB_INSTANCE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PAT } from '../core/environment';
import { log } from '../core/logger';
import { validateWorkingDirectory, parseOwnerRepoFromUrl } from './workspaceValidation';

export { validateWorkingDirectory, parseOwnerRepoFromUrl } from './workspaceValidation';

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
  codeHostPlatform: Platform;
  issueTrackerPlatform: Platform;
}

/** Provider platform configuration read from `.adw/providers.md`. */
export interface ProviderConfig {
  codeHost: Platform;
  codeHostUrl?: string;
  issueTracker: Platform;
  issueTrackerUrl?: string;
  issueTrackerProjectKey?: string;
}

const PLATFORM_VALUES = new Map<string, Platform>(
  Object.values(Platform).map((v) => [v.toLowerCase(), v]),
);

/**
 * Parses a platform string to its Platform enum value.
 * Case-insensitive. Throws on unknown values.
 */
function parsePlatform(value: string, section: string): Platform {
  const trimmed = value.trim().toLowerCase();
  const platform = PLATFORM_VALUES.get(trimmed);
  if (!platform) {
    throw new Error(
      `Unknown platform "${value.trim()}" in ${section} section of .adw/providers.md`,
    );
  }
  return platform;
}

/**
 * Loads provider configuration from `.adw/providers.md` in the working directory.
 * Returns GitHub defaults when the file is absent or sections are missing.
 */
export function loadProviderConfig(cwd: string): ProviderConfig {
  const configPath = join(cwd, '.adw', 'providers.md');
  const defaults: ProviderConfig = {
    codeHost: Platform.GitHub,
    issueTracker: Platform.GitHub,
  };

  if (!existsSync(configPath)) {
    return defaults;
  }

  const content = readFileSync(configPath, 'utf-8');
  const config = { ...defaults };

  const codeHostMatch = content.match(/^## Code Host\s*\n+(.+)/m);
  if (codeHostMatch) {
    config.codeHost = parsePlatform(codeHostMatch[1], '## Code Host');
  }

  const issueTrackerMatch = content.match(/^## Issue Tracker\s*\n+(.+)/m);
  if (issueTrackerMatch) {
    config.issueTracker = parsePlatform(
      issueTrackerMatch[1],
      '## Issue Tracker',
    );
  }

  const codeHostUrlMatch = content.match(/^## Code Host URL\s*\n+(.+)/m);
  if (codeHostUrlMatch) {
    config.codeHostUrl = codeHostUrlMatch[1].trim();
  }

  const issueTrackerUrlMatch = content.match(/^## Issue Tracker URL\s*\n+(.+)/m);
  if (issueTrackerUrlMatch) {
    config.issueTrackerUrl = issueTrackerUrlMatch[1].trim();
  }

  const projectKeyMatch = content.match(/^## Issue Tracker Project Key\s*\n+(.+)/m);
  if (projectKeyMatch) {
    config.issueTrackerProjectKey = projectKeyMatch[1].trim();
  }

  return config;
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

/**
 * Resolves an IssueTracker implementation for the given platform.
 */
export function resolveIssueTracker(
  platform: Platform,
  repoId: RepoIdentifier,
): IssueTracker {
  if (platform === Platform.GitHub) {
    return createGitHubIssueTracker(repoId);
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
 * Resolves a CodeHost implementation for the given platform.
 */
export function resolveCodeHost(
  platform: Platform,
  repoId: RepoIdentifier,
): CodeHost {
  if (platform === Platform.GitHub) {
    return createGitHubCodeHost(repoId);
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
): BoardManager {
  if (platform === Platform.GitHub) {
    return createGitHubBoardManager(repoId);
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
  const { repoId, codeHostPlatform, issueTrackerPlatform } = options;

  validateRepoIdentifier(repoId);

  const issueTracker = resolveIssueTracker(issueTrackerPlatform, repoId);
  const codeHost = resolveCodeHost(codeHostPlatform, repoId);

  let boardManager: BoardManager | undefined;
  try {
    boardManager = resolveBoardManager(codeHostPlatform, repoId);
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
    ?? mintBoundProviders({ repoId, ...resolvePlatformSelection(options, cwd) });

  return Object.freeze({ ...providers, cwd, repoId });
}
