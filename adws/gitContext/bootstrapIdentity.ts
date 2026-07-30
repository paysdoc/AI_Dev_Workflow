/**
 * Bootstrap identity resolution — absorbed into the gitContext package (issue #700).
 *
 * Pre-context git reads: the one legitimate permanent exception for raw git/gh
 * before a GitContext exists. Lives inside the structurally-exempt package so
 * the guard skips it by directory, not by allowlist.
 *
 * No ADW-global imports. All I/O is behind injectable seams for hermetic testing.
 */

import { execSync } from 'child_process';
import type { GitIdentity } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepoInfo {
  owner: string;
  repo: string;
}

export interface BootstrapIdentityDeps {
  exec?: (cmd: string, opts: { encoding: 'utf-8'; cwd?: string; stdio?: unknown }) => string;
  env?: NodeJS.ProcessEnv;
  isAppConfigured?: () => boolean;
}

// ---------------------------------------------------------------------------
// parseGitHubRemoteUrl
// ---------------------------------------------------------------------------

/**
 * HTTPS-style GitHub remote: `https://github.com/owner/repo[.git][/]`.
 * Also matches credential-bearing (`https://x-access-token:…@github.com/…`)
 * and `ssh://git@github.com/…` forms.
 *
 * The repo group is lazy and the pattern is end-anchored so the optional
 * `.git` strips a *trailing* suffix only — a greedy or dot-excluding group
 * would truncate dotted names such as `paysdoc.nl` (issue #779).
 */
const HTTPS_REMOTE_RE = /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

/** SCP-style SSH GitHub remote: `git@github.com:owner/repo[.git]`. */
const SSH_REMOTE_RE = /git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/;

/**
 * Parses `{ owner, repo }` out of a GitHub remote URL (HTTPS or SSH).
 * Returns null when the URL is not a parseable GitHub remote, leaving the
 * error contract to each caller.
 *
 * Pure — the single source of truth for GitHub remote-URL parsing.
 */
export function parseGitHubRemoteUrl(remoteUrl: string): RepoInfo | null {
  const url = remoteUrl.trim();
  const match = url.match(HTTPS_REMOTE_RE) ?? url.match(SSH_REMOTE_RE);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

// ---------------------------------------------------------------------------
// readLocalRepoInfo
// ---------------------------------------------------------------------------

/**
 * Reads the local git remote URL and parses owner/repo from it.
 * Supports both HTTPS and SSH GitHub URL formats.
 * Throws if the remote URL cannot be parsed.
 */
export function readLocalRepoInfo(cwd?: string): RepoInfo {
  try {
    const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8', cwd }).trim();
    const info = parseGitHubRemoteUrl(remoteUrl);
    if (!info) {
      throw new Error(`Could not parse GitHub URL: ${remoteUrl}`);
    }
    return info;
  } catch (error) {
    throw new Error(`Failed to get repo info: ${error}`);
  }
}

// ---------------------------------------------------------------------------
// ghAuthToken
// ---------------------------------------------------------------------------

/**
 * Returns the `gh auth token` output, or an empty string if gh is not available.
 * Exposed for use by the token resolver in bootstrap contexts.
 */
export function ghAuthToken(): string {
  try {
    return execSync('gh auth token', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// resolveBootstrapGitIdentity
// ---------------------------------------------------------------------------

/**
 * Resolves a complete git author/committer identity before a GitContext exists.
 * Resolution order:
 *   1. GitHub App bot identity (if App configured)
 *   2. GIT_AUTHOR_* / GIT_COMMITTER_* env vars
 *   3. `git config user.name / user.email`
 *   4. Built-in ADW Bot default (never returns empty fields)
 *
 * Consolidates the two prior implementations (`deriveGitIdentity` in
 * gitContextFactory.ts and `resolveLaunchGitIdentity` in launchGitContext.ts)
 * into one canonical resolver with injectable seams for hermetic tests.
 */
export function resolveBootstrapGitIdentity(deps: BootstrapIdentityDeps = {}): GitIdentity {
  const env = deps.env ?? process.env;
  const exec = deps.exec ?? ((cmd, opts) => execSync(cmd, opts as Parameters<typeof execSync>[1]) as string);
  const isAppConfigured = deps.isAppConfigured ?? (() => Boolean(
    env['GITHUB_APP_ID'] && env['GITHUB_APP_SLUG'] && env['GITHUB_APP_PRIVATE_KEY_PATH'],
  ));

  if (isAppConfigured()) {
    const appId = env['GITHUB_APP_ID'];
    const appSlug = env['GITHUB_APP_SLUG'];
    if (appId && appSlug) {
      const botName = `${appSlug}[bot]`;
      const botEmail = `${appId}+${appSlug}[bot]@users.noreply.github.com`;
      return { authorName: botName, authorEmail: botEmail, committerName: botName, committerEmail: botEmail };
    }
  }

  const authorName = env['GIT_AUTHOR_NAME'];
  const authorEmail = env['GIT_AUTHOR_EMAIL'];
  const committerName = env['GIT_COMMITTER_NAME'] || authorName;
  const committerEmail = env['GIT_COMMITTER_EMAIL'] || authorEmail;

  if (authorName && authorEmail && committerName && committerEmail) {
    return { authorName, authorEmail, committerName, committerEmail };
  }

  try {
    const name = exec('git config user.name', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const email = exec('git config user.email', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (name && email) {
      return { authorName: name, authorEmail: email, committerName: name, committerEmail: email };
    }
  } catch { /* git config not available */ }

  return {
    authorName: 'ADW Bot',
    authorEmail: 'adw-bot@users.noreply.github.com',
    committerName: 'ADW Bot',
    committerEmail: 'adw-bot@users.noreply.github.com',
  };
}
