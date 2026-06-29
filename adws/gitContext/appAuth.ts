/**
 * GitHub App token mint — absorbed into the gitContext package (issue #700).
 *
 * This module is structurally exempt from the git/gh guard (adws/gitContext/ is
 * skipped by directory). It owns the JWT dance and installation-token exchange;
 * callers should route through resolveContextToken for veracity.
 *
 * No ADW-global imports. The log seam defaults to a no-op to keep the package
 * standalone-reusable.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Env var names
// ---------------------------------------------------------------------------

const ENV = {
  APP_ID: 'GITHUB_APP_ID',
  APP_SLUG: 'GITHUB_APP_SLUG',
  PRIVATE_KEY_PATH: 'GITHUB_APP_PRIVATE_KEY_PATH',
} as const;

// ---------------------------------------------------------------------------
// Cache types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns true if GitHub App env vars are configured. */
export function isGitHubAppConfigured(): boolean {
  return Boolean(
    process.env[ENV.APP_ID] &&
    process.env[ENV.APP_SLUG] &&
    process.env[ENV.PRIVATE_KEY_PATH],
  );
}

/**
 * Returns a valid GitHub App installation token for the given repo,
 * refreshing if needed. Throws if the App is not installed on owner/repo.
 */
export function getInstallationToken(owner: string, repo: string): string {
  const appId = process.env[ENV.APP_ID]!;
  const keyPath = process.env[ENV.PRIVATE_KEY_PATH]!;
  const key = `${owner}/${repo}`;

  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt.getTime() - Date.now() > REFRESH_BUFFER_MS) {
    return cached.token;
  }

  const jwt = createAppJWT(appId, keyPath);
  const installationId = resolveInstallationId(jwt, owner, repo);
  const tokenEntry = fetchInstallationToken(jwt, installationId);
  tokenCache.set(key, tokenEntry);

  return tokenEntry.token;
}

// ---------------------------------------------------------------------------
// Private mint internals
// ---------------------------------------------------------------------------

function createAppJWT(appId: string, privateKeyPath: string): string {
  const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now - 60, exp: now + 600, iss: appId };

  const encode = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const headerB64 = encode(header);
  const payloadB64 = encode(payload);
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(privateKey, 'base64url');

  return `${signingInput}.${signature}`;
}

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
  return id;
}

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
