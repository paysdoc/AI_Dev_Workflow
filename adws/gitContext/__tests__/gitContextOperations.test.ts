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
}

function makeSpyExec(stdout = 'main\n'): { exec: ExecFn; calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  const exec: ExecFn = (command, options) => {
    calls.push({ command, cwd: options.cwd, env: options.env });
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
