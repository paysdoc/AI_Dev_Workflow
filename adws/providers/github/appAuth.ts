/**
 * GitHub App token mint — GitHub forge adapter (issue #792; originally
 * absorbed into the gitContext package by issue #700).
 *
 * This module is structurally exempt from the git/gh guard
 * (adws/providers/github/ is skipped by directory). It owns the JWT dance and
 * installation-token exchange; callers should route through
 * resolveContextToken for veracity.
 *
 * Configuration is INJECTED, never read from process.env — see
 * {@link GitHubAppConfig}. The ADW wiring shim (adws/github/githubAppAuth.ts)
 * is the sole site that reads GITHUB_APP_ID/GITHUB_APP_SLUG/
 * GITHUB_APP_PRIVATE_KEY_PATH and passes them in as a value.
 *
 * No ADW-global imports. The log seam defaults to a no-op to keep the package
 * standalone-reusable.
 *
 * The bearer credential travels to curl over its `--config` stdin channel —
 * never as a command-line argument — so it cannot appear in a thrown
 * `execFileSync` error or in the process table (issue #780).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import { execFileSync } from 'child_process';

/** Injected GitHub App identity and signing-key path. Any missing field means "not configured". */
export interface GitHubAppConfig {
  readonly appId?: string;
  readonly appSlug?: string;
  readonly privateKeyPath?: string;
}

// Cache types
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

// Injectable seams
/** Runs curl with the given argv, delivering the request description on stdin. */
export type RunCurl = (args: readonly string[], stdinConfig: string) => string;

export interface AppAuthDeps {
  /** Overrides the GitHub API origin. Defaults to GITHUB_API_BASE_URL. */
  apiBaseUrl?: string;
  /** Overrides the curl runner. Production uses execFileSync. */
  runCurl?: RunCurl;
}

/** Production GitHub API origin. Overridable via AppAuthDeps.apiBaseUrl for hermetic testing. */
export const GITHUB_API_BASE_URL = 'https://api.github.com';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns true if the injected GitHub App configuration is complete. */
export function isGitHubAppConfigured(config: GitHubAppConfig): boolean {
  return Boolean(config.appId && config.appSlug && config.privateKeyPath);
}

/**
 * Returns a valid GitHub App installation token for the given repo,
 * refreshing if needed. Throws if the App is not installed on owner/repo.
 *
 * Assumes `isGitHubAppConfigured(config)` was checked first, exactly as
 * before configuration was injected — but fails with a named error rather
 * than a `TypeError` from `fs.readFileSync(undefined)` if it was not.
 */
export function getInstallationToken(config: GitHubAppConfig, owner: string, repo: string, deps: AppAuthDeps = {}): string {
  if (!config.appId || !config.privateKeyPath) {
    throw new Error(
      `getInstallationToken: GitHub App is not configured (missing ${!config.appId ? 'appId' : 'privateKeyPath'})`,
    );
  }
  const appId = config.appId;
  const keyPath = config.privateKeyPath;
  const key = `${owner}/${repo}`;

  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt.getTime() - Date.now() > REFRESH_BUFFER_MS) {
    return cached.token;
  }

  const runCurl = deps.runCurl ?? execCurl;
  const baseUrl = deps.apiBaseUrl ?? GITHUB_API_BASE_URL;

  const jwt = createAppJWT(appId, keyPath);
  const installationId = resolveInstallationId(jwt, owner, repo, baseUrl, runCurl);
  const tokenEntry = fetchInstallationToken(jwt, installationId, baseUrl, runCurl);
  tokenCache.set(key, tokenEntry);

  return tokenEntry.token;
}

/** Clears both module-level caches. Test-only — production never needs to reset them. */
export function clearAppAuthCaches(): void {
  tokenCache.clear();
  installationIdCache.clear();
}

// ---------------------------------------------------------------------------
// Sanitized GitHub API request helpers — the credential travels on curl's
// `--config` stdin channel, never as a command-line argument, so it cannot
// appear in a thrown execFileSync error or in `ps` output. Failure messages
// are composed from the HTTP status and, at most, GitHub's `message` field —
// never a raw response body.
// ---------------------------------------------------------------------------

const BEARER_PATTERN = /Bearer\s+\S+/g;

/** Rewrites any `Bearer <token>` fragment to `Bearer [REDACTED]`. Final net over untrusted text (curl stderr, GitHub error bodies) — the credential is already structurally absent by construction. */
export function redactBearerTokens(text: string): string {
  return text.replace(BEARER_PATTERN, 'Bearer [REDACTED]');
}

export interface GitHubApiRequest {
  jwt: string;
  url: string;
  method: 'GET' | 'POST';
  /** Human-readable phrase for failure messages, e.g. "installation lookup". */
  operation: string;
  /** Identity echoed in failure messages, e.g. "acme/webapp" or "installation 4711". */
  subject: string;
}

/** Builds a curl `--config` payload carrying the URL, headers (including the bearer credential) and method — never a command-line argument. */
export function buildCurlConfig(request: GitHubApiRequest): string {
  const lines = [
    'silent',
    'show-error',
    `header = "Authorization: Bearer ${request.jwt}"`,
    'header = "Accept: application/vnd.github+json"',
    'header = "X-GitHub-Api-Version: 2022-11-28"',
    'write-out = "\\n%{http_code}"',
    `url = "${request.url}"`,
  ];
  if (request.method === 'POST') {
    lines.push('request = "POST"');
  }
  return `${lines.join('\n')}\n`;
}

/** Composes the sanitized failure shape the issue asks for: `GitHub App <operation> failed for <subject>: <detail>`. */
export function describeApiFailure(input: { operation: string; subject: string; detail: string }): string {
  return `GitHub App ${input.operation} failed for ${input.subject}: ${redactBearerTokens(input.detail)}`;
}

/**
 * Non-echoing detail builder for a non-2xx response — at most GitHub's own
 * `message` field (fixed vocabulary: "Not Found", "Bad credentials", ...),
 * never the raw body, since a body may itself carry a credential under an
 * unexpected key.
 */
function describeStatus(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      const message = (parsed as { message: unknown }).message;
      if (typeof message === 'string') {
        return `HTTP ${status} (${redactBearerTokens(message)})`;
      }
    }
    return `HTTP ${status}`;
  } catch {
    return `HTTP ${status} (${body.length} bytes, unparseable)`;
  }
}

const CURL_ARGS: readonly string[] = ['--config', '-'];

const execCurl: RunCurl = (args, stdinConfig) =>
  execFileSync('curl', [...args], {
    input: stdinConfig,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

interface GitHubApiResponse {
  status: number;
  body: string;
}

interface CurlExecError {
  status?: number | null;
  stderr?: string | Buffer;
  message: string;
}

function isCurlExecError(error: unknown): error is CurlExecError {
  return typeof error === 'object' && error !== null && 'message' in error;
}

/** Single chokepoint for every GitHub API call. Never lets a credential-bearing subprocess error escape unsanitized. */
function requestGitHubApi(request: GitHubApiRequest, runCurl: RunCurl): GitHubApiResponse {
  let raw: string;
  try {
    raw = runCurl(CURL_ARGS, buildCurlConfig(request));
  } catch (error: unknown) {
    const status = isCurlExecError(error) && typeof error.status === 'number' ? error.status : -1;
    const stderrRaw = isCurlExecError(error) && error.stderr !== undefined
      ? (typeof error.stderr === 'string' ? error.stderr : error.stderr.toString('utf-8'))
      : '';
    throw new Error(describeApiFailure({
      operation: request.operation,
      subject: request.subject,
      detail: `curl exit ${status} (${redactBearerTokens(stderrRaw.trim())})`,
    }));
  }

  const cut = raw.lastIndexOf('\n');
  if (cut < 0) {
    throw new Error(describeApiFailure({
      operation: request.operation,
      subject: request.subject,
      detail: 'no HTTP status returned',
    }));
  }

  return { status: Number(raw.slice(cut + 1).trim()), body: raw.slice(0, cut) };
}

/** Parses a response body, rethrowing a sanitized failure on malformed JSON. */
function parseJsonBody<T>(body: string, context: { operation: string; subject: string; status: number }): T {
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(describeApiFailure({
      operation: context.operation,
      subject: context.subject,
      detail: `HTTP ${context.status} — unparseable response body (${body.length} bytes)`,
    }));
  }
}

// Private mint internals
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

function resolveInstallationId(jwt: string, owner: string, repo: string, baseUrl: string, runCurl: RunCurl): string {
  const key = `${owner}/${repo}`;
  const cached = installationIdCache.get(key);
  if (cached) return cached;

  const { status, body } = requestGitHubApi(
    {
      jwt,
      url: `${baseUrl}/repos/${owner}/${repo}/installation`,
      method: 'GET',
      operation: 'installation lookup',
      subject: key,
    },
    runCurl,
  );

  if (status < 200 || status >= 300) {
    throw new Error(describeApiFailure({ operation: 'installation lookup', subject: key, detail: describeStatus(status, body) }));
  }

  const parsed = parseJsonBody<{ id?: number }>(body, { operation: 'installation lookup', subject: key, status });
  if (!parsed.id) {
    throw new Error(describeApiFailure({
      operation: 'installation lookup',
      subject: key,
      detail: `HTTP ${status} — response did not contain an installation id (${body.length} bytes)`,
    }));
  }

  const id = String(parsed.id);
  installationIdCache.set(key, id);
  return id;
}

function fetchInstallationToken(jwt: string, installationId: string, baseUrl: string, runCurl: RunCurl): CachedToken {
  const subject = `installation ${installationId}`;

  const { status, body } = requestGitHubApi(
    {
      jwt,
      url: `${baseUrl}/app/installations/${installationId}/access_tokens`,
      method: 'POST',
      operation: 'token exchange',
      subject,
    },
    runCurl,
  );

  if (status < 200 || status >= 300) {
    throw new Error(describeApiFailure({ operation: 'token exchange', subject, detail: describeStatus(status, body) }));
  }

  const parsed = parseJsonBody<{ token?: string; expires_at?: string }>(body, { operation: 'token exchange', subject, status });
  if (!parsed.token) {
    throw new Error(describeApiFailure({
      operation: 'token exchange',
      subject,
      detail: `HTTP ${status} — response did not contain an installation token (${body.length} bytes)`,
    }));
  }

  return {
    token: parsed.token,
    expiresAt: new Date(parsed.expires_at ?? ''),
    installationId,
  };
}
