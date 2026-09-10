import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { describe, it, expect, afterEach } from 'vitest';
import { GitContext } from '../gitContext';
import type { GitContextOptions, TokenProvider, CredentialRequest } from '../types';
import { createLiteralTokenProvider } from '../../providers/github/githubTokenProvider';

const FRAMEWORK_ROOT = '/srv/adw/framework';
const TARGET_REPOS_DIR = '/srv/adw/repos';

function validOptions(overrides: Partial<GitContextOptions> = {}): GitContextOptions {
  return {
    owner: 'acme',
    repo: 'webapp',
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('gh-token-abc'),
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

  it('throws when tokenProvider is absent', () => {
    const opts = validOptions() as unknown as Record<string, unknown>;
    delete opts['tokenProvider'];
    expect(() => new GitContext(opts as unknown as GitContextOptions)).toThrow(/GitContext/);
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
    const ctx1 = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('token-1') }));
    const ctx2 = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('token-2') }));
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
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('my-token') }));
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
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('injected-token') }));
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
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('tok') }));
    const env = ctx.commandEnv({ UNRELATED: 'keep-me' });
    expect(env['UNRELATED']).toBe('keep-me');
    expect(env.GH_TOKEN).toBe('tok');
  });

  it('two calls return independent objects with no cross-contamination', () => {
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('tok') }));
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
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('remote-tok') }), {
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
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('config-tok') }), {
      exec: () => 'value\n' as never,
    });
    ctx.gitConfigUser();
    expect(process.env['GH_TOKEN']).toBe(before);
  });
});

// ── exec() — public forge-neutral executor ──────────────────────────────────

interface ExecCall {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
}

function makeSpyExec(stdout = 'main\n'): {
  exec: (command: string, options: { cwd: string; env: NodeJS.ProcessEnv; input?: string }) => string;
  calls: ExecCall[];
} {
  const calls: ExecCall[] = [];
  const exec = (command: string, options: { cwd: string; env: NodeJS.ProcessEnv; input?: string }): string => {
    calls.push({ command, cwd: options.cwd, env: options.env, input: options.input });
    return stdout;
  };
  return { exec, calls };
}

describe('exec() — public forge-neutral executor', () => {
  const originalCwd = process.cwd();
  afterEach(() => process.chdir(originalCwd));

  it('passes the command to the fake verbatim and untransformed', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.exec("printf '%s' 'no-forge-meaning'", { cwd: { kind: 'workspace' }, env: {} });
    expect(calls[0].command).toBe("printf '%s' 'no-forge-meaning'");
  });

  it('workspace class with no path records the context base path (target context)', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ selfHost: false }), { exec });
    ctx.exec('git status', { cwd: { kind: 'workspace' }, env: {} });
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('workspace class with no path records the context base path (self-host context)', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ selfHost: true }), { exec });
    ctx.exec('git status', { cwd: { kind: 'workspace' }, env: {} });
    expect(calls[0].cwd).toBe(ctx.basePath);
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });

  it('workspace class with an explicit path narrows to that worktree', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-x';
    ctx.exec('git status', { cwd: { kind: 'workspace', path: worktreePath }, env: {} });
    expect(calls[0].cwd).toBe(worktreePath);
  });

  it('frameworkRoot class records the injected framework root for a target context, distinct from basePath', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ selfHost: false }), { exec });
    ctx.exec('gh api user', { cwd: { kind: 'frameworkRoot' }, env: {} });
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
    expect(calls[0].cwd).not.toBe(ctx.basePath);
  });

  it('frameworkRoot class records the injected framework root even after process.chdir()', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ selfHost: false }), { exec });
    process.chdir(os.tmpdir());
    ctx.exec('gh api user', { cwd: { kind: 'frameworkRoot' }, env: {} });
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
    expect(calls[0].cwd).not.toBe(process.cwd());
  });

  it('records the caller-supplied credential env verbatim', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.exec('gh api user', { cwd: { kind: 'frameworkRoot' }, env: { GH_TOKEN: 'call-scoped-token' } });
    expect(calls[0].env.GH_TOKEN).toBe('call-scoped-token');
  });

  it('two calls on the same context with different env values record different tokens', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.exec('gh api user', { cwd: { kind: 'frameworkRoot' }, env: { GH_TOKEN: 'token-first' } });
    ctx.exec('gh api user', { cwd: { kind: 'frameworkRoot' }, env: { GH_TOKEN: 'token-second' } });
    expect(calls[0].env.GH_TOKEN).toBe('token-first');
    expect(calls[1].env.GH_TOKEN).toBe('token-second');
  });

  it('inherits PATH from process.env when the overlay does not mention it', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.exec('git status', { cwd: { kind: 'workspace' }, env: { GH_TOKEN: 'tok' } });
    expect(calls[0].env.PATH).toBe(process.env.PATH);
  });

  it('does not mutate the caller-supplied env object', () => {
    const { exec } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    const overlay = { GH_TOKEN: 'tok' };
    ctx.exec('git status', { cwd: { kind: 'workspace' }, env: overlay });
    expect(overlay).toEqual({ GH_TOKEN: 'tok' });
  });

  it('does not mutate process.env on the happy path', () => {
    const before = process.env['GH_TOKEN'];
    const { exec } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.exec('git status', { cwd: { kind: 'workspace' }, env: { GH_TOKEN: 'ephemeral' } });
    expect(process.env['GH_TOKEN']).toBe(before);
  });

  it('does not mutate process.env when the fake throws', () => {
    const before = process.env['GH_TOKEN'];
    const ctx = new GitContext(validOptions(), {
      exec: () => { throw new Error('gh: unauthenticated'); },
    });
    expect(() => ctx.exec('git status', { cwd: { kind: 'workspace' }, env: { GH_TOKEN: 'ephemeral' } })).toThrow();
    expect(process.env['GH_TOKEN']).toBe(before);
  });

  it('passes input to the fake when supplied', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.exec('gh api graphql --input -', { cwd: { kind: 'frameworkRoot' }, env: {}, input: 'stdin-payload' });
    expect(calls[0].input).toBe('stdin-payload');
  });

  it('leaves input undefined when omitted', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.exec('git status', { cwd: { kind: 'workspace' }, env: {} });
    expect(calls[0].input).toBeUndefined();
  });

  it('trims trailing whitespace from the fake output', () => {
    const ctx = new GitContext(validOptions(), { exec: () => 'main\n' as never });
    expect(ctx.exec('git branch --show-current', { cwd: { kind: 'workspace' }, env: {} })).toBe('main');
  });

  describe('ENOENT rewrap through the public entry', () => {
    it('rewraps a missing-working-directory ENOENT into an actionable error', () => {
      const targetReposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-790-target-'));
      const frameworkRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-790-framework-'));
      try {
        const ctx = new GitContext(
          validOptions({ frameworkRepoRoot, targetReposDir, owner: 'acme', repo: 'webapp', selfHost: false }),
          {
            exec: () => {
              throw Object.assign(new Error('spawnSync /bin/sh ENOENT'), {
                code: 'ENOENT',
                syscall: 'spawnSync /bin/sh',
                path: '/bin/sh',
              });
            },
          },
        );
        expect(fs.existsSync(ctx.basePath)).toBe(false);
        let caught: unknown;
        try {
          ctx.exec('git status', { cwd: { kind: 'workspace' }, env: {} });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeDefined();
        const error = caught as NodeJS.ErrnoException & { cause?: unknown };
        expect(error.message).toContain(ctx.basePath);
        expect(error.message).toContain('acme/webapp');
        expect(error.message).toContain('selfHost=false');
        expect(error.code).toBe('ENOENT');
        expect(error.cause).toBeDefined();
      } finally {
        fs.rmSync(targetReposDir, { recursive: true, force: true });
        fs.rmSync(frameworkRepoRoot, { recursive: true, force: true });
      }
    });
  });

  it('does not rewrap a non-ENOENT failure — propagates verbatim', () => {
    const sentinel = new Error('gh: unauthenticated');
    const ctx = new GitContext(validOptions(), { exec: () => { throw sentinel; } });
    let caught: unknown;
    try {
      ctx.exec('git status', { cwd: { kind: 'workspace' }, env: {} });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(sentinel);
  });

  it('does not rewrap an ENOENT whose cwd genuinely exists — propagates verbatim', () => {
    const sentinel = Object.assign(new Error('spawnSync /bin/sh ENOENT'), { code: 'ENOENT' });
    const ctx = new GitContext(validOptions(), {
      exec: () => { throw sentinel; },
      fsDeps: { existsSync: () => true, mkdirSync: () => {}, copyFileSync: () => {}, rmSync: () => {} },
    });
    let caught: unknown;
    try {
      ctx.exec('git status', { cwd: { kind: 'workspace' }, env: {} });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(sentinel);
  });

  it('throws on an empty command', () => {
    const ctx = new GitContext(validOptions(), { exec: () => 'out' as never });
    expect(() => ctx.exec('', { cwd: { kind: 'workspace' }, env: {} })).toThrow(/GitContext/);
  });

  it('throws on a whitespace-only command', () => {
    const ctx = new GitContext(validOptions(), { exec: () => 'out' as never });
    expect(() => ctx.exec('   ', { cwd: { kind: 'workspace' }, env: {} })).toThrow(/GitContext/);
  });

  it('throws on an empty explicit worktree path', () => {
    const ctx = new GitContext(validOptions(), { exec: () => 'out' as never });
    expect(() => ctx.exec('git status', { cwd: { kind: 'workspace', path: '' }, env: {} })).toThrow(/GitContext/);
  });
});

// ── exec() options admit no forge-specific parameter (compile-time guard) ───

describe('exec() options admit no forge-specific parameter', () => {
  it('rejects usePat as an excess property at compile time; at runtime the call still executes correctly with it stripped', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    // @ts-expect-error usePat is not part of ExecOptions — the executor is forge-neutral by contract.
    // If a future change re-adds a GitHub-specific parameter to ExecOptions, this directive goes
    // unused and fails the type-check (adw-790 §14).
    ctx.exec('gh api user', { cwd: { kind: 'frameworkRoot' }, env: {}, usePat: true });
    expect(calls[0].command).toBe('gh api user');
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
  });
});

// ── TokenProvider port ───────────────────────────────────────────────────────

function providerOptions(provider: TokenProvider, overrides: Partial<GitContextOptions> = {}): GitContextOptions {
  return { ...validOptions(overrides), tokenProvider: provider };
}

/** A provider whose credentialEnv logs every request and answers from a script. */
function makeRecordingProvider(answer: (request: CredentialRequest, callIndex: number) => NodeJS.ProcessEnv): {
  provider: TokenProvider;
  requests: CredentialRequest[];
} {
  const requests: CredentialRequest[] = [];
  const provider: TokenProvider = {
    credentialEnv(request: CredentialRequest): NodeJS.ProcessEnv {
      requests.push(request);
      return answer(request, requests.length);
    },
  };
  return { provider, requests };
}

/** Answers credential-1, credential-2, credential-3, … by call index. */
function makeIncrementingProvider(): { provider: TokenProvider; requests: CredentialRequest[] } {
  return makeRecordingProvider((_req, callIndex) => ({ GH_TOKEN: `credential-${callIndex}` }));
}

describe('TokenProvider port — per-command resolution', () => {
  it('a recording provider is called once per command, each with the context owner/repo', () => {
    const { provider, requests } = makeRecordingProvider(() => ({ GH_TOKEN: 'tok' }));
    const { exec } = makeSpyExec();
    const ctx = new GitContext(providerOptions(provider, { owner: 'acme', repo: 'webapp' }), { exec });
    ctx.remotes();
    ctx.remoteUrl();
    ctx.headShort();
    // Construction consumes the first answer as a validating probe (discarded);
    // three single-command operations above add three more.
    expect(requests.length).toBe(4);
    for (const req of requests) {
      expect(req.owner).toBe('acme');
      expect(req.repo).toBe('webapp');
    }
  });

  it('no caching: three commands carry three different GH_TOKEN values', () => {
    const { provider } = makeIncrementingProvider();
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(providerOptions(provider), { exec });
    ctx.remotes();
    ctx.remoteUrl();
    ctx.headShort();
    const tokens = calls.map((c) => c.env.GH_TOKEN);
    expect(new Set(tokens).size).toBe(3);
  });

  it('commandEnv itself resolves per call: two calls return different credentials', () => {
    const { provider } = makeIncrementingProvider();
    const ctx = new GitContext(providerOptions(provider));
    const first = ctx.commandEnv().GH_TOKEN;
    const second = ctx.commandEnv().GH_TOKEN;
    expect(first).not.toBe(second);
  });
});

describe('TokenProvider port — purpose routing', () => {
  it("commandEnv reaches the provider with purpose 'alternateIdentity' when explicitly asked — the adapter's seam for approvePR/board-status-move calls", () => {
    const { provider, requests } = makeRecordingProvider(() => ({ GH_TOKEN: 'tok' }));
    const ctx = new GitContext(providerOptions(provider));
    ctx.commandEnv({}, 'alternateIdentity');
    expect(requests[requests.length - 1].purpose).toBe('alternateIdentity');
  });

  it("an ordinary git op reaches the provider with purpose 'default'", () => {
    const { provider, requests } = makeRecordingProvider(() => ({ GH_TOKEN: 'tok' }));
    const { exec } = makeSpyExec();
    const ctx = new GitContext(providerOptions(provider), { exec });
    ctx.remotes();
    ctx.remoteUrl();
    const nonProbeRequests = requests.slice(1);
    for (const req of nonProbeRequests) {
      expect(req.purpose).toBe('default');
    }
  });
});

describe('TokenProvider port — identity precedence', () => {
  it('a provider returning GIT_AUTHOR_NAME does not displace the context gitIdentity', () => {
    const hostileProvider: TokenProvider = {
      credentialEnv: () => ({ GH_TOKEN: 'tok', GIT_AUTHOR_NAME: 'Hijack' }),
    };
    const ctx = new GitContext(providerOptions(hostileProvider, {
      gitIdentity: { authorName: 'Real Author', authorEmail: 'a@b.com', committerName: 'Real Committer', committerEmail: 'c@d.com' },
    }));
    expect(ctx.commandEnv().GIT_AUTHOR_NAME).toBe('Real Author');
  });
});

describe('TokenProvider port — construction validation', () => {
  it('constructs successfully with a tokenProvider', () => {
    const { provider } = makeIncrementingProvider();
    expect(() => new GitContext(providerOptions(provider))).not.toThrow();
  });

  it('no tokenProvider throws /GitContext/', () => {
    const opts = validOptions() as unknown as Record<string, unknown>;
    delete opts['tokenProvider'];
    expect(() => new GitContext(opts as unknown as GitContextOptions)).toThrow(/GitContext/);
  });

  it('a provider returning an empty overlay throws /GitContext/', () => {
    const emptyProvider: TokenProvider = { credentialEnv: () => ({}) };
    expect(() => new GitContext(providerOptions(emptyProvider))).toThrow(/GitContext/);
  });

  it('a provider returning a blank GH_TOKEN throws /GitContext/', () => {
    const blankProvider: TokenProvider = { credentialEnv: () => ({ GH_TOKEN: '' }) };
    expect(() => new GitContext(providerOptions(blankProvider))).toThrow(/GitContext/);
  });

  it('a provider that throws at construction propagates the throw unchanged', () => {
    const sentinel = new Error('provider unavailable');
    const throwingProvider: TokenProvider = { credentialEnv: () => { throw sentinel; } };
    expect(() => new GitContext(providerOptions(throwingProvider))).toThrow(sentinel);
  });
});

describe('TokenProvider port — the construction probe caches nothing', () => {
  it('the first command carries the providers SECOND answer, not the probes first', () => {
    const { provider } = makeIncrementingProvider();
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(providerOptions(provider), { exec });
    ctx.remotes();
    expect(calls[0].env.GH_TOKEN).toBe('credential-2');
  });
});

