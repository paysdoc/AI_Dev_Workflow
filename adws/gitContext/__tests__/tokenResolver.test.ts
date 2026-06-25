import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveContextToken } from '../tokenResolver';
import type { ResolveContextTokenInput } from '../tokenResolver';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<ResolveContextTokenInput> = {}): ResolveContextTokenInput {
  return {
    owner: 'acme',
    repo: 'webapp',
    pat: undefined,
    isAppConfigured: () => false,
    mintInstallationToken: () => { throw new Error('mint should not be called'); },
    ghAuthToken: () => '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Sentinel: process.env.GH_TOKEN must NEVER be read
// ---------------------------------------------------------------------------

const SENTINEL = 'sentinel-gh-token-must-not-leak';

beforeEach(() => { process.env.GH_TOKEN = SENTINEL; });
afterEach(() => { delete process.env.GH_TOKEN; });

// ---------------------------------------------------------------------------
// App-configured — returns bound mint
// ---------------------------------------------------------------------------

describe('App configured + installed → bound mint', () => {
  it('returns the mint bound to the specific owner/repo', () => {
    const result = resolveContextToken(makeInput({
      owner: 'acme',
      repo: 'webapp',
      isAppConfigured: () => true,
      mintInstallationToken: (o, r) => `installation-token::${o}/${r}`,
    }));
    expect(result).toBe('installation-token::acme/webapp');
  });

  it('returned token is NOT the sentinel process.env.GH_TOKEN', () => {
    const result = resolveContextToken(makeInput({
      isAppConfigured: () => true,
      mintInstallationToken: () => 'bound-mint',
    }));
    expect(result).not.toBe(SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// App-configured + foreign identity → throws loudly (no fallback)
// ---------------------------------------------------------------------------

describe('App configured + foreign/uninstalled → throws loudly', () => {
  it('propagates the mint error without substituting the ambient sentinel', () => {
    expect(() =>
      resolveContextToken(makeInput({
        owner: 'acme',
        repo: 'webapp',
        isAppConfigured: () => true,
        mintInstallationToken: () => { throw new Error('App not installed on acme/webapp'); },
        // GH_TOKEN sentinel is in process.env — must NOT be returned
      }))
    ).toThrow(/App not installed/);
  });

  it('does not return the ambient sentinel token on mint failure', () => {
    let threw = false;
    try {
      resolveContextToken(makeInput({
        isAppConfigured: () => true,
        mintInstallationToken: () => { throw new Error('foreign'); },
      }));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // If it hadn't thrown, it would have returned the sentinel — the throw IS the proof
  });
});

// ---------------------------------------------------------------------------
// App not configured — PAT path
// ---------------------------------------------------------------------------

describe('App not configured + PAT present → returns PAT', () => {
  it('returns the PAT when App is not configured', () => {
    const result = resolveContextToken(makeInput({
      pat: 'github-pat-xyz',
      isAppConfigured: () => false,
    }));
    expect(result).toBe('github-pat-xyz');
    expect(result).not.toBe(SENTINEL);
  });

  it('ignores a whitespace-only PAT', () => {
    expect(() =>
      resolveContextToken(makeInput({
        pat: '   ',
        isAppConfigured: () => false,
        ghAuthToken: () => '',
      }))
    ).toThrow(/no veracious token/);
  });
});

// ---------------------------------------------------------------------------
// App not configured, no PAT — gh auth token path
// ---------------------------------------------------------------------------

describe('App not configured + no PAT + gh auth token → returns it', () => {
  it('returns gh auth token when PAT is absent', () => {
    const result = resolveContextToken(makeInput({
      isAppConfigured: () => false,
      ghAuthToken: () => 'ghs-from-gh-cli',
    }));
    expect(result).toBe('ghs-from-gh-cli');
    expect(result).not.toBe(SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// No token source available → throws "no veracious token"
// ---------------------------------------------------------------------------

describe('No token source available → throws', () => {
  it('throws naming the owner/repo when nothing is available', () => {
    expect(() =>
      resolveContextToken(makeInput({
        owner: 'acme',
        repo: 'webapp',
        isAppConfigured: () => false,
        pat: undefined,
        ghAuthToken: () => '',
      }))
    ).toThrow(/no veracious token for acme\/webapp/);
  });

  it('does not return the sentinel process.env.GH_TOKEN', () => {
    // process.env.GH_TOKEN = SENTINEL (set in beforeEach)
    // resolveContextToken must NOT read it — throws instead
    expect(() =>
      resolveContextToken(makeInput({
        isAppConfigured: () => false,
        ghAuthToken: () => '',
      }))
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Per-owner/repo binding (two different repos → two different mints)
// ---------------------------------------------------------------------------

describe('mint is bound per owner/repo', () => {
  it('returns different tokens for different owner/repo pairs', () => {
    const mint = (o: string, r: string) => `installation-token::${o}/${r}`;
    const t1 = resolveContextToken(makeInput({ owner: 'acme', repo: 'webapp', isAppConfigured: () => true, mintInstallationToken: mint }));
    const t2 = resolveContextToken(makeInput({ owner: 'octo', repo: 'infra', isAppConfigured: () => true, mintInstallationToken: mint }));
    expect(t1).toBe('installation-token::acme/webapp');
    expect(t2).toBe('installation-token::octo/infra');
    expect(t1).not.toBe(t2);
  });
});
