/**
 * Unit tests for the webhook per-event boundary resolver.
 *
 * All I/O is behind injected seams — no real gh/git calls, no network.
 * Mirrors launchGitContext.test.ts + feature-664.feature §1–§5.
 */

import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, afterEach } from 'vitest';
import { resolveWebhookRepo } from '../webhookRepoResolver';
import type { WebhookRepoResolution } from '../webhookRepoResolver';
import { buildLaunchGitContext } from '../../core/launchGitContext';
import type { LaunchGitContextDeps } from '../../core/launchGitContext';
import { GitContext } from '../../gitContext';
import type { ExecFn } from '../../gitContext/types';

const FRAMEWORK_ROOT = '/srv/adw/framework';
const TARGET_REPOS_DIR = '/srv/adw/repos';

const TEST_IDENTITY = {
  authorName: 'ADW Test Bot',
  authorEmail: 'bot@test.dev',
  committerName: 'ADW Test Bot',
  committerEmail: 'bot@test.dev',
};

function baseDeps(
  overrides: Partial<LaunchGitContextDeps & { resolveToken: (owner: string, repo: string) => string }> = {},
): LaunchGitContextDeps {
  return {
    getRepoInfo: () => ({ owner: 'paysdoc', repo: 'AI_Dev_Workflow' }),
    resolveToken: () => 'test-gh-token',
    resolveGitIdentity: () => TEST_IDENTITY,
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
    ...overrides,
  };
}

function makePayload(
  owner: string,
  repo: string,
  opts: { token?: string } = {},
): Record<string, unknown> {
  return {
    repository: {
      full_name: `${owner}/${repo}`,
      name: repo,
      owner: { login: owner },
      clone_url: `https://github.com/${owner}/${repo}.git`,
    },
    _token: opts.token, // stash for test helpers
  };
}

function tokenForPayload(payload: Record<string, unknown>): string {
  const token = payload._token as string | undefined;
  return token || 'test-gh-token';
}

type RecordedCall = { command: string; cwd: string; env: NodeJS.ProcessEnv };

function recordingExec(): { exec: ExecFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const exec: ExecFn = (command, options) => {
    calls.push({ command, cwd: options.cwd, env: { ...options.env } });
    // Canned success output for gh repo view
    return 'main';
  };
  return { exec, calls };
}

function buildContextFromPayload(
  payload: Record<string, unknown>,
  deps?: LaunchGitContextDeps,
  execFn?: ExecFn,
): GitContext {
  const resolution = resolveWebhookRepo(payload) as WebhookRepoResolution;
  const token = tokenForPayload(payload);
  const mergedDeps = deps ?? baseDeps({ resolveToken: () => token });
  const ctx = buildLaunchGitContext(resolution.targetRepo, {
    ...mergedDeps,
    resolveToken: () => token,
  });
  if (execFn) {
    // Re-construct with the recording exec injected directly
    return new GitContext(
      {
        owner: ctx.owner,
        repo: ctx.repo,
        selfHost: ctx.selfHost,
        token,
        gitIdentity: TEST_IDENTITY,
        frameworkRepoRoot: FRAMEWORK_ROOT,
        targetReposDir: TARGET_REPOS_DIR,
      },
      { exec: execFn },
    );
  }
  return ctx;
}

// ── Resolver parsing ──────────────────────────────────────────────────────────

describe('resolveWebhookRepo — parsing', () => {
  it('returns null for a payload with no repository', () => {
    expect(resolveWebhookRepo({})).toBeNull();
  });

  it('returns null for a payload with an empty repository object', () => {
    expect(resolveWebhookRepo({ repository: {} })).toBeNull();
  });

  it('returns null when full_name is missing', () => {
    expect(resolveWebhookRepo({ repository: { clone_url: 'https://github.com/x/y.git' } })).toBeNull();
  });

  it('returns null when clone_url and html_url are both missing', () => {
    expect(resolveWebhookRepo({ repository: { full_name: 'x/y' } })).toBeNull();
  });

  it('parses repoInfo from full_name', () => {
    const result = resolveWebhookRepo(makePayload('acme', 'webapp'));
    expect(result).not.toBeNull();
    expect(result!.repoInfo).toEqual({ owner: 'acme', repo: 'webapp' });
  });

  it('builds targetRepo from full_name and clone_url', () => {
    const result = resolveWebhookRepo(makePayload('acme', 'webapp'));
    expect(result!.targetRepo).toEqual({
      owner: 'acme',
      repo: 'webapp',
      cloneUrl: 'https://github.com/acme/webapp.git',
    });
  });

  it('builds targetRepoArgs identical to extractTargetRepoArgs output', () => {
    const result = resolveWebhookRepo(makePayload('acme', 'webapp'));
    expect(result!.targetRepoArgs).toEqual([
      '--target-repo', 'acme/webapp',
      '--clone-url', 'https://github.com/acme/webapp.git',
    ]);
  });
});

// ── §1: A payload → a context at that repo's target workspace ─────────────────

describe('per-event context resolves to payload repository (§1)', () => {
  it('basePath is join(targetReposDir, owner, repo) for acme/webapp', () => {
    const ctx = buildContextFromPayload(makePayload('acme', 'webapp'));
    expect(ctx.basePath).toBe(path.join(TARGET_REPOS_DIR, 'acme', 'webapp'));
  });

  it('basePath is join(targetReposDir, owner, repo) for octo/hello-world', () => {
    const ctx = buildContextFromPayload(makePayload('octo', 'hello-world'));
    expect(ctx.basePath).toBe(path.join(TARGET_REPOS_DIR, 'octo', 'hello-world'));
  });

  it('owner comes from the payload', () => {
    const ctx = buildContextFromPayload(makePayload('acme', 'webapp'));
    expect(ctx.owner).toBe('acme');
  });

  it('repo comes from the payload', () => {
    const ctx = buildContextFromPayload(makePayload('acme', 'webapp'));
    expect(ctx.repo).toBe('webapp');
  });

  it('selfHost is false (target context)', () => {
    const ctx = buildContextFromPayload(makePayload('acme', 'webapp'));
    expect(ctx.selfHost).toBe(false);
  });
});

// ── §2: Per-event independence ────────────────────────────────────────────────

describe('per-event independence — second construction does not mutate first (§2)', () => {
  it('first context retains its owner/repo/basePath after second is constructed', () => {
    const ctxA = buildContextFromPayload(makePayload('acme', 'webapp'));
    // Construct second context for a different repo
    buildContextFromPayload(makePayload('octo', 'other'));

    expect(ctxA.owner).toBe('acme');
    expect(ctxA.repo).toBe('webapp');
    expect(ctxA.basePath).toBe(path.join(TARGET_REPOS_DIR, 'acme', 'webapp'));
  });

  it('both contexts built independently resolve to their own base paths', () => {
    const ctxA = buildContextFromPayload(makePayload('acme', 'webapp'));
    const ctxB = buildContextFromPayload(makePayload('octo', 'other'));

    expect(ctxA.basePath).toBe(path.join(TARGET_REPOS_DIR, 'acme', 'webapp'));
    expect(ctxB.basePath).toBe(path.join(TARGET_REPOS_DIR, 'octo', 'other'));
  });

  it('construction order does not change per-context values (B-then-A same as A-then-B)', () => {
    const ctxB1 = buildContextFromPayload(makePayload('octo', 'other'));
    const ctxA1 = buildContextFromPayload(makePayload('acme', 'webapp'));

    const ctxA2 = buildContextFromPayload(makePayload('acme', 'webapp'));
    const ctxB2 = buildContextFromPayload(makePayload('octo', 'other'));

    expect(ctxA1.basePath).toBe(ctxA2.basePath);
    expect(ctxA1.owner).toBe(ctxA2.owner);
    expect(ctxA1.repo).toBe(ctxA2.repo);
    expect(ctxB1.basePath).toBe(ctxB2.basePath);
  });
});

// ── §3a: Per-event command auth + cwd ────────────────────────────────────────

describe('per-event command runs with context own token and cwd (§3a)', () => {
  it('recorded command env.GH_TOKEN equals the context token', async () => {
    const { exec, calls } = recordingExec();
    const ctx = buildContextFromPayload(makePayload('acme', 'webapp', { token: 'token-acme' }), undefined, exec);
    await ctx.getCurrentBranch();
    expect(calls).toHaveLength(1);
    expect(calls[0].env.GH_TOKEN).toBe('token-acme');
  });

  it('recorded command cwd equals the context basePath', async () => {
    const { exec, calls } = recordingExec();
    const ctx = buildContextFromPayload(makePayload('acme', 'webapp', { token: 'token-acme' }), undefined, exec);
    await ctx.getCurrentBranch();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });
});

// ── §3b: Mid-flight global-overwrite immunity ─────────────────────────────────

describe('mid-flight process.env.GH_TOKEN overwrite does not bleed into per-event command (§3b)', () => {
  const originalToken = process.env.GH_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.GH_TOKEN;
    } else {
      process.env.GH_TOKEN = originalToken;
    }
  });

  it('per-event command still carries own token after global overwrite', async () => {
    const { exec, calls } = recordingExec();
    const ctx = buildContextFromPayload(makePayload('acme', 'webapp', { token: 'token-acme' }), undefined, exec);

    // Simulate a later in-flight event clobbering the global
    process.env.GH_TOKEN = 'token-octo';

    await ctx.getCurrentBranch();
    expect(calls[0].env.GH_TOKEN).toBe('token-acme');
  });

  it('per-event command does not carry the overwritten token', async () => {
    const { exec, calls } = recordingExec();
    const ctx = buildContextFromPayload(makePayload('acme', 'webapp', { token: 'token-acme' }), undefined, exec);

    process.env.GH_TOKEN = 'token-octo';

    await ctx.getCurrentBranch();
    expect(calls[0].env.GH_TOKEN).not.toBe('token-octo');
    // Verify the overwrite token is nowhere in the env values
    const envValues = Object.values(calls[0].env);
    expect(envValues).not.toContain('token-octo');
  });
});

// ── §4: Interleaved two-repo isolation ───────────────────────────────────────

describe('interleaved events for two repos are isolated (§4)', () => {
  it('each context records its own token in the command env', async () => {
    const recA = recordingExec();
    const recB = recordingExec();

    const ctxA = buildContextFromPayload(makePayload('acme', 'alpha', { token: 'token-alpha' }), undefined, recA.exec);
    const ctxB = buildContextFromPayload(makePayload('octo', 'beta', { token: 'token-beta' }), undefined, recB.exec);

    // Interleaved: run op on A, then B
    await ctxA.getCurrentBranch();
    await ctxB.getCurrentBranch();

    expect(recA.calls[0].env.GH_TOKEN).toBe('token-alpha');
    expect(recB.calls[0].env.GH_TOKEN).toBe('token-beta');
  });

  it('each context records its own basePath as cwd', async () => {
    const recA = recordingExec();
    const recB = recordingExec();

    const ctxA = buildContextFromPayload(makePayload('acme', 'alpha', { token: 'token-alpha' }), undefined, recA.exec);
    const ctxB = buildContextFromPayload(makePayload('octo', 'beta', { token: 'token-beta' }), undefined, recB.exec);

    await ctxA.getCurrentBranch();
    await ctxB.getCurrentBranch();

    expect(recA.calls[0].cwd).toBe(path.join(TARGET_REPOS_DIR, 'acme', 'alpha'));
    expect(recB.calls[0].cwd).toBe(path.join(TARGET_REPOS_DIR, 'octo', 'beta'));
  });

  it("context A's command does not carry context B's token", async () => {
    const recA = recordingExec();
    const recB = recordingExec();

    const ctxA = buildContextFromPayload(makePayload('acme', 'alpha', { token: 'token-alpha' }), undefined, recA.exec);
    const ctxB = buildContextFromPayload(makePayload('octo', 'beta', { token: 'token-beta' }), undefined, recB.exec);

    await ctxA.getCurrentBranch();
    await ctxB.getCurrentBranch();

    const aEnvValues = Object.values(recA.calls[0].env);
    expect(aEnvValues).not.toContain('token-beta');
  });

  it("context B's command does not carry context A's token", async () => {
    const recA = recordingExec();
    const recB = recordingExec();

    const ctxA = buildContextFromPayload(makePayload('acme', 'alpha', { token: 'token-alpha' }), undefined, recA.exec);
    const ctxB = buildContextFromPayload(makePayload('octo', 'beta', { token: 'token-beta' }), undefined, recB.exec);

    await ctxA.getCurrentBranch();
    await ctxB.getCurrentBranch();

    const bEnvValues = Object.values(recB.calls[0].env);
    expect(bEnvValues).not.toContain('token-alpha');
  });
});

// ── §5: Payload-determined worktree path (cwd-independent) ───────────────────

describe('worktreePathFor is payload-determined and cwd-independent (§5)', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    if (process.cwd() !== originalCwd) process.chdir(originalCwd);
  });

  it('worktreePathFor resolves under join(targetReposDir, owner, repo, .worktrees, branch)', () => {
    const ctx = buildContextFromPayload(makePayload('acme', 'webapp'));
    const expected = path.join(TARGET_REPOS_DIR, 'acme', 'webapp', '.worktrees', 'feature-x');
    expect(ctx.worktreePathFor('feature-x')).toBe(expected);
  });

  it('worktreePathFor returns the same path from two different working directories', () => {
    const ctx = buildContextFromPayload(makePayload('acme', 'webapp'));
    const path1 = ctx.worktreePathFor('feature-x');
    process.chdir(os.tmpdir());
    const path2 = ctx.worktreePathFor('feature-x');
    expect(path1).toBe(path2);
    expect(path1).toBe(path.join(TARGET_REPOS_DIR, 'acme', 'webapp', '.worktrees', 'feature-x'));
  });
});

// ── Incomplete identity propagation ──────────────────────────────────────────

describe('incomplete identity surfaces the GitContext construction error', () => {
  it('throws when resolved token is empty', () => {
    const resolution = resolveWebhookRepo(makePayload('acme', 'webapp')) as WebhookRepoResolution;
    expect(() =>
      buildLaunchGitContext(resolution.targetRepo, baseDeps({ resolveToken: () => '' })),
    ).toThrow(/GitContext/);
  });
});
