/**
 * Unit tests for the launchGitContext boundary-constructor adapter.
 *
 * All I/O is behind injected seams — no real gh/git calls, no network.
 * Mirrors the no-I/O, identity-in/path-out style of gitContext.test.ts.
 */

import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, afterEach } from 'vitest';
import { buildLaunchGitContext } from '../launchGitContext';
import type { LaunchGitContextDeps } from '../launchGitContext';
import type { TargetRepoInfo } from '../../types/issueTypes';
import type { TokenProvider, CredentialRequest } from '../../gitContext';

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
    getRepoInfo: () => ({ owner: 'paysdoc', repo: 'AI_Dev_Workflow' }),
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
    const deps = baseDeps({ getRepoInfo: () => { consulted = true; return { owner: 'should-not-be-used', repo: 'nope' }; } });
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
    const deps = baseDeps({ getRepoInfo: () => ({ owner: 'paysdoc', repo: 'AI_Dev_Workflow' }) });
    const ctx = buildLaunchGitContext(null, deps);
    expect(ctx.owner).toBe('paysdoc');
    expect(ctx.repo).toBe('AI_Dev_Workflow');
  });

  it('getRepoInfo IS consulted for a self-host context', () => {
    let consulted = false;
    const deps = baseDeps({ getRepoInfo: () => { consulted = true; return { owner: 'paysdoc', repo: 'AI_Dev_Workflow' }; } });
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
