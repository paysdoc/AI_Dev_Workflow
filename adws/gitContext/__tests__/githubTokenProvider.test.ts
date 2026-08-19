import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGitHubTokenProvider } from '../githubTokenProvider';
import type { GitHubTokenProviderInput } from '../githubTokenProvider';
import type { CredentialRequest } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<GitHubTokenProviderInput> = {}): GitHubTokenProviderInput {
  return {
    pat: undefined,
    alternateIdentityPat: undefined,
    isAppConfigured: () => false,
    mintInstallationToken: () => { throw new Error('mint should not be called'); },
    ghAuthToken: () => '',
    ...overrides,
  };
}

function request(overrides: Partial<CredentialRequest> = {}): CredentialRequest {
  return { owner: 'acme', repo: 'webapp', purpose: 'default', ...overrides };
}

// ---------------------------------------------------------------------------
// Sentinel: process.env.GH_TOKEN must NEVER be read (tokenResolver.test.ts:25-28 precedent)
// ---------------------------------------------------------------------------

const SENTINEL = 'sentinel-gh-token-must-not-leak';

beforeEach(() => { process.env.GH_TOKEN = SENTINEL; });
afterEach(() => { delete process.env.GH_TOKEN; });

// ---------------------------------------------------------------------------
// Resolution order
// ---------------------------------------------------------------------------

describe('resolution order', () => {
  it('App configured → the mint bound to the requested owner/repo', () => {
    const provider = createGitHubTokenProvider(makeInput({
      isAppConfigured: () => true,
      mintInstallationToken: (o, r) => `installation-token::${o}/${r}`,
    }));
    const env = provider.credentialEnv(request());
    expect(env.GH_TOKEN).toBe('installation-token::acme/webapp');
    expect(env.GH_TOKEN).not.toBe(SENTINEL);
  });

  it('App configured + mint throws → the throw propagates, no ambient substitution', () => {
    const provider = createGitHubTokenProvider(makeInput({
      isAppConfigured: () => true,
      mintInstallationToken: () => { throw new Error('App not installed on acme/webapp'); },
      pat: 'github-pat-xyz',
    }));
    expect(() => provider.credentialEnv(request())).toThrow(/App not installed/);
  });

  it('App absent + PAT set → the PAT', () => {
    const provider = createGitHubTokenProvider(makeInput({ pat: 'github-pat-xyz' }));
    const env = provider.credentialEnv(request());
    expect(env.GH_TOKEN).toBe('github-pat-xyz');
    expect(env.GH_TOKEN).not.toBe(SENTINEL);
  });

  it('App absent + blank PAT + gh auth token non-empty → that', () => {
    const provider = createGitHubTokenProvider(makeInput({ pat: '   ', ghAuthToken: () => 'ghs-from-cli' }));
    const env = provider.credentialEnv(request());
    expect(env.GH_TOKEN).toBe('ghs-from-cli');
  });

  it('nothing available → throws naming the repository', () => {
    const provider = createGitHubTokenProvider(makeInput());
    expect(() => provider.credentialEnv(request())).toThrow(/no veracious token for acme\/webapp/);
  });
});

// ---------------------------------------------------------------------------
// Purpose selection
// ---------------------------------------------------------------------------

describe('purpose selection', () => {
  it("'alternateIdentity' + alternateIdentityPat set → that value, even when the App is configured", () => {
    let mintCalled = false;
    const provider = createGitHubTokenProvider(makeInput({
      alternateIdentityPat: 'pat-elevated',
      isAppConfigured: () => true,
      mintInstallationToken: () => { mintCalled = true; return 'installation-token::acme/webapp'; },
    }));
    const env = provider.credentialEnv(request({ purpose: 'alternateIdentity' }));
    expect(env.GH_TOKEN).toBe('pat-elevated');
    expect(mintCalled).toBe(false);
  });

  it("'alternateIdentity' + no alternateIdentityPat → identical to 'default'", () => {
    const provider = createGitHubTokenProvider(makeInput({
      isAppConfigured: () => true,
      mintInstallationToken: (o, r) => `installation-token::${o}/${r}`,
    }));
    const elevated = provider.credentialEnv(request({ purpose: 'alternateIdentity' }));
    const ordinary = provider.credentialEnv(request({ purpose: 'default' }));
    expect(elevated.GH_TOKEN).toBe('installation-token::acme/webapp');
    expect(elevated.GH_TOKEN).toBe(ordinary.GH_TOKEN);
  });

  it("'alternateIdentity' + whitespace-only alternateIdentityPat → identical to 'default'", () => {
    const provider = createGitHubTokenProvider(makeInput({
      alternateIdentityPat: '   ',
      isAppConfigured: () => true,
      mintInstallationToken: (o, r) => `installation-token::${o}/${r}`,
    }));
    const elevated = provider.credentialEnv(request({ purpose: 'alternateIdentity' }));
    expect(elevated.GH_TOKEN).toBe('installation-token::acme/webapp');
  });

  it("'default' never returns alternateIdentityPat", () => {
    const provider = createGitHubTokenProvider(makeInput({
      alternateIdentityPat: 'pat-elevated',
      isAppConfigured: () => true,
      mintInstallationToken: (o, r) => `installation-token::${o}/${r}`,
    }));
    const ordinary = provider.credentialEnv(request({ purpose: 'default' }));
    expect(ordinary.GH_TOKEN).toBe('installation-token::acme/webapp');
  });
});

// ---------------------------------------------------------------------------
// Per-call resolution (no caching) — the AC's headline test
// ---------------------------------------------------------------------------

describe('per-call resolution (no caching)', () => {
  it('a counting mint returns successive values across three calls', () => {
    let calls = 0;
    const provider = createGitHubTokenProvider(makeInput({
      isAppConfigured: () => true,
      mintInstallationToken: () => { calls += 1; return `token-${calls}`; },
    }));
    const results = [provider.credentialEnv(request()), provider.credentialEnv(request()), provider.credentialEnv(request())];
    expect(results.map(e => e.GH_TOKEN)).toEqual(['token-1', 'token-2', 'token-3']);
    expect(calls).toBe(3);
  });

  it('a counting ghAuthToken returns successive values across three calls', () => {
    let calls = 0;
    const provider = createGitHubTokenProvider(makeInput({
      ghAuthToken: () => { calls += 1; return `gh-cli-token-${calls}`; },
    }));
    const results = [provider.credentialEnv(request()), provider.credentialEnv(request()), provider.credentialEnv(request())];
    expect(results.map(e => e.GH_TOKEN)).toEqual(['gh-cli-token-1', 'gh-cli-token-2', 'gh-cli-token-3']);
    expect(calls).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Per-repo binding
// ---------------------------------------------------------------------------

describe('per-repo binding', () => {
  it('two requests with different owner/repo yield differently-bound credentials from one provider instance', () => {
    const provider = createGitHubTokenProvider(makeInput({
      isAppConfigured: () => true,
      mintInstallationToken: (o, r) => `installation-token::${o}/${r}`,
    }));
    const first = provider.credentialEnv(request({ owner: 'acme', repo: 'webapp' }));
    const second = provider.credentialEnv(request({ owner: 'octo', repo: 'infra' }));
    expect(first.GH_TOKEN).toBe('installation-token::acme/webapp');
    expect(second.GH_TOKEN).toBe('installation-token::octo/infra');
  });
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('overlay shape', () => {
  it('carries only the credential variable — no GIT_* keys', () => {
    const provider = createGitHubTokenProvider(makeInput({ pat: 'github-pat-xyz' }));
    const env = provider.credentialEnv(request());
    expect(Object.keys(env)).toEqual(['GH_TOKEN']);
  });

  it('returns a fresh object on every call', () => {
    const provider = createGitHubTokenProvider(makeInput({ pat: 'github-pat-xyz' }));
    const first = provider.credentialEnv(request());
    const second = provider.credentialEnv(request());
    expect(first).not.toBe(second);
  });
});
