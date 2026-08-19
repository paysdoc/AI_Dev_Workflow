import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getInstallationToken,
  isGitHubAppConfigured,
  clearAppAuthCaches,
  redactBearerTokens,
  GITHUB_API_BASE_URL,
} from '../appAuth';
import type { RunCurl, GitHubAppConfig } from '../appAuth';

// ---------------------------------------------------------------------------
// Suite setup — throwaway RSA key + an explicit injected GitHubAppConfig.
// No process.env mutation: the module under test reads no environment
// variable, so the suite never needs to set one for the mint to work.
// ---------------------------------------------------------------------------

let scratchDir: string;
let config: GitHubAppConfig;

beforeAll(() => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-appauth-'));
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const keyPath = path.join(scratchDir, 'throwaway-key.pem');
  fs.writeFileSync(keyPath, privateKey, 'utf-8');

  config = {
    appId: 'appauth-test-app-id',
    appSlug: 'appauth-test-bot',
    privateKeyPath: keyPath,
  };
});

afterAll(() => {
  fs.rmSync(scratchDir, { recursive: true, force: true });
});

beforeEach(() => {
  clearAppAuthCaches();
});

// ---------------------------------------------------------------------------
// AC2 — configuration is injected, not read from process.env
// ---------------------------------------------------------------------------

describe('isGitHubAppConfigured — injected configuration, not the environment', () => {
  it('is false for an empty config even while GITHUB_APP_ID is exported into the environment', () => {
    const prior = process.env.GITHUB_APP_ID;
    process.env.GITHUB_APP_ID = 'ambient-app-id-must-be-ignored';
    try {
      expect(isGitHubAppConfigured({})).toBe(false);
    } finally {
      if (prior === undefined) delete process.env.GITHUB_APP_ID; else process.env.GITHUB_APP_ID = prior;
    }
  });

  it('is true for a complete config even with GITHUB_APP_ID absent from the environment', () => {
    const prior = process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_ID;
    try {
      expect(isGitHubAppConfigured(config)).toBe(true);
    } finally {
      if (prior !== undefined) process.env.GITHUB_APP_ID = prior;
    }
  });
});

// ---------------------------------------------------------------------------
// Capture helpers
// ---------------------------------------------------------------------------

interface RecordedCall {
  args: readonly string[];
  config: string;
}

interface CannedResponse {
  status: number;
  body: string;
}

/** Records every {args, config} pair and replays canned `${body}\n${status}` responses in order. */
function makeRunCurl(responses: readonly CannedResponse[]): { runCurl: RunCurl; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;
  const runCurl: RunCurl = (args, stdinConfig) => {
    calls.push({ args, config: stdinConfig });
    const next = responses[index++];
    if (!next) throw new Error(`makeRunCurl: no canned response queued for call #${index}`);
    return `${next.body}\n${next.status}`;
  };
  return { runCurl, calls };
}

/** A synthetic execFileSync-shaped error, mirroring what a real curl transport failure throws. */
function makeCurlTransportError(status: number, stderr: string): Error & { status: number; stderr: string } {
  const err = new Error('Command failed: curl --config -') as Error & { status: number; stderr: string };
  err.status = status;
  err.stderr = stderr;
  return err;
}

/** Extracts the minted JWT from a recorded curl config payload — the real secret every negative assertion targets. */
function extractJwt(config: string): string {
  // The header line is `header = "Authorization: Bearer <jwt>"` — stop before
  // the closing quote, or the match greedily swallows it as part of \S+.
  const match = config.match(/Bearer ([^"\s]+)/);
  expect(match, `Expected a Bearer header in curl config:\n${config}`).not.toBeNull();
  return match![1];
}

// ---------------------------------------------------------------------------
// 1-4, 7 — resolveInstallationId / requestGitHubApi chokepoint
// ---------------------------------------------------------------------------

describe('a failing installation lookup', () => {
  it('does not disclose the bearer credential in the thrown message (the bug)', () => {
    const { runCurl, calls } = makeRunCurl([{ status: 404, body: '{"message":"Not Found"}' }]);

    let thrown: Error | undefined;
    try {
      getInstallationToken(config, 'acme', 'lookup-404', { runCurl });
    } catch (e) {
      thrown = e as Error;
    }

    const jwt = extractJwt(calls[0].config);
    expect(thrown).toBeDefined();
    expect(thrown!.message).not.toContain(jwt);
    expect(thrown!.message).not.toMatch(/Bearer\s+ey/);
    expect(thrown!.message).not.toContain('Command failed');
  });

  it('is diagnosable — names the operation, repo identity and status', () => {
    const { runCurl } = makeRunCurl([{ status: 404, body: '{"message":"Not Found"}' }]);

    let thrown: Error | undefined;
    try {
      getInstallationToken(config, 'acme', 'lookup-404-diag', { runCurl });
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('installation lookup');
    expect(thrown!.message).toContain('acme/lookup-404-diag');
    expect(thrown!.message).toContain('HTTP 404');
  });

  it('carries no credential in any recorded subprocess argv (the ps guarantee)', () => {
    const { runCurl, calls } = makeRunCurl([{ status: 404, body: '{"message":"Not Found"}' }]);

    try {
      getInstallationToken(config, 'acme', 'argv-clean', { runCurl });
    } catch {
      // expected — asserted via the calls recorded below
    }

    expect(calls.length).toBeGreaterThan(0);
    const jwt = extractJwt(calls[0].config);
    for (const call of calls) {
      expect(call.args.join(' ')).toBe('--config -');
      expect(call.args.some((a) => /Bearer/.test(a) || a.includes(jwt))).toBe(false);
    }
  });

  it('really did transmit the credential — the config carries exactly one Authorization line plus url/Accept/version', () => {
    const { runCurl, calls } = makeRunCurl([{ status: 404, body: '{"message":"Not Found"}' }]);

    try {
      getInstallationToken(config, 'acme', 'config-shape', { runCurl });
    } catch {
      // expected
    }

    const curlConfig = calls[0].config;
    const bearerLines = curlConfig.split('\n').filter((line) => line.includes('Authorization: Bearer'));
    expect(bearerLines).toHaveLength(1);
    expect(curlConfig).toContain('url = "https://api.github.com/repos/acme/config-shape/installation"');
    expect(curlConfig).toContain('Accept: application/vnd.github+json');
    expect(curlConfig).toContain('X-GitHub-Api-Version: 2022-11-28');
  });

  it('a curl transport failure is sanitized rather than rethrown raw', () => {
    let jwt = '';
    const runCurl: RunCurl = (_args, stdinConfig) => {
      jwt = extractJwt(stdinConfig);
      throw makeCurlTransportError(6, 'curl: (6) Could not resolve host: api.github.com\n');
    };

    let thrown: Error | undefined;
    try {
      getInstallationToken(config, 'acme', 'transport-fail', { runCurl });
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('curl exit 6');
    expect(thrown!.message).toContain('Could not resolve host');
    expect(thrown!.message).not.toContain(jwt);
    expect(thrown!.message).not.toContain('Command failed');
  });
});

// ---------------------------------------------------------------------------
// 5-6 — fetchInstallationToken (the POST leg)
// ---------------------------------------------------------------------------

describe('a failing token exchange', () => {
  it('a 500 names the exchange and status without disclosing the bearer credential', () => {
    const { runCurl } = makeRunCurl([
      { status: 200, body: '{"id":4711}' },
      { status: 500, body: '{"message":"Internal Server Error"}' },
    ]);

    let thrown: Error | undefined;
    try {
      getInstallationToken(config, 'octo', 'infra', { runCurl });
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('token exchange');
    expect(thrown!.message).toContain('installation 4711');
    expect(thrown!.message).toContain('HTTP 500');
  });

  it('a 2xx response with an unexpected body is not echoed raw', () => {
    const { runCurl } = makeRunCurl([
      { status: 200, body: '{"id":8080}' },
      { status: 200, body: '{"unexpected_key":"ghs_unexpected_shape_credential"}' },
    ]);

    let thrown: Error | undefined;
    try {
      getInstallationToken(config, 'hooli', 'nucleus', { runCurl });
    } catch (e) {
      thrown = e as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).not.toContain('ghs_unexpected_shape_credential');
    expect(thrown!.message).not.toContain('unexpected_key');
    expect(thrown!.message).toContain('token exchange');
  });
});

// ---------------------------------------------------------------------------
// 8-11 — the happy path, apiBaseUrl, uninstalled-App guard, cache reset
// ---------------------------------------------------------------------------

describe('a successful mint', () => {
  it('mints, serves a second call from cache, and shapes GET vs POST configs correctly', () => {
    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    const { runCurl, calls } = makeRunCurl([
      { status: 200, body: '{"id":4242}' },
      { status: 200, body: `{"token":"ghs_test","expires_at":"${futureIso}"}` },
    ]);

    const token = getInstallationToken(config, 'acme', 'happy-path', { runCurl });
    expect(token).toBe('ghs_test');
    expect(calls).toHaveLength(2);

    const cachedToken = getInstallationToken(config, 'acme', 'happy-path', { runCurl });
    expect(cachedToken).toBe('ghs_test');
    expect(calls).toHaveLength(2); // no further runCurl invocations — served from cache

    expect(calls[0].config).not.toContain('request = "POST"');
    expect(calls[1].config).toContain('request = "POST"');
  });

  it('honours an injected apiBaseUrl, and defaults to GITHUB_API_BASE_URL when omitted', () => {
    const { runCurl: runCurl1, calls: calls1 } = makeRunCurl([{ status: 404, body: '{"message":"Not Found"}' }]);
    try {
      getInstallationToken(config, 'acme', 'base-url-custom', { runCurl: runCurl1, apiBaseUrl: 'http://127.0.0.1:9' });
    } catch {
      // expected — the lookup 404s
    }
    expect(calls1[0].config).toContain('url = "http://127.0.0.1:9/repos/acme/base-url-custom/installation"');
    expect(calls1[0].config).not.toContain('api.github.com');

    const { runCurl: runCurl2, calls: calls2 } = makeRunCurl([{ status: 404, body: '{"message":"Not Found"}' }]);
    try {
      getInstallationToken(config, 'acme', 'base-url-default', { runCurl: runCurl2 });
    } catch {
      // expected — the lookup 404s
    }
    expect(calls2[0].config).toContain(`url = "${GITHUB_API_BASE_URL}/repos/acme/base-url-default/installation"`);
  });

  it('still throws when a 2xx installation lookup body lacks an id (uninstalled App)', () => {
    const { runCurl } = makeRunCurl([{ status: 200, body: '{}' }]);
    expect(() => getInstallationToken(config, 'acme', 'uninstalled', { runCurl })).toThrow();
  });

  it('clearAppAuthCaches forces the next call to hit runCurl again', () => {
    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    const { runCurl, calls } = makeRunCurl([
      { status: 200, body: '{"id":5555}' },
      { status: 200, body: `{"token":"ghs_first","expires_at":"${futureIso}"}` },
      { status: 200, body: '{"id":5555}' },
      { status: 200, body: `{"token":"ghs_second","expires_at":"${futureIso}"}` },
    ]);

    const first = getInstallationToken(config, 'acme', 'cache-clear', { runCurl });
    expect(first).toBe('ghs_first');
    expect(calls).toHaveLength(2);

    clearAppAuthCaches();

    const second = getInstallationToken(config, 'acme', 'cache-clear', { runCurl });
    expect(second).toBe('ghs_second');
    expect(calls).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// 12 — redactBearerTokens unit coverage
// ---------------------------------------------------------------------------

describe('redactBearerTokens', () => {
  it('redacts a single bearer token', () => {
    expect(redactBearerTokens('Authorization: Bearer abc.def.ghi')).toBe('Authorization: Bearer [REDACTED]');
  });

  it('redacts multiple occurrences', () => {
    expect(redactBearerTokens('first Bearer aaa then Bearer bbb')).toBe('first Bearer [REDACTED] then Bearer [REDACTED]');
  });

  it('returns text unchanged when no bearer token is present', () => {
    expect(redactBearerTokens('no credential here')).toBe('no credential here');
  });
});
