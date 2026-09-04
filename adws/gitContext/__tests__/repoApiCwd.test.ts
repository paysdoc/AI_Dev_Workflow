import * as os from 'os';
import { describe, it, expect } from 'vitest';
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

// ── Workspace ops unmoved (counter-assertion) ────────────────────────────────
// The repo-API cwd class this file used to cover moved to the GitHub forge
// adapter's `createGhRepoApi` (see `adws/providers/github/__tests__/ghRepoApiCwd.test.ts`)
// along with the semantic methods that carried it. What remains here is the
// workspace-scoped class's own contract: git/worktree ops stay pinned to
// basePath (or an explicit worktree path), never the framework root.

describe('workspace-scoped git/worktree ops remain pinned to basePath', () => {
  it('getCurrentBranch() spawns at ctx.basePath', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.getCurrentBranch();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('listWorktrees() spawns at ctx.basePath', () => {
    const { exec, calls } = makeSpyExec('worktree /srv/adw/repos/acme/webapp\nHEAD abc\nbranch refs/heads/main\n\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.listWorktrees();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('headShort() spawns at ctx.basePath when no cwd is given', () => {
    const { exec, calls } = makeSpyExec('abc1234\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.headShort();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('remoteUrl() spawns at ctx.basePath when no cwd is given', () => {
    const { exec, calls } = makeSpyExec('git@github.com:acme/webapp.git\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.remoteUrl();
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('an op given an explicit worktree path still spawns there, not at the framework root', () => {
    const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-775-x';
    const { exec, calls } = makeSpyExec('feature-issue-775-x\n');
    const ctx = new GitContext(validOptions(), { exec });
    ctx.getCurrentBranch(worktreePath);
    expect(calls[0].cwd).toBe(worktreePath);
    expect(calls[0].cwd).not.toBe(FRAMEWORK_ROOT);
  });

  it('a workspace method call produces exactly one recorded call, at the base path', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.getCurrentBranch();
    expect(calls.length).toBe(1);
    expect(calls[0].cwd).toBe(ctx.basePath);
  });
});

// ── exec() with the frameworkRoot class preserves the #775 contract ─────────
// No GitContext method reaches this class any more — only a forge adapter's
// own classifier (e.g. `ghCommandRunner.ts`) calls `exec()` with
// `{ cwd: { kind: 'frameworkRoot' } }` directly. The command string below is
// an arbitrary placeholder: this suite proves the cwd/env plumbing, not any
// gh-specific behaviour.

describe("exec()'s frameworkRoot working-directory class is the #775 contract", () => {
  it('records the injected framework root for a target context', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions(), { exec });
    ctx.exec('some-repo-api-command', { cwd: { kind: 'frameworkRoot' }, env: ctx.commandEnv() });
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
    expect(calls[0].cwd).not.toBe(ctx.basePath);
  });

  it('records the injected framework root for a self-host context', () => {
    const { exec, calls } = makeSpyExec();
    const ctx = new GitContext(validOptions({ selfHost: true }), { exec });
    ctx.exec('some-repo-api-command', { cwd: { kind: 'frameworkRoot' }, env: ctx.commandEnv() });
    expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
    expect(calls[0].cwd).toBe(ctx.basePath);
  });

  it('records the injected frameworkRepoRoot even after process.chdir()', () => {
    const originalCwd = process.cwd();
    try {
      const { exec, calls } = makeSpyExec();
      const ctx = new GitContext(validOptions(), { exec });
      process.chdir(os.tmpdir());
      ctx.exec('some-repo-api-command', { cwd: { kind: 'frameworkRoot' }, env: ctx.commandEnv() });
      expect(calls[0].cwd).toBe(FRAMEWORK_ROOT);
      expect(calls[0].cwd).not.toBe(process.cwd());
    } finally {
      process.chdir(originalCwd);
    }
  });
});
