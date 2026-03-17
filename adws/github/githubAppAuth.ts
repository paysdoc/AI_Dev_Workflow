/**
 * GitHub App Authentication - generates installation tokens for ADW's GitHub App.
 *
 * Uses the app's private key to create a JWT, then exchanges it for a
 * short-lived installation access token. The token is cached per owner/repo
 * and refreshed automatically when it nears expiry. Once activated, `GH_TOKEN`
 * is set in `process.env` so all `gh` CLI calls use the app identity.
 *
 * The installation ID is resolved dynamically via the GitHub API — no need
 * to configure it per organisation.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { log } from '../core';

/** Env var names for GitHub App configuration. */
const ENV = {
  APP_ID: 'GITHUB_APP_ID',
  APP_SLUG: 'GITHUB_APP_SLUG',
  PRIVATE_KEY_PATH: 'GITHUB_APP_PRIVATE_KEY_PATH',
} as const;

interface CachedToken {
  token: string;
  expiresAt: Date;
  installationId: string;
}

/** Cache of installation tokens keyed by `owner/repo`. */
const tokenCache = new Map<string, CachedToken>();

/** Cache of installation IDs keyed by `owner/repo`. */
const installationIdCache = new Map<string, string>();

/** Refresh the token 5 minutes before it expires. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** The `owner/repo` that `GH_TOKEN` is currently set for. */
let activeRepo: string | null = null;

/**
 * Returns true if GitHub App env vars are configured.
 */
export function isGitHubAppConfigured(): boolean {
  return Boolean(
    process.env[ENV.APP_ID] &&
    process.env[ENV.APP_SLUG] &&
    process.env[ENV.PRIVATE_KEY_PATH],
  );
}

/**
 * Creates a JWT signed with the app's RSA private key.
 * The JWT is valid for 10 minutes (GitHub's maximum).
 */
function createAppJWT(appId: string, privateKeyPath: string): string {
  const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iat: now - 60,   // issued 60s ago to account for clock drift
    exp: now + 600,  // expires in 10 minutes
    iss: appId,
  };

  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(privateKey, 'base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Looks up the installation ID for a given repo via the GitHub API.
 * Uses the app JWT for authentication. Result is cached.
 */
function resolveInstallationId(jwt: string, owner: string, repo: string): string {
  const key = `${owner}/${repo}`;
  const cached = installationIdCache.get(key);
  if (cached) return cached;

  const result = execSync(
    `curl -sf ` +
    `-H "Authorization: Bearer ${jwt}" ` +
    `-H "Accept: application/vnd.github+json" ` +
    `-H "X-GitHub-Api-Version: 2022-11-28" ` +
    `https://api.github.com/repos/${owner}/${repo}/installation`,
    { encoding: 'utf-8' },
  );

  const parsed = JSON.parse(result);
  if (!parsed.id) {
    throw new Error(`App not installed on ${key}: ${result}`);
  }

  const id = String(parsed.id);
  installationIdCache.set(key, id);
  log(`Resolved installation ID ${id} for ${key}`);
  return id;
}

/**
 * Exchanges a JWT for a GitHub App installation access token.
 * Returns the token string and its expiry timestamp.
 */
function fetchInstallationToken(jwt: string, installationId: string): CachedToken {
  const result = execSync(
    `curl -sf -X POST ` +
    `-H "Authorization: Bearer ${jwt}" ` +
    `-H "Accept: application/vnd.github+json" ` +
    `-H "X-GitHub-Api-Version: 2022-11-28" ` +
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    { encoding: 'utf-8' },
  );

  const parsed = JSON.parse(result);
  if (!parsed.token) {
    throw new Error(`GitHub App token exchange failed: ${result}`);
  }

  return {
    token: parsed.token,
    expiresAt: new Date(parsed.expires_at),
    installationId,
  };
}

/**
 * Returns a valid GitHub App installation token for the given repo, refreshing if needed.
 * Throws if the app is not configured.
 */
export function getInstallationToken(owner: string, repo: string): string {
  const appId = process.env[ENV.APP_ID]!;
  const keyPath = process.env[ENV.PRIVATE_KEY_PATH]!;
  const key = `${owner}/${repo}`;

  // Return cached token if still valid
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt.getTime() - Date.now() > REFRESH_BUFFER_MS) {
    return cached.token;
  }

  log(`Refreshing GitHub App installation token for ${key}`);
  const jwt = createAppJWT(appId, keyPath);
  const installationId = resolveInstallationId(jwt, owner, repo);
  const token = fetchInstallationToken(jwt, installationId);
  tokenCache.set(key, token);
  log(`GitHub App token for ${key} valid until ${token.expiresAt.toISOString()}`);

  return token.token;
}

/**
 * Activates GitHub App authentication for a specific repo by setting
 * `GH_TOKEN` and git identity env vars in `process.env`.
 *
 * @param owner - Repository owner (user or org)
 * @param repo - Repository name
 * @returns true if activation succeeded, false if app is not configured or activation failed.
 */
export function activateGitHubAppAuth(owner?: string, repo?: string): boolean {
  if (!isGitHubAppConfigured()) {
    return false;
  }

  // If no repo specified, try to resolve from local git remote
  if (!owner || !repo) {
    try {
      const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
      const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
      if (match) {
        owner = match[1];
        repo = match[2];
      }
    } catch { /* ignore */ }
  }

  if (!owner || !repo) {
    log('GitHub App auth: could not determine target repo', 'warn');
    return false;
  }

  try {
    const token = getInstallationToken(owner, repo);
    process.env.GH_TOKEN = token;
    activeRepo = `${owner}/${repo}`;
    configureGitIdentity();
    log(`GitHub App authentication activated for ${owner}/${repo}`);
    return true;
  } catch (error) {
    log(`GitHub App authentication failed for ${owner}/${repo}, falling back to gh CLI auth: ${error}`, 'error');
    return false;
  }
}

/**
 * Ensures the active `GH_TOKEN` matches the given repo. If the repo differs
 * from the currently active one, fetches a new token. Use this in the webhook
 * handler where each request may target a different repo.
 */
export function ensureAppAuthForRepo(owner: string, repo: string): boolean {
  if (!isGitHubAppConfigured()) return false;

  const key = `${owner}/${repo}`;
  if (activeRepo === key) {
    // Same repo — just refresh if needed
    refreshTokenIfNeeded(owner, repo);
    return true;
  }

  return activateGitHubAppAuth(owner, repo);
}

/**
 * Configures git author/committer identity to match the GitHub App bot.
 * Sets env vars so all `git commit` calls attribute to the app.
 * GitHub recognizes the `<id>+<slug>[bot]@users.noreply.github.com` format
 * and links commits to the app's bot account.
 */
function configureGitIdentity(): void {
  const appId = process.env[ENV.APP_ID];
  const appSlug = process.env[ENV.APP_SLUG];
  if (!appId || !appSlug) return;

  const botName = `${appSlug}[bot]`;
  const botEmail = `${appId}+${appSlug}[bot]@users.noreply.github.com`;

  process.env.GIT_AUTHOR_NAME = botName;
  process.env.GIT_AUTHOR_EMAIL = botEmail;
  process.env.GIT_COMMITTER_NAME = botName;
  process.env.GIT_COMMITTER_EMAIL = botEmail;

  log(`Git identity: ${botName} <${botEmail}>`);
}

/**
 * Refreshes the GitHub App token if it's near expiry.
 * Call this periodically in long-running processes (cron, webhook server).
 * No-op if the app is not configured or the token is still valid.
 */
export function refreshTokenIfNeeded(owner?: string, repo?: string): void {
  if (!isGitHubAppConfigured()) return;
  if (!owner || !repo) {
    // Refresh for the currently active repo
    if (!activeRepo) return;
    [owner, repo] = activeRepo.split('/');
  }

  try {
    const token = getInstallationToken(owner, repo);
    process.env.GH_TOKEN = token;
  } catch (error) {
    log(`GitHub App token refresh failed: ${error}`, 'error');
  }
}
