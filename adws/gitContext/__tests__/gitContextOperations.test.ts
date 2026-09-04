import { describe, it, expect, afterEach } from 'vitest';
import { GitContext } from '../gitContext';
import type { GitContextOptions, ExecFn } from '../types';

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

interface SpyCall {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
}

function makeSpyExec(stdout = 'main\n'): { exec: ExecFn; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const exec: ExecFn = (command, options) => {
    calls.push({ command, cwd: options.cwd, env: options.env, input: options.input });
    return stdout;
  };
  return { exec, calls };
}

// ── remoteUrl() ─────────────────────────────────────────────────────────────

describe('remoteUrl() command and env', () => {
  it('builds exactly git remote get-url origin', () => {
    const { exec, calls } = makeSpyExec('git@github.com:acme/webapp.git\n');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    ctx.remoteUrl();
    expect(calls[0].command).toBe('git remote get-url origin');
  });

  it('passes cwd equal to the context base path when no arg given', () => {
    const { exec, calls } = makeSpyExec('git@github.com:acme/webapp.git\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.remoteUrl();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('passes an explicit cwd when one is supplied', () => {
    const { exec, calls } = makeSpyExec('git@github.com:acme/webapp.git\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.remoteUrl('/tmp/worktree');
    expect(calls[0].cwd).toBe('/tmp/worktree');
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('git@github.com:acme/webapp.git\n');
    const ctx = new GitContext(validOptions({ token: 'remote-token' }), { exec });
    ctx.remoteUrl();
    expect(calls[0].env.GH_TOKEN).toBe('remote-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('git@github.com:acme/webapp.git\n');
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'Remote Bot', authorEmail: 'remote@bot.dev',
          committerName: 'Remote Bot', committerEmail: 'remote@bot.dev',
        },
      }),
      { exec },
    );
    ctx.remoteUrl();
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Remote Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('remote@bot.dev');
    expect(calls[0].env.GIT_COMMITTER_NAME).toBe('Remote Bot');
    expect(calls[0].env.GIT_COMMITTER_EMAIL).toBe('remote@bot.dev');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('git@github.com:acme/webapp.git\n');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.remoteUrl();
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('returns trimmed stdout', () => {
    const { exec } = makeSpyExec('git@github.com:acme/webapp.git\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.remoteUrl()).toBe('git@github.com:acme/webapp.git');
  });

  it('inherits unrelated env keys (PATH survives in the child env)', () => {
    const { exec, calls } = makeSpyExec('git@github.com:acme/webapp.git\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.remoteUrl();
    expect(calls[0].env['PATH']).toBe(process.env['PATH']);
  });
});

// ── Two-context isolation ────────────────────────────────────────────────────
// The repo-API half of this contract (two contexts, two tokens, both at the
// shared framework-rooted cwd) relocated to the adapter's own suite alongside
// the methods that carried it — see `adws/providers/github/__tests__/ghRepoApi.test.ts`.
// What remains is the git half: two contexts still isolate their own per-repo cwd.

describe('two-context isolation', () => {
  it('two contexts in one process each spawn their git command with their own per-repo cwd', () => {
    const { exec: spyA, calls: callsA } = makeSpyExec('main\n');
    const { exec: spyB, calls: callsB } = makeSpyExec('main\n');

    const ctxA = new GitContext(
      validOptions({ owner: 'acme', repo: 'alpha', token: 'token-alpha' }),
      { exec: spyA },
    );
    const ctxB = new GitContext(
      validOptions({ owner: 'octo', repo: 'beta', token: 'token-beta' }),
      { exec: spyB },
    );

    ctxA.getCurrentBranch();
    ctxB.getCurrentBranch();

    expect(callsA[0].cwd).toBe(ctxA.basePath);
    expect(callsB[0].cwd).toBe(ctxB.basePath);
    expect(callsA[0].cwd).not.toBe(callsB[0].cwd);
  });
});

// ── Ambient-bleed resistance ─────────────────────────────────────────────────
// Vehicle swapped from the deleted defaultBranch() to getCurrentBranch(): the
// property under test — the TokenProvider port's answer overrides a stale
// process.env.GH_TOKEN, and the parent env is never mutated — is a `commandEnv()`
// guarantee, not specific to any one operation.

describe('ambient-bleed resistance', () => {
  const savedToken = process.env['GH_TOKEN'];
  afterEach(() => {
    if (savedToken === undefined) {
      delete process.env['GH_TOKEN'];
    } else {
      process.env['GH_TOKEN'] = savedToken;
    }
  });

  it('context token overrides a stale process.env.GH_TOKEN in the child env', () => {
    process.env['GH_TOKEN'] = 'stale-global-token';
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ token: 'context-token' }), { exec });
    ctx.getCurrentBranch();
    expect(calls[0].env.GH_TOKEN).toBe('context-token');
  });

  it('parent process.env.GH_TOKEN remains the stale value after the op', () => {
    process.env['GH_TOKEN'] = 'stale-global-token';
    const { exec } = makeSpyExec();
    const ctx = new GitContext(validOptions({ token: 'context-token' }), { exec });
    ctx.getCurrentBranch();
    expect(process.env['GH_TOKEN']).toBe('stale-global-token');
  });
});

// ── Error propagation ────────────────────────────────────────────────────────
// Vehicle swapped from the deleted defaultBranch() to getCurrentBranch(): the
// property under test is exec()'s own passthrough/non-mutation guarantee.

describe('error propagation', () => {
  const savedToken = process.env['GH_TOKEN'];
  afterEach(() => {
    if (savedToken === undefined) {
      delete process.env['GH_TOKEN'];
    } else {
      process.env['GH_TOKEN'] = savedToken;
    }
  });

  it('surfaces exec errors at the system boundary', () => {
    const exec: ExecFn = () => { throw new Error('git: not a repository'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(() => ctx.getCurrentBranch()).toThrow('git: not a repository');
  });

  it('does not mutate process.env when exec throws', () => {
    process.env['GH_TOKEN'] = 'before-throw';
    const exec: ExecFn = () => { throw new Error('spawn failed'); };
    const ctx = new GitContext(validOptions({ token: 'ctx-token' }), { exec });
    try { ctx.getCurrentBranch(); } catch { /* expected */ }
    expect(process.env['GH_TOKEN']).toBe('before-throw');
  });
});

// ── cwd is explicit, not inherited from process.cwd() ───────────────────────
// The repo-API half (frameworkRoot cwd survives process.chdir()) relocated to
// `adws/gitContext/__tests__/repoApiCwd.test.ts`'s exec()-level suite.

describe('explicit cwd (not process.cwd())', () => {
  const originalCwd = process.cwd();
  afterEach(() => process.chdir(originalCwd));

  it('a git command uses the base path even after process.chdir()', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    const expectedBasePath = ctx.basePath;
    process.chdir('/tmp');
    ctx.getCurrentBranch();
    expect(calls[0].cwd).toBe(expectedBasePath);
    expect(calls[0].cwd).not.toBe('/tmp');
  });
});

// ── resolveGitDir() ──────────────────────────────────────────────────────────

describe('resolveGitDir() command and env', () => {
  const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-foo';

  it('builds exactly git rev-parse --git-dir', () => {
    const { exec, calls } = makeSpyExec('/srv/adw/repos/acme/webapp/.git/worktrees/feat\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.resolveGitDir(worktreePath);
    expect(calls[0].command).toBe('git rev-parse --git-dir');
  });

  it('passes the supplied worktree path as cwd', () => {
    const { exec, calls } = makeSpyExec('/srv/adw/repos/acme/webapp/.git/worktrees/feat\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.resolveGitDir(worktreePath);
    expect(calls[0].cwd).toBe(worktreePath);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('/srv/adw/repos/acme/webapp/.git/worktrees/feat\n');
    const ctx = new GitContext(validOptions({ token: 'probe-token' }), { exec });
    ctx.resolveGitDir(worktreePath);
    expect(calls[0].env.GH_TOKEN).toBe('probe-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('/abs/.git\n');
    const ctx = new GitContext(validOptions({ gitIdentity: { authorName: 'P', authorEmail: 'p@e.co', committerName: 'P', committerEmail: 'p@e.co' } }), { exec });
    ctx.resolveGitDir(worktreePath);
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('P');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('p@e.co');
  });

  it('returns null when exec throws (detached or missing)', () => {
    const exec: ExecFn = () => { throw new Error('not a git dir'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.resolveGitDir(worktreePath)).toBeNull();
  });

  it('absolutizes a relative .git path', () => {
    const { exec } = makeSpyExec('.git\n');
    const ctx = new GitContext(validOptions(), { exec });
    const result = ctx.resolveGitDir(worktreePath);
    expect(result).toBe(`${worktreePath}/.git`);
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('/abs/.git\n');
    const ctx = new GitContext(validOptions({ token: 'inject' }), { exec });
    ctx.resolveGitDir(worktreePath);
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── currentBranchSymbolic() ──────────────────────────────────────────────────

describe('currentBranchSymbolic() command and env', () => {
  const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-foo';

  it('builds exactly git symbolic-ref --short HEAD', () => {
    const { exec, calls } = makeSpyExec('feature-issue-1-foo\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.currentBranchSymbolic(worktreePath);
    expect(calls[0].command).toBe('git symbolic-ref --short HEAD');
  });

  it('passes the supplied worktree path as cwd', () => {
    const { exec, calls } = makeSpyExec('feature-issue-1-foo\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.currentBranchSymbolic(worktreePath);
    expect(calls[0].cwd).toBe(worktreePath);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('some-branch\n');
    const ctx = new GitContext(validOptions({ token: 'sym-token' }), { exec });
    ctx.currentBranchSymbolic(worktreePath);
    expect(calls[0].env.GH_TOKEN).toBe('sym-token');
  });

  it('returns null when exec throws (detached HEAD)', () => {
    const exec: ExecFn = () => { throw new Error('HEAD is detached'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.currentBranchSymbolic(worktreePath)).toBeNull();
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('some-branch\n');
    const ctx = new GitContext(validOptions({ token: 'inject' }), { exec });
    ctx.currentBranchSymbolic(worktreePath);
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── worktreeRegistration() ───────────────────────────────────────────────────

describe('worktreeRegistration() command and env', () => {
  const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-foo';

  const porcelainFor = (wt: string, extra = '') => `worktree ${wt}\nHEAD abc123\nbranch refs/heads/feat\n${extra}\n`;

  it('builds exactly git worktree list --porcelain', () => {
    const { exec, calls } = makeSpyExec(porcelainFor(worktreePath));
    const ctx = new GitContext(validOptions(), { exec });
    ctx.worktreeRegistration(worktreePath);
    expect(calls[0].command).toBe('git worktree list --porcelain');
  });

  it('passes the supplied worktree path as cwd', () => {
    const { exec, calls } = makeSpyExec(porcelainFor(worktreePath));
    const ctx = new GitContext(validOptions(), { exec });
    ctx.worktreeRegistration(worktreePath);
    expect(calls[0].cwd).toBe(worktreePath);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec(porcelainFor(worktreePath));
    const ctx = new GitContext(validOptions({ token: 'reg-token' }), { exec });
    ctx.worktreeRegistration(worktreePath);
    expect(calls[0].env.GH_TOKEN).toBe('reg-token');
  });

  it("returns 'healthy' for a present worktree with no locked/prunable", () => {
    const { exec } = makeSpyExec(porcelainFor(worktreePath));
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.worktreeRegistration(worktreePath)).toBe('healthy');
  });

  it("returns 'locked' for a locked worktree", () => {
    const { exec } = makeSpyExec(porcelainFor(worktreePath, 'locked reason'));
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.worktreeRegistration(worktreePath)).toBe('locked');
  });

  it("returns 'prunable' for a prunable worktree", () => {
    const { exec } = makeSpyExec(porcelainFor(worktreePath, 'prunable gitdir file points to non-existent location'));
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.worktreeRegistration(worktreePath)).toBe('prunable');
  });

  it("returns 'missing' when path not in list", () => {
    const { exec } = makeSpyExec(porcelainFor('/other/path'));
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.worktreeRegistration(worktreePath)).toBe('missing');
  });

  it("returns 'missing' when exec throws", () => {
    const exec: ExecFn = () => { throw new Error('not a git repo'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.worktreeRegistration(worktreePath)).toBe('missing');
  });
});

// ── worktreeBranches() ───────────────────────────────────────────────────────

describe('worktreeBranches() command and env', () => {
  const basePath = '/srv/adw/repos/acme/webapp';
  const porcelainWithBranches = `worktree ${basePath}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${basePath}/.worktrees/feat\nHEAD def\nbranch refs/heads/feature-issue-1-foo\n\n`;

  it('builds exactly git worktree list --porcelain', () => {
    const { exec, calls } = makeSpyExec(porcelainWithBranches);
    const ctx = new GitContext(validOptions(), { exec });
    ctx.worktreeBranches();
    expect(calls[0].command).toBe('git worktree list --porcelain');
  });

  it('defaults cwd to the context base path', () => {
    const { exec, calls } = makeSpyExec(porcelainWithBranches);
    const ctx = new GitContext(validOptions(), { exec });
    ctx.worktreeBranches();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('uses the supplied cwd when provided', () => {
    const { exec, calls } = makeSpyExec(porcelainWithBranches);
    const ctx = new GitContext(validOptions(), { exec });
    ctx.worktreeBranches('/custom/cwd');
    expect(calls[0].cwd).toBe('/custom/cwd');
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec(porcelainWithBranches);
    const ctx = new GitContext(validOptions({ token: 'wt-token' }), { exec });
    ctx.worktreeBranches();
    expect(calls[0].env.GH_TOKEN).toBe('wt-token');
  });

  it('strips refs/heads/ prefix from branch lines', () => {
    const { exec } = makeSpyExec(porcelainWithBranches);
    const ctx = new GitContext(validOptions(), { exec });
    const branches = ctx.worktreeBranches();
    expect(branches).toContain('main');
    expect(branches).toContain('feature-issue-1-foo');
    expect(branches.every(b => !b.startsWith('refs/'))).toBe(true);
  });

  it('returns [] when exec throws', () => {
    const exec: ExecFn = () => { throw new Error('not a git repo'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.worktreeBranches()).toEqual([]);
  });
});

// ── localBranches() ──────────────────────────────────────────────────────────

describe('localBranches() command and env', () => {
  const branchListOutput = '* feature-issue-1-foo\n  main\n  dev\n';

  it('builds exactly git branch --list', () => {
    const { exec, calls } = makeSpyExec(branchListOutput);
    const ctx = new GitContext(validOptions(), { exec });
    ctx.localBranches();
    expect(calls[0].command).toBe('git branch --list');
  });

  it('defaults cwd to the context base path', () => {
    const { exec, calls } = makeSpyExec(branchListOutput);
    const ctx = new GitContext(validOptions(), { exec });
    ctx.localBranches();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('uses the supplied cwd when provided', () => {
    const { exec, calls } = makeSpyExec(branchListOutput);
    const ctx = new GitContext(validOptions(), { exec });
    ctx.localBranches('/custom/cwd');
    expect(calls[0].cwd).toBe('/custom/cwd');
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec(branchListOutput);
    const ctx = new GitContext(validOptions({ token: 'lb-token' }), { exec });
    ctx.localBranches();
    expect(calls[0].env.GH_TOKEN).toBe('lb-token');
  });

  it('strips leading * and whitespace markers', () => {
    const { exec } = makeSpyExec(branchListOutput);
    const ctx = new GitContext(validOptions(), { exec });
    const branches = ctx.localBranches();
    expect(branches).toContain('feature-issue-1-foo');
    expect(branches).toContain('main');
    expect(branches).toContain('dev');
    expect(branches.every(b => !b.startsWith('*'))).toBe(true);
  });

  it('returns [] when exec throws', () => {
    const exec: ExecFn = () => { throw new Error('not a git repo'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.localBranches()).toEqual([]);
  });
});

// ── mainRepoPath() ───────────────────────────────────────────────────────────

describe('mainRepoPath() command and env', () => {
  const basePath = '/srv/adw/repos/acme/webapp';
  const porcelainWithMain = `worktree ${basePath}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${basePath}/.worktrees/feat\nHEAD def\nbranch refs/heads/feature-issue-1-foo\n\n`;

  it('builds exactly git worktree list --porcelain', () => {
    const { exec, calls } = makeSpyExec(porcelainWithMain);
    const ctx = new GitContext(validOptions(), { exec });
    ctx.mainRepoPath();
    expect(calls[0].command).toBe('git worktree list --porcelain');
  });

  it('defaults cwd to the context base path', () => {
    const { exec, calls } = makeSpyExec(porcelainWithMain);
    const ctx = new GitContext(validOptions(), { exec });
    ctx.mainRepoPath();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('uses the supplied cwd when provided', () => {
    const { exec, calls } = makeSpyExec(porcelainWithMain);
    const ctx = new GitContext(validOptions(), { exec });
    ctx.mainRepoPath('/custom/cwd');
    expect(calls[0].cwd).toBe('/custom/cwd');
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec(porcelainWithMain);
    const ctx = new GitContext(validOptions({ token: 'mr-token' }), { exec });
    ctx.mainRepoPath();
    expect(calls[0].env.GH_TOKEN).toBe('mr-token');
  });

  it('returns the first entry not under .worktrees', () => {
    const { exec } = makeSpyExec(porcelainWithMain);
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.mainRepoPath()).toBe(basePath);
  });

  it('throws when no main entry exists (only .worktrees entries)', () => {
    const onlyWorktree = `worktree ${basePath}/.worktrees/feat\nHEAD def\nbranch refs/heads/feature-issue-1-foo\n\n`;
    const { exec } = makeSpyExec(onlyWorktree);
    const ctx = new GitContext(validOptions(), { exec });
    expect(() => ctx.mainRepoPath()).toThrow('Could not find main repository in worktree list');
  });

  it('throws when exec throws', () => {
    const exec: ExecFn = () => { throw new Error('not a git repo'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(() => ctx.mainRepoPath()).toThrow();
  });
});

// ── fetchRemote() ─────────────────────────────────────────────────────────────

describe('fetchRemote() command and env', () => {
  const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-foo';

  it('builds git fetch origin "<branch>"', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.fetchRemote('main', worktreePath);
    expect(calls[0].command).toBe('git fetch origin "main"');
  });

  it('passes the supplied cwd', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.fetchRemote('main', worktreePath);
    expect(calls[0].cwd).toBe(worktreePath);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'fetch-token' }), { exec });
    ctx.fetchRemote('main', worktreePath);
    expect(calls[0].env.GH_TOKEN).toBe('fetch-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(
      validOptions({ gitIdentity: { authorName: 'Fetch Bot', authorEmail: 'fetch@bot.dev', committerName: 'Fetch Bot', committerEmail: 'fetch@bot.dev' } }),
      { exec },
    );
    ctx.fetchRemote('main', worktreePath);
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Fetch Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('fetch@bot.dev');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.fetchRemote('main', worktreePath);
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── mergeBranch() ─────────────────────────────────────────────────────────────

describe('mergeBranch() command and env', () => {
  const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-foo';

  it('issues git merge "<ref>" with no flags when opts is omitted', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.mergeBranch('origin/main', worktreePath);
    expect(calls[0].command).toBe('git merge "origin/main"');
  });

  it('includes --no-commit --no-ff flags', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.mergeBranch('origin/main', worktreePath, { noCommit: true, noFf: true });
    expect(calls[0].command).toBe('git merge --no-commit --no-ff "origin/main"');
  });

  it('includes --no-edit flag', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.mergeBranch('origin/main', worktreePath, { noEdit: true });
    expect(calls[0].command).toBe('git merge --no-edit "origin/main"');
  });

  it('passes the supplied cwd', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.mergeBranch('origin/main', worktreePath);
    expect(calls[0].cwd).toBe(worktreePath);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'merge-token' }), { exec });
    ctx.mergeBranch('origin/main', worktreePath);
    expect(calls[0].env.GH_TOKEN).toBe('merge-token');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.mergeBranch('origin/main', worktreePath);
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── abortMerge() ──────────────────────────────────────────────────────────────

describe('abortMerge() command and env', () => {
  const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-foo';

  it('issues git merge --abort', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.abortMerge(worktreePath);
    expect(calls[0].command).toBe('git merge --abort');
  });

  it('passes the supplied cwd', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.abortMerge(worktreePath);
    expect(calls[0].cwd).toBe(worktreePath);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'abort-token' }), { exec });
    ctx.abortMerge(worktreePath);
    expect(calls[0].env.GH_TOKEN).toBe('abort-token');
  });

  it('swallows exec errors (no merge in progress is benign)', () => {
    const exec: ExecFn = () => { throw new Error('fatal: There is no merge to abort.'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(() => ctx.abortMerge(worktreePath)).not.toThrow();
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.abortMerge(worktreePath);
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── logSince() ────────────────────────────────────────────────────────────────

describe('logSince() command and env', () => {
  it('issues git log --since with grep and oneline flags (numerator shape)', () => {
    const { exec, calls } = makeSpyExec('commit output\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.logSince({ since: 'X', grep: '^regression-promotion:', oneline: true });
    expect(calls[0].command).toBe('git log --since="X" --grep="^regression-promotion:" --no-merges --oneline');
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('issues git log --since with patch and pathspec flags (denominator shape)', () => {
    const { exec, calls } = makeSpyExec('diff output\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.logSince({ since: 'X', patch: true, pathspec: 'features/per-issue/feature-*.feature' });
    expect(calls[0].command).toBe('git log --since="X" --no-merges -p -- features/per-issue/feature-*.feature');
  });

  it('honors an explicit cwd', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.logSince({ since: 'X' }, '/some/wt');
    expect(calls[0].cwd).toBe('/some/wt');
  });

  it('defaults cwd to the context base path when no cwd is given', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.logSince({ since: 'X' });
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'token-acme' }), { exec });
    ctx.logSince({ since: 'X', grep: '^regression-promotion:', oneline: true });
    expect(calls[0].env.GH_TOKEN).toBe('token-acme');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'Acme Bot', authorEmail: 'bot@acme.dev',
          committerName: 'Acme Bot', committerEmail: 'bot@acme.dev',
        },
      }),
      { exec },
    );
    ctx.logSince({ since: 'X', grep: '^regression-promotion:', oneline: true });
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Acme Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('bot@acme.dev');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.logSince({ since: 'X' });
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── lsRemote() ───────────────────────────────────────────────────────────────

describe('lsRemote() command and env', () => {
  const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-foo';

  it('issues git ls-remote origin "<branch>"', () => {
    const { exec, calls } = makeSpyExec('abc123\trefs/heads/main\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.lsRemote('main', worktreePath);
    expect(calls[0].command).toBe('git ls-remote origin "main"');
  });

  it('passes the supplied cwd', () => {
    const { exec, calls } = makeSpyExec('abc123\trefs/heads/main\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.lsRemote('main', worktreePath);
    expect(calls[0].cwd).toBe(worktreePath);
  });

  it('defaults cwd to the context base path when no cwd is given', () => {
    const { exec, calls } = makeSpyExec('abc123\trefs/heads/main\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.lsRemote('main');
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('abc123\trefs/heads/main\n');
    const ctx = new GitContext(validOptions({ token: 'ls-remote-token' }), { exec });
    ctx.lsRemote('main', worktreePath);
    expect(calls[0].env.GH_TOKEN).toBe('ls-remote-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('abc123\n');
    const ctx = new GitContext(
      validOptions({ gitIdentity: { authorName: 'LS Bot', authorEmail: 'ls@bot.dev', committerName: 'LS Bot', committerEmail: 'ls@bot.dev' } }),
      { exec },
    );
    ctx.lsRemote('main', worktreePath);
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('LS Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('ls@bot.dev');
  });

  it('returns trimmed stdout', () => {
    const { exec } = makeSpyExec('abc123\trefs/heads/main\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.lsRemote('main', worktreePath)).toBe('abc123\trefs/heads/main');
  });

  it('returns empty string when branch is absent', () => {
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.lsRemote('no-such-branch', worktreePath)).toBe('');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('abc123\n');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.lsRemote('main', worktreePath);
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('propagates exec errors (network/auth failures)', () => {
    const exec: ExecFn = () => { throw new Error('ssh: connect failed'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(() => ctx.lsRemote('main', worktreePath)).toThrow('ssh: connect failed');
  });
});

// ── addDetachedWorktree() ────────────────────────────────────────────────────

describe('addDetachedWorktree() command and env', () => {
  const baseCwd = '/srv/adw/repos/acme/webapp';
  const tmpdir = '/tmp/adw-claim-abc123';

  it('builds git worktree add --detach "<path>" "<ref>"', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.addDetachedWorktree(tmpdir, 'origin/main', baseCwd);
    expect(calls[0].command).toBe(`git worktree add --detach "${tmpdir}" "origin/main"`);
  });

  it('passes the supplied cwd', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.addDetachedWorktree(tmpdir, 'origin/main', baseCwd);
    expect(calls[0].cwd).toBe(baseCwd);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'add-wt-token' }), { exec });
    ctx.addDetachedWorktree(tmpdir, 'origin/main', baseCwd);
    expect(calls[0].env.GH_TOKEN).toBe('add-wt-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(
      validOptions({ gitIdentity: { authorName: 'Claim Bot', authorEmail: 'claim@bot.dev', committerName: 'Claim Bot', committerEmail: 'claim@bot.dev' } }),
      { exec },
    );
    ctx.addDetachedWorktree(tmpdir, 'origin/main', baseCwd);
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Claim Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('claim@bot.dev');
    expect(calls[0].env.GIT_COMMITTER_NAME).toBe('Claim Bot');
    expect(calls[0].env.GIT_COMMITTER_EMAIL).toBe('claim@bot.dev');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.addDetachedWorktree(tmpdir, 'origin/main', baseCwd);
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── commitAllowEmpty() ────────────────────────────────────────────────────────

describe('commitAllowEmpty() command and env', () => {
  const tmpdir = '/tmp/adw-claim-abc123';

  it('builds git commit --allow-empty -m "<message>"', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.commitAllowEmpty('ADW upgrade in progress: abc123 [nonce1]', tmpdir);
    expect(calls[0].command).toBe('git commit --allow-empty -m "ADW upgrade in progress: abc123 [nonce1]"');
  });

  it('passes the supplied cwd', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.commitAllowEmpty('msg', tmpdir);
    expect(calls[0].cwd).toBe(tmpdir);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'commit-token' }), { exec });
    ctx.commitAllowEmpty('msg', tmpdir);
    expect(calls[0].env.GH_TOKEN).toBe('commit-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(
      validOptions({ gitIdentity: { authorName: 'Claim Bot', authorEmail: 'claim@bot.dev', committerName: 'Claim Bot', committerEmail: 'claim@bot.dev' } }),
      { exec },
    );
    ctx.commitAllowEmpty('msg', tmpdir);
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Claim Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('claim@bot.dev');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.commitAllowEmpty('msg', tmpdir);
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── pushHeadToBranch() ────────────────────────────────────────────────────────

describe('pushHeadToBranch() command and env', () => {
  const tmpdir = '/tmp/adw-claim-abc123';

  it('builds git push origin "HEAD:refs/heads/<branch>"', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.pushHeadToBranch('adw-upgrade-deadbeef', tmpdir);
    expect(calls[0].command).toBe('git push origin "HEAD:refs/heads/adw-upgrade-deadbeef"');
  });

  it('does NOT contain --force (lock-correctness guard)', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.pushHeadToBranch('adw-upgrade-deadbeef', tmpdir);
    expect(calls[0].command).not.toContain('--force');
  });

  it('passes the supplied cwd', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.pushHeadToBranch('adw-upgrade-deadbeef', tmpdir);
    expect(calls[0].cwd).toBe(tmpdir);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'push-token' }), { exec });
    ctx.pushHeadToBranch('adw-upgrade-deadbeef', tmpdir);
    expect(calls[0].env.GH_TOKEN).toBe('push-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(
      validOptions({ gitIdentity: { authorName: 'Push Bot', authorEmail: 'push@bot.dev', committerName: 'Push Bot', committerEmail: 'push@bot.dev' } }),
      { exec },
    );
    ctx.pushHeadToBranch('adw-upgrade-deadbeef', tmpdir);
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Push Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('push@bot.dev');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.pushHeadToBranch('adw-upgrade-deadbeef', tmpdir);
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── removeDetachedWorktree() ──────────────────────────────────────────────────

describe('removeDetachedWorktree() command and env', () => {
  const baseCwd = '/srv/adw/repos/acme/webapp';
  const tmpdir = '/tmp/adw-claim-abc123';

  it('builds git worktree remove --force "<path>"', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.removeDetachedWorktree(tmpdir, baseCwd);
    expect(calls[0].command).toBe(`git worktree remove --force "${tmpdir}"`);
  });

  it('passes the supplied cwd', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.removeDetachedWorktree(tmpdir, baseCwd);
    expect(calls[0].cwd).toBe(baseCwd);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'remove-wt-token' }), { exec });
    ctx.removeDetachedWorktree(tmpdir, baseCwd);
    expect(calls[0].env.GH_TOKEN).toBe('remove-wt-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(
      validOptions({ gitIdentity: { authorName: 'Remove Bot', authorEmail: 'rm@bot.dev', committerName: 'Remove Bot', committerEmail: 'rm@bot.dev' } }),
      { exec },
    );
    ctx.removeDetachedWorktree(tmpdir, baseCwd);
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Remove Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('rm@bot.dev');
  });

  it('swallows exec errors (missing worktree is benign)', () => {
    const exec: ExecFn = () => { throw new Error('worktree not found'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(() => ctx.removeDetachedWorktree(tmpdir, baseCwd)).not.toThrow();
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.removeDetachedWorktree(tmpdir, baseCwd);
    expect(process.env.GH_TOKEN).toBe(before);
  });
});
