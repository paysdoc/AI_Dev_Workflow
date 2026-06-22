/**
 * GitContext factory — boundary factory that wires auth into a GitContext.
 *
 * Lives in adws/github/ (not adws/gitContext/) because it needs GitHub App auth
 * from githubAppAuth.ts, which would violate the ADW-global-free purity of the
 * gitContext/ package.
 *
 * Usage:
 *   const ctx = await gitContextFor({ owner, repo, selfHost });
 *   const wtPath = ctx.ensureWorktree(branchName, defaultBranch);
 */

import { execSync } from 'child_process';
import { GitContext } from '../gitContext';
import type { GitContextOptions, GitIdentity } from '../gitContext';
import { REPO_ROOT, TARGET_REPOS_DIR } from '../core/environment';
import { isGitHubAppConfigured, getInstallationToken } from './githubAppAuth';

export interface GitContextFactoryOptions {
  /** GitHub owner (org or user). */
  owner: string;
  /** Repository name. */
  repo: string;
  /**
   * True when operating on the ADW self-hosted repository.
   * False for any external target repository.
   */
  selfHost: boolean;
}

/**
 * Resolves a GitHub token for the given repo.
 * Priority: GitHub App installation token → GH_TOKEN env var → `gh auth token` CLI.
 * Throws if no non-empty token can be obtained.
 */
async function resolveToken(owner: string, repo: string): Promise<string> {
  if (isGitHubAppConfigured()) {
    const token = getInstallationToken(owner, repo);
    if (token) return token;
  }

  const envToken = process.env.GH_TOKEN ?? '';
  if (envToken) return envToken;

  try {
    const cliToken = execSync('gh auth token', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (cliToken) return cliToken;
  } catch {
    // gh CLI not available or not authenticated
  }

  throw new Error(
    `gitContextFor: could not obtain a GitHub token for ${owner}/${repo}. ` +
    'Set GH_TOKEN, configure the GitHub App, or authenticate via `gh auth login`.',
  );
}

/**
 * Resolves the git identity for subprocess env overlays.
 * Priority:
 * 1. GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL / GIT_COMMITTER_NAME / GIT_COMMITTER_EMAIL env vars
 *    (set by configureGitIdentity() in githubAppAuth.ts after activateGitHubAppAuth)
 * 2. GITHUB_APP_SLUG env var → bot identity format
 * 3. `git config user.name` / `git config user.email`
 * 4. Hard defaults ('ADW Bot', 'adw-bot@adw.dev')
 */
function resolveGitIdentity(): GitIdentity {
  const authorName = process.env.GIT_AUTHOR_NAME;
  const authorEmail = process.env.GIT_AUTHOR_EMAIL;
  const committerName = process.env.GIT_COMMITTER_NAME;
  const committerEmail = process.env.GIT_COMMITTER_EMAIL;

  if (authorName && authorEmail && committerName && committerEmail) {
    return { authorName, authorEmail, committerName, committerEmail };
  }

  const appSlug = process.env.GITHUB_APP_SLUG;
  const appId = process.env.GITHUB_APP_ID;
  if (appSlug) {
    const botName = `${appSlug}[bot]`;
    const botEmail = appId
      ? `${appId}+${appSlug}[bot]@users.noreply.github.com`
      : `${appSlug}[bot]@users.noreply.github.com`;
    return {
      authorName: botName,
      authorEmail: botEmail,
      committerName: botName,
      committerEmail: botEmail,
    };
  }

  try {
    const name = execSync('git config user.name', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const email = execSync('git config user.email', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (name && email) {
      return { authorName: name, authorEmail: email, committerName: name, committerEmail: email };
    }
  } catch {
    // git not available or config not set
  }

  return {
    authorName: 'ADW Bot',
    authorEmail: 'adw-bot@adw.dev',
    committerName: 'ADW Bot',
    committerEmail: 'adw-bot@adw.dev',
  };
}

/**
 * Async factory that returns a fully-configured GitContext for the given repo.
 *
 * Token resolution is async because getInstallationToken may need to refresh
 * via the GitHub API.
 */
export async function gitContextFor(options: GitContextFactoryOptions): Promise<GitContext> {
  const { owner, repo, selfHost } = options;

  const token = await resolveToken(owner, repo);
  const gitIdentity = resolveGitIdentity();

  const ctxOptions: GitContextOptions = {
    owner,
    repo,
    selfHost,
    token,
    gitIdentity,
    frameworkRepoRoot: REPO_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
  };

  return new GitContext(ctxOptions);
}

/**
 * Synchronous token resolver — same priority chain as resolveToken but blocks.
 * Suitable for call sites that are fundamentally sync (trigger handlers, cancel,
 * janitor) where worktree-only git operations do not actually use the token.
 */
function resolveTokenSync(owner: string, repo: string): string {
  if (isGitHubAppConfigured()) {
    const token = getInstallationToken(owner, repo);
    if (token) return token;
  }

  const envToken = process.env.GH_TOKEN ?? '';
  if (envToken) return envToken;

  try {
    const cliToken = execSync('gh auth token', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (cliToken) return cliToken;
  } catch {
    // gh CLI not available or not authenticated
  }

  throw new Error(
    `gitContextForSync: could not obtain a GitHub token for ${owner}/${repo}. ` +
    'Set GH_TOKEN, configure the GitHub App, or authenticate via `gh auth login`.',
  );
}

/**
 * Synchronous factory — suitable for call sites that cannot await (trigger handlers,
 * cancel directives, janitor). Worktree git operations (create/remove/reset/list) use
 * SSH/stored credentials, not GH_TOKEN, so token validity is not required for them.
 */
export function gitContextForSync(options: GitContextFactoryOptions): GitContext {
  const { owner, repo, selfHost } = options;

  const token = resolveTokenSync(owner, repo);
  const gitIdentity = resolveGitIdentity();

  return new GitContext({
    owner,
    repo,
    selfHost,
    token,
    gitIdentity,
    frameworkRepoRoot: REPO_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
  });
}
