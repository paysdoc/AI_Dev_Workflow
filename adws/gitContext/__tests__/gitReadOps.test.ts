import { describe, it, expect } from 'vitest';
import { GitContext } from '../gitContext';
import type { GitContextOptions, ExecFn } from '../types';
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

// ── lsFiles() ────────────────────────────────────────────────────────────────

describe('lsFiles() command and env', () => {
  const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-foo';

  it('builds git ls-files with prefix when prefix is provided', () => {
    const { exec, calls } = makeSpyExec('.claude/commands/install.md\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.lsFiles(worktreePath, '.claude/commands/');
    expect(calls[0].command).toBe('git ls-files ".claude/commands/"');
  });

  it('builds git ls-files without prefix when prefix is omitted', () => {
    const { exec, calls } = makeSpyExec('README.md\npackage.json\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.lsFiles(worktreePath);
    expect(calls[0].command).toBe('git ls-files');
  });

  it('passes the supplied cwd', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.lsFiles(worktreePath);
    expect(calls[0].cwd).toBe(worktreePath);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('ls-token') }), { exec });
    ctx.lsFiles(worktreePath);
    expect(calls[0].env.GH_TOKEN).toBe('ls-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'LS Bot', authorEmail: 'ls@bot.dev',
          committerName: 'LS Bot', committerEmail: 'ls@bot.dev',
        },
      }),
      { exec },
    );
    ctx.lsFiles(worktreePath);
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('LS Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('ls@bot.dev');
    expect(calls[0].env.GIT_COMMITTER_NAME).toBe('LS Bot');
    expect(calls[0].env.GIT_COMMITTER_EMAIL).toBe('ls@bot.dev');
  });

  it('splits output on newlines and filters blank lines', () => {
    const { exec } = makeSpyExec('a.ts\nb.ts\n\nc.ts\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.lsFiles(worktreePath)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('returns empty array when output is empty', () => {
    const { exec } = makeSpyExec('\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.lsFiles(worktreePath)).toEqual([]);
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('injected') }), { exec });
    ctx.lsFiles(worktreePath);
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('propagates exec errors', () => {
    const exec: ExecFn = () => { throw new Error('git ls-files failed'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(() => ctx.lsFiles(worktreePath)).toThrow('git ls-files failed');
  });
});

// ── headShort() ──────────────────────────────────────────────────────────────

describe('headShort() command and env', () => {
  it('builds exactly git rev-parse --short HEAD', () => {
    const { exec, calls } = makeSpyExec('abc1234\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.headShort('/some/cwd');
    expect(calls[0].command).toBe('git rev-parse --short HEAD');
  });

  it('defaults cwd to the context base path when no arg given', () => {
    const { exec, calls } = makeSpyExec('abc1234\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.headShort();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('uses the supplied cwd when one is provided', () => {
    const { exec, calls } = makeSpyExec('abc1234\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.headShort('/srv/framework');
    expect(calls[0].cwd).toBe('/srv/framework');
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('abc1234\n');
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('hs-token') }), { exec });
    ctx.headShort();
    expect(calls[0].env.GH_TOKEN).toBe('hs-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('abc1234\n');
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'HS Bot', authorEmail: 'hs@bot.dev',
          committerName: 'HS Bot', committerEmail: 'hs@bot.dev',
        },
      }),
      { exec },
    );
    ctx.headShort();
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('HS Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('hs@bot.dev');
  });

  it('returns the trimmed hash', () => {
    const { exec } = makeSpyExec('abc1234\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.headShort()).toBe('abc1234');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('abc1234\n');
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('injected') }), { exec });
    ctx.headShort();
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('propagates exec errors', () => {
    const exec: ExecFn = () => { throw new Error('not a git repo'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(() => ctx.headShort()).toThrow('not a git repo');
  });
});

// ── diff() ───────────────────────────────────────────────────────────────────

describe('diff() command and env', () => {
  const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-foo';

  it('builds git diff with the supplied range', () => {
    const { exec, calls } = makeSpyExec('diff output\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.diff('main...HEAD', worktreePath);
    expect(calls[0].command).toBe('git diff main...HEAD');
  });

  it('passes the supplied cwd', () => {
    const { exec, calls } = makeSpyExec('diff output\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.diff('main...HEAD', worktreePath);
    expect(calls[0].cwd).toBe(worktreePath);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('diff output\n');
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('diff-token') }), { exec });
    ctx.diff('main...HEAD', worktreePath);
    expect(calls[0].env.GH_TOKEN).toBe('diff-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('diff output\n');
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'Diff Bot', authorEmail: 'diff@bot.dev',
          committerName: 'Diff Bot', committerEmail: 'diff@bot.dev',
        },
      }),
      { exec },
    );
    ctx.diff('main...HEAD', worktreePath);
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Diff Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('diff@bot.dev');
  });

  it('returns trimmed stdout', () => {
    const { exec } = makeSpyExec('--- a/foo\n+++ b/foo\n@@ -1 +1 @@\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.diff('main...HEAD', worktreePath)).toBe('--- a/foo\n+++ b/foo\n@@ -1 +1 @@');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('injected') }), { exec });
    ctx.diff('main...HEAD', worktreePath);
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('propagates exec errors', () => {
    const exec: ExecFn = () => { throw new Error('git diff failed'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(() => ctx.diff('main...HEAD', worktreePath)).toThrow('git diff failed');
  });
});

// ── log() ────────────────────────────────────────────────────────────────────

describe('log() command and env', () => {
  it('builds the exact git log command with branch, format, and --no-merges', () => {
    const { exec, calls } = makeSpyExec('2024-01-01T00:00:00Z build-agent: feat: #1\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.log('feature-issue-1-demo');
    expect(calls[0].command).toBe('git log "feature-issue-1-demo" --format="%aI %s" --no-merges');
  });

  it('defaults cwd to the context base path when no cwd is given', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.log('feature-issue-1-demo');
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('uses the supplied cwd when one is provided', () => {
    const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-1-foo';
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.log('feature-issue-1-demo', worktreePath);
    expect(calls[0].cwd).toBe(worktreePath);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('log-token') }), { exec });
    ctx.log('feature-issue-1-demo');
    expect(calls[0].env.GH_TOKEN).toBe('log-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'Log Bot', authorEmail: 'log@bot.dev',
          committerName: 'Log Bot', committerEmail: 'log@bot.dev',
        },
      }),
      { exec },
    );
    ctx.log('feature-issue-1-demo');
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Log Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('log@bot.dev');
  });

  it('returns trimmed stdout', () => {
    const out = '2024-01-01T00:00:00Z build-agent: feat: #1\n';
    const { exec } = makeSpyExec(out);
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.log('feature-issue-1-demo')).toBe(out.trim());
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('injected') }), { exec });
    ctx.log('feature-issue-1-demo');
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('propagates exec errors', () => {
    const exec: ExecFn = () => { throw new Error('git log failed'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(() => ctx.log('feature-issue-1-demo')).toThrow('git log failed');
  });
});

// ── show() ───────────────────────────────────────────────────────────────────

describe('show() command and env', () => {
  it('builds exactly git show "origin/main:.adw-version"', () => {
    const { exec, calls } = makeSpyExec('abc123\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.show('origin/main', '.adw-version', '/some/cwd');
    expect(calls[0].command).toBe('git show "origin/main:.adw-version"');
  });

  it('passes the supplied cwd', () => {
    const { exec, calls } = makeSpyExec('abc123\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.show('origin/main', '.adw-version', '/some/cwd');
    expect(calls[0].cwd).toBe('/some/cwd');
  });

  it('defaults cwd to the context base path when cwd is omitted', () => {
    const { exec, calls } = makeSpyExec('abc123\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.show('origin/main', '.adw-version');
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('abc123\n');
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('show-token') }), { exec });
    ctx.show('origin/main', '.adw-version', '/some/cwd');
    expect(calls[0].env.GH_TOKEN).toBe('show-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('abc123\n');
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'Show Bot', authorEmail: 'show@bot.dev',
          committerName: 'Show Bot', committerEmail: 'show@bot.dev',
        },
      }),
      { exec },
    );
    ctx.show('origin/main', '.adw-version', '/some/cwd');
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Show Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('show@bot.dev');
    expect(calls[0].env.GIT_COMMITTER_NAME).toBe('Show Bot');
    expect(calls[0].env.GIT_COMMITTER_EMAIL).toBe('show@bot.dev');
  });

  it('returns trimmed stdout', () => {
    const { exec } = makeSpyExec('abc123\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.show('origin/main', '.adw-version', '/some/cwd')).toBe('abc123');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('abc123\n');
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('injected') }), { exec });
    ctx.show('origin/main', '.adw-version', '/some/cwd');
    expect(process.env.GH_TOKEN).toBe(before);
  });

  it('propagates exec errors', () => {
    const exec: ExecFn = () => { throw new Error('git show failed'); };
    const ctx = new GitContext(validOptions(), { exec });
    expect(() => ctx.show('origin/main', '.adw-version', '/some/cwd')).toThrow('git show failed');
  });
});

// ── logSince() ────────────────────────────────────────────────────────────────

describe('logSince() command and env', () => {
  it('assembles numerator command: since + grep + no-merges + oneline', () => {
    const { exec, calls } = makeSpyExec('commit-output\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.logSince({ since: '2024-01-01', grep: '^regression-promotion:', oneline: true });
    expect(calls[0].command).toBe('git log --since="2024-01-01" --grep="^regression-promotion:" --no-merges --oneline');
  });

  it('assembles denominator command: since + no-merges + patch + pathspec', () => {
    const { exec, calls } = makeSpyExec('diff-output\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.logSince({ since: '2024-01-01', patch: true, pathspec: 'features/per-issue/feature-*.feature' });
    expect(calls[0].command).toBe('git log --since="2024-01-01" --no-merges -p -- features/per-issue/feature-*.feature');
  });

  it('assembles bare command: since + no-merges only', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.logSince({ since: '2024-01-01' });
    expect(calls[0].command).toBe('git log --since="2024-01-01" --no-merges');
  });

  it('defaults cwd to the context base path when no cwd is given', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.logSince({ since: '2024-01-01' });
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('honors an explicit cwd', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.logSince({ since: '2024-01-01' }, '/some/wt');
    expect(calls[0].cwd).toBe('/some/wt');
  });

  it('returns the runner output verbatim (trimmed)', () => {
    const { exec } = makeSpyExec('abc123 some commit\n');
    const ctx = new GitContext(validOptions(), { exec });
    expect(ctx.logSince({ since: '2024-01-01' })).toBe('abc123 some commit');
  });

  it('injects GH_TOKEN from the context token in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('log-since-token') }), { exec });
    ctx.logSince({ since: '2024-01-01' });
    expect(calls[0].env.GH_TOKEN).toBe('log-since-token');
  });

  it('injects all four GIT_* identity vars in the child env', () => {
    const { exec, calls } = makeSpyExec('');
    const ctx = new GitContext(
      validOptions({
        gitIdentity: {
          authorName: 'Stats Bot', authorEmail: 'stats@bot.dev',
          committerName: 'Stats Bot', committerEmail: 'stats@bot.dev',
        },
      }),
      { exec },
    );
    ctx.logSince({ since: '2024-01-01' });
    expect(calls[0].env.GIT_AUTHOR_NAME).toBe('Stats Bot');
    expect(calls[0].env.GIT_AUTHOR_EMAIL).toBe('stats@bot.dev');
  });

  it('does not mutate process.env', () => {
    const before = process.env.GH_TOKEN;
    const { exec } = makeSpyExec('');
    const ctx = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('injected') }), { exec });
    ctx.logSince({ since: '2024-01-01' });
    expect(process.env.GH_TOKEN).toBe(before);
  });
});

// ── Two-context isolation (git-read methods) ──────────────────────────────────

describe('git-read methods two-context isolation', () => {
  it('two contexts each spawn lsFiles with their own token', () => {
    const { exec: shared, calls } = makeSpyExec('');
    const ctxA = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('token-a') }), { exec: shared });
    const ctxB = new GitContext(validOptions({ tokenProvider: createLiteralTokenProvider('token-b') }), { exec: shared });
    ctxA.lsFiles('/wt-a');
    ctxB.lsFiles('/wt-b');
    expect(calls[0].env.GH_TOKEN).toBe('token-a');
    expect(calls[1].env.GH_TOKEN).toBe('token-b');
  });
});
