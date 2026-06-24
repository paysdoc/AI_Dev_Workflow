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

// ── Env injection ────────────────────────────────────────────────────────────

describe('defaultBranch() env injection', () => {
  it('passes cwd equal to the context base path', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(
      validOptions({ owner: 'acme', repo: 'webapp', token: 'my-token' }),
      { exec },
    );
    ctx.defaultBranch();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('passes GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ token: 'secret-token' }), { exec });
    ctx.defaultBranch();
    expect(calls[0].env.GH_TOKEN).toBe('secret-token');
  });

  it('passes all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'Author Name',
          authorEmail: 'author@test.com',
          committerName: 'Committer Name',
          committerEmail: 'committer@test.com',
        },
      }),
      { exec },
    );
    ctx.defaultBranch();
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Author Name');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('author@test.com');
    expect(calls[0].env.GIT_COMMITTER_NAME).toBe('Committer Name');
    expect(calls[0].env.GIT_COMMITTER_EMAIL).toBe('committer@test.com');
  });

  it('spawns the expected gh repo view command with explicit owner/repo', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ owner: 'myorg', repo: 'myrepo' }), { exec });
    ctx.defaultBranch();
    expect(calls[0].command).toBe(
      'gh repo view myorg/myrepo --json defaultBranchRef --jq .defaultBranchRef.name',
    );
  });

  it('inherits unrelated env keys (PATH survives in the child env)', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.defaultBranch();
    expect(calls[0].env['PATH']).toBe(process.env['PATH']);
  });
});

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
});

// ── listOpenIssues() ─────────────────────────────────────────────────────────

describe('listOpenIssues() command and env', () => {
  it('builds the exact command with required fields and limit', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    ctx.listOpenIssues({ fields: ['number', 'comments'], limit: 100 });
    expect(calls[0].command).toBe(
      'gh issue list --repo acme/webapp --state open --json number,comments --limit 100',
    );
  });

  it('appends --search when provided', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    ctx.listOpenIssues({ fields: ['number', 'title'], search: 'docs-bloat: app_docs/foo.md', limit: 5 });
    expect(calls[0].command).toBe(
      'gh issue list --repo acme/webapp --state open --json number,title --search "docs-bloat: app_docs/foo.md" --limit 5',
    );
  });

  it('omits --search and --limit when not provided', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    ctx.listOpenIssues({ fields: ['number'] });
    expect(calls[0].command).toBe('gh issue list --repo acme/webapp --state open --json number');
  });

  it('passes cwd equal to the context base path', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.listOpenIssues({ fields: ['number'] });
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ token: 'list-token' }), { exec });
    ctx.listOpenIssues({ fields: ['number'] });
    expect(calls[0].env.GH_TOKEN).toBe('list-token');
  });

  it('injects all four GIT_* identity vars', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'List Bot', authorEmail: 'list@bot.dev',
          committerName: 'List Bot', committerEmail: 'list@bot.dev',
        },
      }),
      { exec },
    );
    ctx.listOpenIssues({ fields: ['number'] });
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('List Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('list@bot.dev');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.listOpenIssues({ fields: ['number'] });
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('returns trimmed stdout', () => {
    const { exec } = makeSpyExec('[{"number":1}]\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.listOpenIssues({ fields: ['number'] })).toBe('[{"number":1}]');
  });
});

// ── issueComments() ──────────────────────────────────────────────────────────

describe('issueComments() command and env', () => {
  it("builds the exact command with --jq '.comments'", () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    ctx.issueComments(42);
    expect(calls[0].command).toBe(
      "gh issue view 42 --repo acme/webapp --json comments --jq '.comments'",
    );
  });

  it('passes cwd equal to the context base path', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.issueComments(1);
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('injects GH_TOKEN from the context token', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ token: 'comments-token' }), { exec });
    ctx.issueComments(1);
    expect(calls[0].env.GH_TOKEN).toBe('comments-token');
  });

  it('injects GIT_* vars in the child env', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'Comments Bot', authorEmail: 'c@bot.dev',
          committerName: 'Comments Bot', committerEmail: 'c@bot.dev',
        },
      }),
      { exec },
    );
    ctx.issueComments(1);
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Comments Bot');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.issueComments(1);
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('returns trimmed stdout', () => {
    const { exec } = makeSpyExec('[{"body":"hello"}]\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.issueComments(1)).toBe('[{"body":"hello"}]');
  });
});

// ── fetchMergedPRs() ─────────────────────────────────────────────────────────

describe('fetchMergedPRs() command and env', () => {
  it('defaults to --limit 200', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    ctx.fetchMergedPRs();
    expect(calls[0].command).toBe(
      'gh pr list --repo acme/webapp --state merged --json body,mergedAt --limit 200',
    );
  });

  it('honors an explicit limit', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    ctx.fetchMergedPRs(50);
    expect(calls[0].command).toBe(
      'gh pr list --repo acme/webapp --state merged --json body,mergedAt --limit 50',
    );
  });

  it('passes cwd equal to the context base path', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.fetchMergedPRs();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('injects GH_TOKEN from the context token', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ token: 'prs-token' }), { exec });
    ctx.fetchMergedPRs();
    expect(calls[0].env.GH_TOKEN).toBe('prs-token');
  });

  it('injects GIT_* vars in the child env', () => {
    const { exec, calls } = makeSpyExec('[]');
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'PR Bot', authorEmail: 'pr@bot.dev',
          committerName: 'PR Bot', committerEmail: 'pr@bot.dev',
        },
      }),
      { exec },
    );
    ctx.fetchMergedPRs();
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('PR Bot');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('[]');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.fetchMergedPRs();
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('returns trimmed stdout', () => {
    const { exec } = makeSpyExec('[{"body":"Closes #1","mergedAt":"2024-01-01"}]\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.fetchMergedPRs()).toBe('[{"body":"Closes #1","mergedAt":"2024-01-01"}]');
  });
});

// ── Return value ─────────────────────────────────────────────────────────────

describe('defaultBranch() return value', () => {
  it('returns the trimmed stdout', () => {
    const { exec } = makeSpyExec('main\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.defaultBranch()).toBe('main');
  });

  it('trims leading and trailing whitespace', () => {
    const { exec } = makeSpyExec('  dev  \n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.defaultBranch()).toBe('dev');
  });
});

// ── Parent-env non-mutation ──────────────────────────────────────────────────

describe('defaultBranch() does not mutate process.env', () => {
  const savedVars: Record<string, string | undefined> = {};
  const watchKeys = [
    'GH_TOKEN',
    'GIT_AUTHOR_NAME',
    'GIT_AUTHOR_EMAIL',
    'GIT_COMMITTER_NAME',
    'GIT_COMMITTER_EMAIL',
  ];

  afterEach(() => {
    for (const key of watchKeys) {
      if (savedVars[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedVars[key];
      }
    }
  });

  it('leaves GH_TOKEN and all four GIT_* vars byte-identical after an operation', () => {
    for (const key of watchKeys) {
      savedVars[key] = process.env[key];
    }
    const before: Record<string, string | undefined> = {};
    for (const key of watchKeys) {
      before[key] = process.env[key];
    }

    const { exec } = makeSpyExec();
    const ctx = new GitContext(validOptions({ token: 'injected-token' }), { exec });
    ctx.defaultBranch();

    for (const key of watchKeys) {
      expect(process.env[key]).toBe(before[key]);
    }
  });
});

// ── Two-context isolation ────────────────────────────────────────────────────

describe('two-context isolation', () => {
  it('two contexts in one process each spawn with their own token and cwd', () => {
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

    ctxA.defaultBranch();
    ctxB.defaultBranch();

    expect(callsA[0].cwd).toBe(ctxA.basePath);
    expect(callsA[0].env.GH_TOKEN).toBe('token-alpha');
    expect(callsB[0].cwd).toBe(ctxB.basePath);
    expect(callsB[0].env.GH_TOKEN).toBe('token-beta');
    expect(callsA[0].cwd).not.toBe(callsB[0].cwd);
  });

  it('neither context carries the other context token (shared spy)', () => {
    const { exec: shared, calls } = makeSpyExec();

    const ctxA = new GitContext(
      validOptions({ owner: 'acme', repo: 'alpha', token: 'token-alpha' }),
      { exec: shared },
    );
    const ctxB = new GitContext(
      validOptions({ owner: 'octo', repo: 'beta', token: 'token-beta' }),
      { exec: shared },
    );

    ctxA.defaultBranch();
    ctxB.defaultBranch();

    const [callA, callB] = calls;
    expect(callA.env.GH_TOKEN).toBe('token-alpha');
    expect(callB.env.GH_TOKEN).toBe('token-beta');
    expect(Object.values(callA.env)).not.toContain('token-beta');
    expect(Object.values(callB.env)).not.toContain('token-alpha');
  });
});

// ── Ambient-bleed resistance ─────────────────────────────────────────────────

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
    ctx.defaultBranch();
    expect(calls[0].env.GH_TOKEN).toBe('context-token');
  });

  it('parent process.env.GH_TOKEN remains the stale value after the op', () => {
    process.env['GH_TOKEN'] = 'stale-global-token';
    const { exec } = makeSpyExec();
    const ctx = new GitContext(validOptions({ token: 'context-token' }), { exec });
    ctx.defaultBranch();
    expect(process.env['GH_TOKEN']).toBe('stale-global-token');
  });
});

// ── Error propagation ────────────────────────────────────────────────────────

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
    const exec: ExecFn = () => { throw new Error('gh: unauthenticated'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(() => ctx.defaultBranch()).toThrow('gh: unauthenticated');
  });

  it('does not mutate process.env when exec throws', () => {
    process.env['GH_TOKEN'] = 'before-throw';
    const exec: ExecFn = () => { throw new Error('spawn failed'); };
    const ctx = new GitContext(validOptions({ token: 'ctx-token' }), { exec });
    try { ctx.defaultBranch(); } catch { /* expected */ }
    expect(process.env['GH_TOKEN']).toBe('before-throw');
  });
});

// ── cwd is explicit, not inherited from process.cwd() ───────────────────────

describe('explicit cwd (not process.cwd())', () => {
  const originalCwd = process.cwd();
  afterEach(() => process.chdir(originalCwd));

  it('spawned command uses base path even after process.chdir()', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    const expectedBasePath = ctx.basePath;
    process.chdir('/tmp');
    ctx.defaultBranch();
    expect(calls[0].cwd).toBe(expectedBasePath);
    expect(calls[0].cwd).not.toBe('/tmp');
  });
});

// ── createPR() head-branch contract ──────────────────────────────────────────
// Regression guard: gh pr create must carry an explicit --head. Without it, gh
// infers the head from the cwd's current branch (the context base path, on the
// default branch), producing an empty-diff PR against the wrong head. The
// GitContext gh-ops migration dropped --head and shipped exactly that bug
// (PR opened with head=main → "0 files changed").
describe('createPR() head-branch contract', () => {
  it('includes an explicit --head set to the source branch', () => {
    const { exec, calls } = makeSpyExec('https://github.com/acme/webapp/pull/12\n');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    ctx.createPR('My title', 'body text', 'feature-issue-7-do-thing', 'dev');
    expect(calls[0].command).toContain('--head "feature-issue-7-do-thing"');
  });

  it('does not rely on the cwd-inferred head (head differs from base path branch)', () => {
    // Spy returns 'main' for any command; the head must still be the passed branch.
    const { exec, calls } = makeSpyExec('main\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.createPR('T', 'b', 'feature-issue-99-x', 'dev');
    expect(calls[0].command).toContain('--head "feature-issue-99-x"');
    expect(calls[0].command).toContain('--base dev');
  });

  it('passes the PR body via --body-file - on stdin', () => {
    const { exec, calls } = makeSpyExec('https://github.com/acme/webapp/pull/1\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.createPR('T', 'the body', 'feature-issue-1-y');
    expect(calls[0].command).toContain('--body-file -');
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

// ── setSecret() ──────────────────────────────────────────────────────────────

describe('setSecret() command and env', () => {
  it('builds exactly gh secret set <NAME> --repo <owner>/<repo> --body -', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ owner: 'acme', repo: 'webapp' }), { exec });
    ctx.setSecret('MY_SECRET', 'the-value');
    expect(calls[0].command).toBe('gh secret set MY_SECRET --repo acme/webapp --body -');
  });

  it('uses the context primary token (not the PAT) even when a PAT is configured', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'primary-token', pat: 'pat-token' }), { exec });
    ctx.setSecret('MY_SECRET', 'the-value');
    expect(calls[0].env.GH_TOKEN).toBe('primary-token');
  });

  it('pipes the secret value via stdin input (not in the command string)', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.setSecret('MY_SECRET', 'super-secret-value');
    expect(calls[0].input).toBe('super-secret-value');
    expect(calls[0].command).not.toContain('super-secret-value');
  });

  it('passes cwd equal to the context base path', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.setSecret('MY_SECRET', 'val');
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('does not mutate process.env.GH_TOKEN after the call', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ token: 'injected' }), { exec });
    ctx.setSecret('MY_SECRET', 'val');
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── runGraphQLInput() ────────────────────────────────────────────────────────

describe('runGraphQLInput() command and env', () => {
  it('builds exactly gh api graphql --input -', () => {
    const { exec, calls } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.runGraphQLInput({ query: 'mutation{}', variables: { ids: ['a', 'b'] } });
    expect(calls[0].command).toBe('gh api graphql --input -');
  });

  it('pipes JSON.stringify(body) via stdin input', () => {
    const { exec, calls } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions(), { exec });
    const body = { query: 'mutation{}', variables: { ids: ['a', 'b'] } };
    ctx.runGraphQLInput(body);
    expect(calls[0].input).toBe(JSON.stringify(body));
  });

  it('uses the PAT as GH_TOKEN when a pat is configured (usePat: true)', () => {
    const { exec, calls } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions({ token: 'primary-token', pat: 'pat-token' }), { exec });
    ctx.runGraphQLInput({ q: 'mutation{}' });
    expect(calls[0].env.GH_TOKEN).toBe('pat-token');
  });

  it('falls back to the context primary token when no PAT is configured', () => {
    const { exec, calls } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions({ token: 'primary-token' }), { exec });
    ctx.runGraphQLInput({ q: 'mutation{}' });
    expect(calls[0].env.GH_TOKEN).toBe('primary-token');
  });

  it('passes cwd equal to the context base path', () => {
    const { exec, calls } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.runGraphQLInput({ q: 'mutation{}' });
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('{}');
    const ctx = new GitContext(validOptions({ token: 'injected', pat: 'pat' }), { exec });
    ctx.runGraphQLInput({ q: 'mutation{}' });
    expect(process.env.GH_TOKEN).toBe(before);
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
