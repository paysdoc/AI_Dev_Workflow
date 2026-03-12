/**
 * RepoContext factory with entry-point validation.
 *
 * Constructs an immutable, validated RepoContext at workflow entry points,
 * replacing the mutable global singleton in targetRepoRegistry.ts.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

import {
  type CodeHost,
  type IssueTracker,
  type RepoContext,
  type RepoIdentifier,
  Platform,
  validateRepoIdentifier,
} from './types';
import { createGitHubIssueTracker } from './github/githubIssueTracker';
import { createGitHubCodeHost } from './github/githubCodeHost';
import { createGitLabCodeHost } from './gitlab/gitlabCodeHost';
import type { ProvidersConfig } from '../core/projectConfig';

/**
 * Options for creating a RepoContext.
 */
export interface RepoContextOptions {
  repoId: RepoIdentifier;
  cwd: string;
  codeHostPlatform?: Platform;
  issueTrackerPlatform?: Platform;
  providersConfig?: ProvidersConfig;
}

/**
 * Provider platform configuration read from `.adw/providers.md`.
 */
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
 * Validates that the working directory exists and contains a `.git` directory.
 */
export function validateWorkingDirectory(cwd: string): void {
  if (!existsSync(cwd)) {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }

  const stat = statSync(cwd);
  if (!stat.isDirectory()) {
    throw new Error(`Working directory is not a directory: ${cwd}`);
  }

  if (!existsSync(join(cwd, '.git'))) {
    throw new Error(
      `Working directory is not a git repository (no .git found): ${cwd}`,
    );
  }
}

/**
 * Parses owner and repo from a git remote URL.
 * Supports HTTPS and SSH URLs for any host (GitHub, GitLab, Bitbucket, etc.).
 */
export function parseOwnerRepoFromUrl(
  remoteUrl: string,
): { owner: string; repo: string } | null {
  // HTTPS: https://hostname/owner/repo.git or https://hostname/owner/repo
  const httpsMatch = remoteUrl.match(/https?:\/\/[^/]+\/([^/]+)\/([^/.]+)/);
  // SSH: git@hostname:owner/repo.git or git@hostname:owner/repo
  const sshMatch = remoteUrl.match(/git@[^:]+:([^/]+)\/([^/.]+)/);
  const match = httpsMatch || sshMatch;
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Validates that the git remote `origin` in the working directory matches
 * the declared RepoIdentifier (case-insensitive owner/repo comparison).
 */
export function validateGitRemote(cwd: string, repoId: RepoIdentifier): void {
  let remoteUrl: string;
  try {
    remoteUrl = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
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
    return createGitLabCodeHost(repoId);
  }
  throw new Error(`Unsupported code host platform: ${platform}`);
}

/**
 * Creates an immutable, validated RepoContext.
 *
 * Validates the repo identifier, working directory, and git remote,
 * then resolves provider instances and returns a frozen context object.
 */
export function createRepoContext(options: RepoContextOptions): RepoContext {
  const { repoId, cwd } = options;

  validateRepoIdentifier(repoId);
  validateWorkingDirectory(cwd);
  validateGitRemote(cwd, repoId);

  let codeHostPlatform: Platform;
  let issueTrackerPlatform: Platform;

  if (options.codeHostPlatform !== undefined && options.issueTrackerPlatform !== undefined) {
    codeHostPlatform = options.codeHostPlatform;
    issueTrackerPlatform = options.issueTrackerPlatform;
  } else if (options.providersConfig) {
    codeHostPlatform = options.codeHostPlatform ?? parsePlatform(options.providersConfig.codeHost, '## Code Host');
    issueTrackerPlatform = options.issueTrackerPlatform ?? parsePlatform(options.providersConfig.issueTracker, '## Issue Tracker');
  } else {
    const config = loadProviderConfig(cwd);
    codeHostPlatform = options.codeHostPlatform ?? config.codeHost;
    issueTrackerPlatform = options.issueTrackerPlatform ?? config.issueTracker;
  }

  const issueTracker = resolveIssueTracker(issueTrackerPlatform, repoId);
  const codeHost = resolveCodeHost(codeHostPlatform, repoId);

  return Object.freeze({ issueTracker, codeHost, cwd, repoId });
}
