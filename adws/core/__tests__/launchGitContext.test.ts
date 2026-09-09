/**
 * Unit tests for the launchGitContext boundary-constructor adapter.
 *
 * All I/O is behind injected seams — no real gh/git calls, no network.
 * Mirrors the no-I/O, identity-in/path-out style of gitContext.test.ts.
 */

import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';

vi.mock('../../providers/repoContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../providers/repoContext')>()),
  createRepoContext: vi.fn(),
}));

vi.mock('../environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../environment')>()),
  GITHUB_PAT: 'pat-xyz',
}));

vi.mock('../../github/githubAppAuth', () => ({
  isGitHubAppConfigured: () => true,
  getInstallationToken: () => 'app-token',
}));

import { buildLaunchGitContext, buildLaunchBoundary, bindWorkspaceContext, createLaunchTokenProvider } from '../launchGitContext';
import type { LaunchGitContextDeps } from '../launchGitContext';
import type { TargetRepoInfo } from '../../types/issueTypes';
import type { TokenProvider, CredentialRequest } from '../../gitContext';
import { createRepoContext } from '../../providers/repoContext';
import type { MintProvidersOptions } from '../../providers/repoContext';
import type { BoundProviders, RepoContext, RepoIdentifier } from '../../providers/types';
import { Platform } from '../../providers/types';

const mockCreateRepoContext = vi.mocked(createRepoContext);

const FRAMEWORK_ROOT = '/srv/adw/framework';
const TARGET_REPOS_DIR = '/srv/adw/repos';
const TEST_TOKEN = 'test-gh-token-abc';

const TEST_IDENTITY = {
  authorName: 'ADW Test Bot',
  authorEmail: 'bot@test.dev',
  committerName: 'ADW Test Bot',
  committerEmail: 'bot@test.dev',
};

function baseDeps(overrides: Partial<LaunchGitContextDeps> = {}): LaunchGitContextDeps {
  return {
    getRepoInfo: () => ({ owner: 'paysdoc', repo: 'AI_Dev_Workflow', platform: Platform.GitHub }),
    resolveToken: () => TEST_TOKEN,
    resolveGitIdentity: () => TEST_IDENTITY,
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
    ...overrides,
  };
}

function makeTargetRepo(owner: string, repo: string): TargetRepoInfo {
  return { owner, repo, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}

// ── §1: target context from --target-repo ────────────────────────────────────

describe('target context from --target-repo', () => {
  it('basePath is join(targetReposDir, owner, repo)', () => {
    const ctx = buildLaunchGitContext(makeTargetRepo('acme', 'webapp'), baseDeps());
    expect(ctx.basePath).toBe(path.join(TARGET_REPOS_DIR, 'acme', 'webapp'));
  });

  it('selfHost is false for a target context', () => {
    const ctx = buildLaunchGitContext(makeTargetRepo('acme', 'webapp'), baseDeps());
    expect(ctx.selfHost).toBe(false);
  });

  it('owner and repo come from the target arg', () => {
    const ctx = buildLaunchGitContext(makeTargetRepo('acme', 'webapp'), baseDeps());
    expect(ctx.owner).toBe('acme');
    expect(ctx.repo).toBe('webapp');
  });

  it('a distinct owner/repo pair resolves a distinct basePath', () => {
    const ctx1 = buildLaunchGitContext(makeTargetRepo('acme', 'webapp'), baseDeps());
    const ctx2 = buildLaunchGitContext(makeTargetRepo('octo', 'hello-world'), baseDeps());
    expect(ctx1.basePath).toBe(path.join(TARGET_REPOS_DIR, 'acme', 'webapp'));
    expect(ctx2.basePath).toBe(path.join(TARGET_REPOS_DIR, 'octo', 'hello-world'));
    expect(ctx1.basePath).not.toBe(ctx2.basePath);
  });

  it('getRepoInfo is NOT consulted for a target context', () => {
    let consulted = false;
    const deps = baseDeps({ getRepoInfo: () => { consulted = true; return { owner: 'should-not-be-used', repo: 'nope', platform: Platform.GitHub }; } });
    buildLaunchGitContext(makeTargetRepo('acme', 'webapp'), deps);
    expect(consulted).toBe(false);
  });
});

// ── §2: self-host context when no --target-repo ──────────────────────────────

describe('self-host context (no --target-repo)', () => {
  it('basePath equals the injected framework repo root', () => {
    const ctx = buildLaunchGitContext(null, baseDeps());
    expect(ctx.basePath).toBe(FRAMEWORK_ROOT);
  });

  it('selfHost is true for a self-host context', () => {
    const ctx = buildLaunchGitContext(null, baseDeps());
    expect(ctx.selfHost).toBe(true);
  });

  it('owner and repo come from getRepoInfo (local git remote fallback)', () => {
    const deps = baseDeps({ getRepoInfo: () => ({ owner: 'paysdoc', repo: 'AI_Dev_Workflow', platform: Platform.GitHub }) });
    const ctx = buildLaunchGitContext(null, deps);
    expect(ctx.owner).toBe('paysdoc');
    expect(ctx.repo).toBe('AI_Dev_Workflow');
  });

  it('getRepoInfo IS consulted for a self-host context', () => {
    let consulted = false;
    const deps = baseDeps({ getRepoInfo: () => { consulted = true; return { owner: 'paysdoc', repo: 'AI_Dev_Workflow', platform: Platform.GitHub }; } });
    buildLaunchGitContext(null, deps);
    expect(consulted).toBe(true);
  });
});

// ── §3: worktreePathFor under the resolved base ──────────────────────────────

describe('worktreePathFor resolution', () => {
  it('target: worktreePathFor resolves under the target workspace .worktrees', () => {
    const ctx = buildLaunchGitContext(makeTargetRepo('acme', 'webapp'), baseDeps());
    const expected = path.join(TARGET_REPOS_DIR, 'acme', 'webapp', '.worktrees', 'feature-x');
    expect(ctx.worktreePathFor('feature-x')).toBe(expected);
  });

  it('self-host: worktreePathFor resolves under the framework root .worktrees', () => {
    const ctx = buildLaunchGitContext(null, baseDeps());
    const expected = path.join(FRAMEWORK_ROOT, '.worktrees', 'feature-x');
    expect(ctx.worktreePathFor('feature-x')).toBe(expected);
  });
});

// ── §4: cwd-independence ─────────────────────────────────────────────────────

describe('cwd-independence', () => {
  const originalCwd = process.cwd();
  afterEach(() => {
    if (process.cwd() !== originalCwd) process.chdir(originalCwd);
  });

  it('worktreePathFor returns the same path from two different working directories', () => {
    const ctx = buildLaunchGitContext(makeTargetRepo('acme', 'webapp'), baseDeps());
    const path1 = ctx.worktreePathFor('feature-x');
    process.chdir(os.tmpdir());
    const path2 = ctx.worktreePathFor('feature-x');
    expect(path1).toBe(path.join(TARGET_REPOS_DIR, 'acme', 'webapp', '.worktrees', 'feature-x'));
    expect(path2).toBe(path1);
  });
});

// ── §5: identity / token plumbing ────────────────────────────────────────────

describe('identity and token plumbing', () => {
  it('commandEnv carries the resolved token as GH_TOKEN', () => {
    const ctx = buildLaunchGitContext(makeTargetRepo('acme', 'webapp'), baseDeps({ resolveToken: () => 'my-specific-token' }));
    expect(ctx.commandEnv().GH_TOKEN).toBe('my-specific-token');
  });

  it('commandEnv carries all four GIT_* identity vars', () => {
    const identity = {
      authorName: 'Launch Author',
      authorEmail: 'author@launch.dev',
      committerName: 'Launch Committer',
      committerEmail: 'committer@launch.dev',
    };
    const ctx = buildLaunchGitContext(makeTargetRepo('acme', 'webapp'), baseDeps({ resolveGitIdentity: () => identity }));
    const env = ctx.commandEnv();
    expect(env.GIT_AUTHOR_NAME).toBe('Launch Author');
    expect(env.GIT_AUTHOR_EMAIL).toBe('author@launch.dev');
    expect(env.GIT_COMMITTER_NAME).toBe('Launch Committer');
    expect(env.GIT_COMMITTER_EMAIL).toBe('committer@launch.dev');
  });
});

// ── §6: incomplete identity propagates the GitContext construction error ──────

describe('incomplete identity', () => {
  it('throws when resolved token is empty', () => {
    expect(() =>
      buildLaunchGitContext(
        makeTargetRepo('acme', 'webapp'),
        baseDeps({ resolveToken: () => '' }),
      ),
    ).toThrow(/GitContext/);
  });

  it('throws when resolveGitIdentity returns empty authorName', () => {
    expect(() =>
      buildLaunchGitContext(
        makeTargetRepo('acme', 'webapp'),
        baseDeps({
          resolveGitIdentity: () => ({
            authorName: '',
            authorEmail: 'bot@test.dev',
            committerName: 'Bot',
            committerEmail: 'bot@test.dev',
          }),
        }),
      ),
    ).toThrow(/GitContext/);
  });
});

// ── §7: TokenProvider port at the launch boundary ────────────────────────────

function makeIncrementingProvider(): { provider: TokenProvider; requests: CredentialRequest[] } {
  const requests: CredentialRequest[] = [];
  const provider: TokenProvider = {
    credentialEnv(request: CredentialRequest): NodeJS.ProcessEnv {
      requests.push(request);
      return { GH_TOKEN: `credential-${requests.length}` };
    },
  };
  return { provider, requests };
}

describe('TokenProvider port at the launch boundary', () => {
  it('deps.tokenProvider takes precedence over deps.resolveToken', () => {
    let resolveTokenCalled = false;
    const { provider } = makeIncrementingProvider();
    const ctx = buildLaunchGitContext(
      makeTargetRepo('acme', 'webapp'),
      baseDeps({
        tokenProvider: provider,
        resolveToken: () => { resolveTokenCalled = true; return 'should-not-be-used'; },
      }),
    );
    ctx.commandEnv();
    expect(resolveTokenCalled).toBe(false);
  });

  it('a launch context built with a provider resolves per command: two operations, two credentials', () => {
    const { provider } = makeIncrementingProvider();
    const ctx = buildLaunchGitContext(makeTargetRepo('acme', 'webapp'), baseDeps({ tokenProvider: provider }));
    const first = ctx.commandEnv().GH_TOKEN;
    const second = ctx.commandEnv().GH_TOKEN;
    expect(first).not.toBe(second);
  });

  it('a provider that throws surfaces at construction', () => {
    const throwingProvider: TokenProvider = { credentialEnv: () => { throw new Error('provider unavailable'); } };
    expect(() =>
      buildLaunchGitContext(makeTargetRepo('acme', 'webapp'), baseDeps({ tokenProvider: throwingProvider })),
    ).toThrow(/provider unavailable/);
  });

  it('the launch provider serves the same credential for default and alternateIdentity (no alternate identity at this boundary)', () => {
    const ctx = buildLaunchGitContext(
      makeTargetRepo('acme', 'webapp'),
      baseDeps({ resolveToken: () => 'the-only-launch-token' }),
    );
    const ordinary = ctx.commandEnv({}, 'default').GH_TOKEN;
    const elevated = ctx.commandEnv({}, 'alternateIdentity').GH_TOKEN;
    expect(ordinary).toBe('the-only-launch-token');
    expect(elevated).toBe('the-only-launch-token');
  });

  it('deps.resolveToken is adapted into per-command resolution, not resolved once', () => {
    let calls = 0;
    const ctx = buildLaunchGitContext(
      makeTargetRepo('acme', 'webapp'),
      baseDeps({ resolveToken: () => { calls += 1; return `resolved-${calls}`; } }),
    );
    // Construction consumes one call as the validating probe.
    expect(calls).toBe(1);
    const env = ctx.commandEnv();
    expect(env.GH_TOKEN).toBe('resolved-2');
    expect(calls).toBe(2);
  });
});

// ── §7b: createLaunchTokenProvider — alternate-identity PAT parity (#819) ────

describe('createLaunchTokenProvider: alternate-identity PAT parity with gitContextForRepo', () => {
  it('serves GITHUB_PAT to alternateIdentity requests', () => {
    const provider = createLaunchTokenProvider();
    const env = provider.credentialEnv({ owner: 'acme', repo: 'webapp', purpose: 'alternateIdentity' });
    expect(env.GH_TOKEN).toBe('pat-xyz');
  });

  it('serves the App installation token to default requests, unchanged', () => {
    const provider = createLaunchTokenProvider();
    const env = provider.credentialEnv({ owner: 'acme', repo: 'webapp', purpose: 'default' });
    expect(env.GH_TOKEN).toBe('app-token');
  });
});

// ── §8: buildLaunchBoundary — identity binding (AC1/AC4) ─────────────────────

function makeFakeProviders(repoId: RepoIdentifier): BoundProviders {
  return {
    issueTracker: {} as BoundProviders['issueTracker'],
    codeHost: { getRepoIdentifier: () => repoId } as unknown as BoundProviders['codeHost'],
    boardManager: {} as BoundProviders['boardManager'],
  };
}

function makeRecordingMintProviders(): { mintProviders: (o: MintProvidersOptions) => BoundProviders; calls: MintProvidersOptions[] } {
  const calls: MintProvidersOptions[] = [];
  return {
    mintProviders: (o: MintProvidersOptions) => { calls.push(o); return makeFakeProviders(o.repoId); },
    calls,
  };
}

const GITHUB_CONFIG = { codeHost: Platform.GitHub, issueTracker: Platform.GitHub };

describe('buildLaunchBoundary: identity binding', () => {
  it('target boundary: repoId and gitContext report the same owner/repo, and providers.codeHost carries repoId', () => {
    const { mintProviders } = makeRecordingMintProviders();
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps({ mintProviders }));
    expect(boundary.repoId.owner).toBe(boundary.gitContext.owner);
    expect(boundary.repoId.repo).toBe(boundary.gitContext.repo);
    expect(boundary.providers.codeHost.getRepoIdentifier()).toEqual(boundary.repoId);
  });

  it('self-host boundary: repoId and gitContext report the same owner/repo, and providers.codeHost carries repoId', () => {
    const { mintProviders } = makeRecordingMintProviders();
    const boundary = buildLaunchBoundary(null, baseDeps({ mintProviders }));
    expect(boundary.repoId.owner).toBe(boundary.gitContext.owner);
    expect(boundary.repoId.repo).toBe(boundary.gitContext.repo);
    expect(boundary.providers.codeHost.getRepoIdentifier()).toEqual(boundary.repoId);
  });
});

// ── §9: buildLaunchBoundary — divergence foreclosed ───────────────────────────

describe('buildLaunchBoundary: one identity read, not several', () => {
  it('a getRepoInfo seam answering differently on a second call cannot split a self-host boundary\'s identity', () => {
    let calls = 0;
    const answers = [{ owner: 'acme', repo: 'webapp', platform: Platform.GitHub }, { owner: 'octo', repo: 'infra', platform: Platform.GitHub }];
    const getRepoInfo = () => { const a = answers[Math.min(calls, answers.length - 1)]; calls += 1; return a; };
    const { mintProviders } = makeRecordingMintProviders();
    const boundary = buildLaunchBoundary(null, baseDeps({ getRepoInfo, mintProviders }));
    expect(boundary.gitContext.owner).toBe('acme');
    expect(boundary.providers.codeHost.getRepoIdentifier().owner).toBe('acme');
    expect(calls).toBe(1);
  });

  it('getRepoInfo is never consulted for a target boundary, not even once for providers', () => {
    let calls = 0;
    const getRepoInfo = () => { calls += 1; return { owner: 'should-not-be-used', repo: 'nope', platform: Platform.GitHub }; };
    const { mintProviders } = makeRecordingMintProviders();
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps({ getRepoInfo, mintProviders }));
    void boundary.providers;
    expect(calls).toBe(0);
  });
});

// ── §10: buildLaunchBoundary — all providers minted from one identity ────────

describe('buildLaunchBoundary: all providers minted in one recorded call', () => {
  it('mintProviders is invoked exactly once, with the boundary\'s repoId', () => {
    const { mintProviders, calls } = makeRecordingMintProviders();
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps({ mintProviders }));
    // Touch all three — a boundary that minted per-kind would multiply this call count.
    void boundary.providers.issueTracker;
    void boundary.providers.codeHost;
    void boundary.providers.boardManager;
    expect(calls).toHaveLength(1);
    expect(calls[0].repoId).toEqual(boundary.repoId);
  });

  it('mintProviders receives the boundary\'s own GitContext — one construction per process, none inside the adapter', () => {
    const { mintProviders, calls } = makeRecordingMintProviders();
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps({ mintProviders }));
    void boundary.providers;
    expect(calls[0].gitContext).toBe(boundary.gitContext);
  });
});

// ── §11: buildLaunchBoundary — config-driven selection unchanged (AC2) ───────

describe('buildLaunchBoundary: provider selection stays config-driven', () => {
  it('an injected loadProviderConfig reaches mintProviders as exactly the selected platforms', () => {
    const { mintProviders, calls } = makeRecordingMintProviders();
    const loadProviderConfig = () => ({ codeHost: Platform.GitLab, issueTracker: Platform.GitHub });
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps({ loadProviderConfig, mintProviders }));
    void boundary.providers;
    expect(calls[0].codeHostPlatform).toBe(Platform.GitLab);
    expect(calls[0].issueTrackerPlatform).toBe(Platform.GitHub);
  });

  it('a loader returning GitHub defaults yields GitHub for both platforms', () => {
    const { mintProviders, calls } = makeRecordingMintProviders();
    const loadProviderConfig = () => GITHUB_CONFIG;
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps({ loadProviderConfig, mintProviders }));
    void boundary.providers;
    expect(calls[0].codeHostPlatform).toBe(Platform.GitHub);
    expect(calls[0].issueTrackerPlatform).toBe(Platform.GitHub);
  });

  it('target boundary: the loader is called with the target workspace path (join(targetReposDir, owner, repo))', () => {
    const seenDirs: string[] = [];
    const loadProviderConfig = (dir: string) => { seenDirs.push(dir); return GITHUB_CONFIG; };
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps({ loadProviderConfig }));
    void boundary.providers;
    expect(seenDirs).toEqual([path.join(TARGET_REPOS_DIR, 'acme', 'webapp')]);
  });

  it('self-host boundary: the loader is called with the framework repo root', () => {
    const seenDirs: string[] = [];
    const loadProviderConfig = (dir: string) => { seenDirs.push(dir); return GITHUB_CONFIG; };
    const boundary = buildLaunchBoundary(null, baseDeps({ loadProviderConfig }));
    void boundary.providers;
    expect(seenDirs).toEqual([FRAMEWORK_ROOT]);
  });
});

// ── §12: buildLaunchBoundary — deferred, memoised minting ─────────────────────

describe('buildLaunchBoundary: deferred, memoised minting', () => {
  it('building the boundary calls neither the config loader nor the mint seam', () => {
    let loadCalls = 0;
    let mintCalls = 0;
    const loadProviderConfig = () => { loadCalls += 1; return GITHUB_CONFIG; };
    const mintProviders = (o: MintProvidersOptions) => { mintCalls += 1; return makeFakeProviders(o.repoId); };
    buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps({ loadProviderConfig, mintProviders }));
    expect(loadCalls).toBe(0);
    expect(mintCalls).toBe(0);
  });

  it('the first .providers access calls the loader and the mint seam exactly once each', () => {
    let loadCalls = 0;
    let mintCalls = 0;
    const loadProviderConfig = () => { loadCalls += 1; return GITHUB_CONFIG; };
    const mintProviders = (o: MintProvidersOptions) => { mintCalls += 1; return makeFakeProviders(o.repoId); };
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps({ loadProviderConfig, mintProviders }));
    void boundary.providers;
    expect(loadCalls).toBe(1);
    expect(mintCalls).toBe(1);
  });

  it('a second .providers access calls neither seam again and returns the identical object', () => {
    let loadCalls = 0;
    let mintCalls = 0;
    const loadProviderConfig = () => { loadCalls += 1; return GITHUB_CONFIG; };
    const mintProviders = (o: MintProvidersOptions) => { mintCalls += 1; return makeFakeProviders(o.repoId); };
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps({ loadProviderConfig, mintProviders }));
    const first = boundary.providers;
    const second = boundary.providers;
    expect(loadCalls).toBe(1);
    expect(mintCalls).toBe(1);
    expect(second).toBe(first);
  });
});

// ── §13: buildLaunchGitContext — the context-only view is total ──────────────

describe('buildLaunchGitContext: the context-only view gains no new failure mode', () => {
  it('succeeds even when the injected config loader throws — providers are never touched', () => {
    const loadProviderConfig = () => { throw new Error('malformed .adw/providers.md'); };
    const ctx = buildLaunchGitContext(makeTargetRepo('acme', 'webapp'), baseDeps({ loadProviderConfig }));
    expect(ctx.owner).toBe('acme');
    expect(ctx.repo).toBe('webapp');
  });

  it('returns a context whose identity matches a buildLaunchBoundary call with the same arguments', () => {
    const viaContext = buildLaunchGitContext(makeTargetRepo('acme', 'webapp'), baseDeps());
    const viaBoundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps());
    expect(viaContext.owner).toBe(viaBoundary.gitContext.owner);
    expect(viaContext.repo).toBe(viaBoundary.gitContext.repo);
    expect(viaContext.basePath).toBe(viaBoundary.gitContext.basePath);
  });
});

// ── §14: buildLaunchBoundary — default platform ───────────────────────────────

describe('buildLaunchBoundary: RepoIdentifier platform', () => {
  it('defaults to Platform.GitHub when deps.platform is not supplied', () => {
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps());
    expect(boundary.repoId.platform).toBe(Platform.GitHub);
  });

  it('honours an injected deps.platform override', () => {
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps({ platform: Platform.GitLab }));
    expect(boundary.repoId.platform).toBe(Platform.GitLab);
  });
});

// ── §15: bindWorkspaceContext ─────────────────────────────────────────────────

describe('bindWorkspaceContext', () => {
  beforeEach(() => {
    mockCreateRepoContext.mockReset();
  });

  it('passes the boundary\'s providers and the given cwd to createRepoContext, defaulting repoId to the boundary\'s', () => {
    const { mintProviders } = makeRecordingMintProviders();
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps({ mintProviders }));
    const fakeRepoContext = { cwd: '/some/worktree' } as unknown as RepoContext;
    mockCreateRepoContext.mockReturnValue(fakeRepoContext);

    const result = bindWorkspaceContext(boundary, '/some/worktree');

    expect(mockCreateRepoContext).toHaveBeenCalledTimes(1);
    expect(mockCreateRepoContext).toHaveBeenCalledWith({
      repoId: boundary.repoId,
      cwd: '/some/worktree',
      providers: boundary.providers,
    });
    expect(result).toBe(fakeRepoContext);
  });

  it('honours an explicitly-supplied repoId that matches the boundary\'s repository', () => {
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps());
    mockCreateRepoContext.mockReturnValue({} as RepoContext);

    const explicitRepoId: RepoIdentifier = { owner: 'acme', repo: 'webapp', platform: Platform.GitHub };
    bindWorkspaceContext(boundary, '/some/worktree', explicitRepoId);

    expect(mockCreateRepoContext).toHaveBeenCalledWith({
      repoId: explicitRepoId,
      cwd: '/some/worktree',
      providers: boundary.providers,
    });
  });

  it('accepts a case-variant repoId match', () => {
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps());
    mockCreateRepoContext.mockReturnValue({} as RepoContext);

    const variantRepoId: RepoIdentifier = { owner: 'ACME', repo: 'WebApp', platform: Platform.GitHub };
    expect(() => bindWorkspaceContext(boundary, '/some/worktree', variantRepoId)).not.toThrow();
    expect(mockCreateRepoContext).toHaveBeenCalledTimes(1);
  });

  it('refuses a mismatched repoId without calling createRepoContext', () => {
    const boundary = buildLaunchBoundary(makeTargetRepo('acme', 'webapp'), baseDeps());

    const otherRepoId: RepoIdentifier = { owner: 'octo', repo: 'infra', platform: Platform.GitHub };
    expect(() => bindWorkspaceContext(boundary, '/some/worktree', otherRepoId)).toThrow(
      /bindWorkspaceContext: octo\/infra does not match the launch boundary's acme\/webapp/,
    );
    expect(mockCreateRepoContext).not.toHaveBeenCalled();
  });
});
