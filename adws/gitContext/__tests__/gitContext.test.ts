import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, afterEach } from 'vitest';
import { GitContext } from '../gitContext';
import type { GitContextOptions } from '../types';

const FRAMEWORK_ROOT = '/srv/adw/framework';
const TARGET_REPOS_DIR = '/srv/adw/repos';

function validOptions(overrides: Partial<GitContextOptions> = {}): GitContextOptions {
  return {
    owner: 'acme',
    repo: 'webapp',
    selfHost: false,
    token: 'gh-token-abc',
    gitIdentity: {
      authorName: 'ADW Bot',
      authorEmail: 'bot@adw.dev',
      committerName: 'ADW Bot',
      committerEmail: 'bot@adw.dev',
    },
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
    ...overrides,
  };
}

// ── Base-path selection ───────────────────────────────────────────────────────

describe('base-path selection', () => {
  it('self-host: basePath equals the injected framework repo root', () => {
    const ctx = new GitContext(validOptions({ selfHost: true }));
    expect(ctx.basePath).toBe(FRAMEWORK_ROOT);
  });

  it('target: basePath equals join(targetReposDir, owner, repo)', () => {
    const ctx = new GitContext(validOptions({ selfHost: false, owner: 'acme', repo: 'webapp' }));
    expect(ctx.basePath).toBe(path.join(TARGET_REPOS_DIR, 'acme', 'webapp'));
  });

  it('target: distinct owner/repo pair resolves a distinct basePath', () => {
    const ctx = new GitContext(validOptions({ selfHost: false, owner: 'octo', repo: 'hello-world' }));
    expect(ctx.basePath).toBe(path.join(TARGET_REPOS_DIR, 'octo', 'hello-world'));
  });
});

// ── Incomplete identity ───────────────────────────────────────────────────────

describe('incomplete identity', () => {
  it('throws on empty owner', () => {
    expect(() => new GitContext(validOptions({ owner: '' }))).toThrow(/GitContext/);
  });

  it('throws on whitespace-only owner', () => {
    expect(() => new GitContext(validOptions({ owner: '   ' }))).toThrow(/GitContext/);
  });

  it('throws on empty repo', () => {
    expect(() => new GitContext(validOptions({ repo: '' }))).toThrow(/GitContext/);
  });

  it('throws when selfHost discriminator is omitted (undefined)', () => {
    const opts = validOptions() as unknown as Record<string, unknown>;
    delete opts['selfHost'];
    expect(() => new GitContext(opts as unknown as GitContextOptions)).toThrow(/GitContext/);
  });

  it('throws when selfHost discriminator is not a boolean (string)', () => {
    expect(() => new GitContext(validOptions({ selfHost: 'true' as unknown as boolean }))).toThrow(/GitContext/);
  });

  it('throws on empty token', () => {
    expect(() => new GitContext(validOptions({ token: '' }))).toThrow(/GitContext/);
  });

  it('throws on empty gitIdentity.authorName', () => {
    expect(() => new GitContext(validOptions({ gitIdentity: { authorName: '', authorEmail: 'a@b.com', committerName: 'Bot', committerEmail: 'a@b.com' } }))).toThrow(/GitContext/);
  });

  it('throws on empty gitIdentity.authorEmail', () => {
    expect(() => new GitContext(validOptions({ gitIdentity: { authorName: 'Bot', authorEmail: '', committerName: 'Bot', committerEmail: 'a@b.com' } }))).toThrow(/GitContext/);
  });

  it('throws on empty gitIdentity.committerName', () => {
    expect(() => new GitContext(validOptions({ gitIdentity: { authorName: 'Bot', authorEmail: 'a@b.com', committerName: '', committerEmail: 'a@b.com' } }))).toThrow(/GitContext/);
  });

  it('throws on empty gitIdentity.committerEmail', () => {
    expect(() => new GitContext(validOptions({ gitIdentity: { authorName: 'Bot', authorEmail: 'a@b.com', committerName: 'Bot', committerEmail: '' } }))).toThrow(/GitContext/);
  });

  it('throws on empty frameworkRepoRoot', () => {
    expect(() => new GitContext(validOptions({ frameworkRepoRoot: '' }))).toThrow(/GitContext/);
  });

  it('throws on empty targetReposDir', () => {
    expect(() => new GitContext(validOptions({ targetReposDir: '' }))).toThrow(/GitContext/);
  });

  it('no cwd fallback: target context without targetReposDir throws even when cwd is a git repo', () => {
    expect(() => new GitContext(validOptions({ targetReposDir: '' }))).toThrow(/GitContext/);
  });
});

// ── Worktree path under base ─────────────────────────────────────────────────

describe('worktree-path-under-base', () => {
  const originalCwd = process.cwd();
  afterEach(() => process.chdir(originalCwd));

  it('self-host: worktreePathFor returns path under frameworkRepoRoot', () => {
    const ctx = new GitContext(validOptions({ selfHost: true }));
    const expected = path.join(FRAMEWORK_ROOT, '.worktrees', 'feature-x');
    expect(ctx.worktreePathFor('feature-x')).toBe(expected);
  });

  it('target: worktreePathFor returns path under target workspace .worktrees', () => {
    const ctx = new GitContext(validOptions({ selfHost: false, owner: 'acme', repo: 'webapp' }));
    const expected = path.join(TARGET_REPOS_DIR, 'acme', 'webapp', '.worktrees', 'feature-x');
    expect(ctx.worktreePathFor('feature-x')).toBe(expected);
  });

  it('sanitizes branch name with slash', () => {
    const ctx = new GitContext(validOptions({ selfHost: false }));
    const result = ctx.worktreePathFor('feature/issue-1-x');
    expect(result).toContain('feature-issue-1-x');
    expect(result).toBe(path.join(TARGET_REPOS_DIR, 'acme', 'webapp', '.worktrees', 'feature-issue-1-x'));
  });

  it('sanitizes branch name with special characters', () => {
    const ctx = new GitContext(validOptions({ selfHost: true }));
    const result = ctx.worktreePathFor('feat:name*with?chars');
    expect(result).toBe(path.join(FRAMEWORK_ROOT, '.worktrees', 'feat-name-with-chars'));
  });

  it('is cwd-independent: same result from two different working directories', () => {
    const ctx = new GitContext(validOptions({ selfHost: false }));
    const expected = path.join(TARGET_REPOS_DIR, 'acme', 'webapp', '.worktrees', 'feature-x');
    const result1 = ctx.worktreePathFor('feature-x');
    process.chdir(os.tmpdir());
    const result2 = ctx.worktreePathFor('feature-x');
    expect(result1).toBe(expected);
    expect(result2).toBe(expected);
  });

  it('throws on empty branch', () => {
    const ctx = new GitContext(validOptions());
    expect(() => ctx.worktreePathFor('')).toThrow(/GitContext/);
  });
});

// ── Two-context isolation ────────────────────────────────────────────────────

describe('two-context isolation', () => {
  it('self-host and target contexts resolve distinct basePaths in one process', () => {
    const selfCtx = new GitContext(validOptions({ selfHost: true }));
    const targetCtx = new GitContext(validOptions({ selfHost: false, owner: 'acme', repo: 'webapp' }));
    expect(selfCtx.basePath).toBe(FRAMEWORK_ROOT);
    expect(targetCtx.basePath).toBe(path.join(TARGET_REPOS_DIR, 'acme', 'webapp'));
    expect(selfCtx.basePath).not.toBe(targetCtx.basePath);
  });

  it('two target contexts with different owner/repo resolve distinct worktree paths', () => {
    const ctx1 = new GitContext(validOptions({ selfHost: false, owner: 'acme', repo: 'webapp' }));
    const ctx2 = new GitContext(validOptions({ selfHost: false, owner: 'octo', repo: 'api' }));
    expect(ctx1.worktreePathFor('feature-x')).not.toBe(ctx2.worktreePathFor('feature-x'));
  });

  it('two contexts with different tokens produce distinct commandEnv GH_TOKEN values', () => {
    const ctx1 = new GitContext(validOptions({ token: 'token-1' }));
    const ctx2 = new GitContext(validOptions({ token: 'token-2' }));
    expect(ctx1.commandEnv().GH_TOKEN).toBe('token-1');
    expect(ctx2.commandEnv().GH_TOKEN).toBe('token-2');
  });
});

// ── commandEnv ───────────────────────────────────────────────────────────────

describe('commandEnv', () => {
  const savedToken = process.env['GH_TOKEN'];
  afterEach(() => {
    if (savedToken === undefined) {
      delete process.env['GH_TOKEN'];
    } else {
      process.env['GH_TOKEN'] = savedToken;
    }
  });

  it('result carries GH_TOKEN from the stored token', () => {
    const ctx = new GitContext(validOptions({ token: 'my-token' }));
    expect(ctx.commandEnv().GH_TOKEN).toBe('my-token');
  });

  it('result carries all four GIT_* identity vars', () => {
    const ctx = new GitContext(validOptions({
      gitIdentity: {
        authorName: 'Author',
        authorEmail: 'author@example.com',
        committerName: 'Committer',
        committerEmail: 'committer@example.com',
      },
    }));
    const env = ctx.commandEnv();
    expect(env.GIT_AUTHOR_NAME).toBe('Author');
    expect(env.GIT_AUTHOR_EMAIL).toBe('author@example.com');
    expect(env.GIT_COMMITTER_NAME).toBe('Committer');
    expect(env.GIT_COMMITTER_EMAIL).toBe('committer@example.com');
  });

  it('does not mutate process.env', () => {
    const before = process.env['GH_TOKEN'];
    const ctx = new GitContext(validOptions({ token: 'injected-token' }));
    ctx.commandEnv();
    expect(process.env['GH_TOKEN']).toBe(before);
  });

  it('does not mutate the passed base object', () => {
    const ctx = new GitContext(validOptions());
    const base = { MY_VAR: 'hello' };
    ctx.commandEnv(base);
    expect(base).toEqual({ MY_VAR: 'hello' });
  });

  it('preserves unrelated keys from the base object', () => {
    const ctx = new GitContext(validOptions({ token: 'tok' }));
    const env = ctx.commandEnv({ UNRELATED: 'keep-me' });
    expect(env['UNRELATED']).toBe('keep-me');
    expect(env.GH_TOKEN).toBe('tok');
  });

  it('two calls return independent objects with no cross-contamination', () => {
    const ctx = new GitContext(validOptions({ token: 'tok' }));
    const env1 = ctx.commandEnv();
    const env2 = ctx.commandEnv();
    expect(env1).not.toBe(env2);
    env1.GH_TOKEN = 'mutated';
    expect(env2.GH_TOKEN).toBe('tok');
  });
});

// ── remotes() ────────────────────────────────────────────────────────────────

describe('remotes()', () => {
  it('issues git remote with the context base path as cwd when no cwd provided', () => {
    const calls: Array<{ command: string; cwd: string }> = [];
    const fakeExec = (command: string, options: { cwd: string }) => {
      calls.push({ command, cwd: options.cwd });
      return 'origin\n';
    };
    const ctx = new GitContext(validOptions({ selfHost: true }), { exec: fakeExec as never });
    ctx.remotes();
    expect(calls[0].command).toBe('git remote');
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });

  it('passes explicit cwd override to the exec', () => {
    const calls: Array<{ command: string; cwd: string }> = [];
    const fakeExec = (command: string, options: { cwd: string }) => {
      calls.push({ command, cwd: options.cwd });
      return 'origin\n';
    };
    const ctx = new GitContext(validOptions({ selfHost: true }), { exec: fakeExec as never });
    ctx.remotes('/some/worktree');
    expect(calls[0].cwd).toBe('/some/worktree');
  });

  it('parses multi-line output into a trimmed, empty-filtered array', () => {
    const ctx = new GitContext(validOptions(), {
      exec: () => 'origin\nupstream\n\n' as never,
    });
    expect(ctx.remotes()).toEqual(['origin', 'upstream']);
  });

  it('returns empty array when there are no remotes', () => {
    const ctx = new GitContext(validOptions(), { exec: () => '\n' as never });
    expect(ctx.remotes()).toEqual([]);
  });

  it('does not mutate process.env', () => {
    const before = process.env['GH_TOKEN'];
    const ctx = new GitContext(validOptions({ token: 'remote-tok' }), {
      exec: () => 'origin\n' as never,
    });
    ctx.remotes();
    expect(process.env['GH_TOKEN']).toBe(before);
  });
});

// ── gitConfigUser() ──────────────────────────────────────────────────────────

describe('gitConfigUser()', () => {
  it('returns name and email when both git config reads succeed', () => {
    let callCount = 0;
    const ctx = new GitContext(validOptions(), {
      exec: (cmd: string) => {
        callCount++;
        if (cmd.includes('user.name')) return 'Alice\n' as never;
        if (cmd.includes('user.email')) return 'alice@example.com\n' as never;
        return '' as never;
      },
    });
    const result = ctx.gitConfigUser();
    expect(result).toEqual({ name: 'Alice', email: 'alice@example.com' });
    expect(callCount).toBe(2);
  });

  it('returns null for name when git config user.name throws', () => {
    const ctx = new GitContext(validOptions(), {
      exec: (cmd: string) => {
        if (cmd.includes('user.name')) throw new Error('unset');
        if (cmd.includes('user.email')) return 'alice@example.com\n' as never;
        return '' as never;
      },
    });
    const result = ctx.gitConfigUser();
    expect(result.name).toBeNull();
    expect(result.email).toBe('alice@example.com');
  });

  it('returns null for email when git config user.email throws', () => {
    const ctx = new GitContext(validOptions(), {
      exec: (cmd: string) => {
        if (cmd.includes('user.name')) return 'Alice\n' as never;
        if (cmd.includes('user.email')) throw new Error('unset');
        return '' as never;
      },
    });
    const result = ctx.gitConfigUser();
    expect(result.name).toBe('Alice');
    expect(result.email).toBeNull();
  });

  it('returns { name: null, email: null } when both reads throw', () => {
    const ctx = new GitContext(validOptions(), {
      exec: () => { throw new Error('unset'); },
    });
    const result = ctx.gitConfigUser();
    expect(result).toEqual({ name: null, email: null });
  });

  it('passes explicit cwd to both reads', () => {
    const cwds: string[] = [];
    const ctx = new GitContext(validOptions(), {
      exec: (cmd: string, opts: { cwd: string }) => {
        cwds.push(opts.cwd);
        return 'value\n' as never;
      },
    });
    ctx.gitConfigUser('/custom/cwd');
    expect(cwds).toEqual(['/custom/cwd', '/custom/cwd']);
  });

  it('does not mutate process.env', () => {
    const before = process.env['GH_TOKEN'];
    const ctx = new GitContext(validOptions({ token: 'config-tok' }), {
      exec: () => 'value\n' as never,
    });
    ctx.gitConfigUser();
    expect(process.env['GH_TOKEN']).toBe(before);
  });
});
