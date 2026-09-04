import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import {
  isSpawnEnoent,
  describeMissingWorkingDirectory,
  rewrapMissingWorkingDirectory,
  type WorkingDirectoryContext,
} from '../workingDirectoryGuard';
import { GitContext } from '../gitContext';
import type { GitContextOptions, ExecFn, FsDeps } from '../types';

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

function enoentError(): NodeJS.ErrnoException {
  return Object.assign(new Error('spawnSync /bin/sh ENOENT'), {
    code: 'ENOENT',
    syscall: 'spawnSync /bin/sh',
    path: '/bin/sh',
  });
}

function makeEnoentExec(): ExecFn {
  return () => { throw enoentError(); };
}

function baseCtx(overrides: Partial<WorkingDirectoryContext> = {}): WorkingDirectoryContext {
  return {
    cwd: '/srv/adw/repos/acme/webapp',
    command: 'git branch --show-current',
    owner: 'acme',
    repo: 'webapp',
    selfHost: false,
    ...overrides,
  };
}

// ── Pure-module tests: describeMissingWorkingDirectory ─────────────────────

describe('describeMissingWorkingDirectory()', () => {
  it('names the cwd, owner/repo, selfHost and the clone question for a base-path cwd', () => {
    const message = describeMissingWorkingDirectory(baseCtx({ cwd: '/srv/adw/repos/acme/webapp' }));
    expect(message).toContain('/srv/adw/repos/acme/webapp');
    expect(message).toContain('acme/webapp');
    expect(message).toContain('selfHost=false');
    expect(message).toMatch(/clon(e|ed|ing)/i);
  });

  it('names the cwd, owner/repo, selfHost and the clone question for an explicit worktree cwd', () => {
    const worktreePath = '/srv/adw/repos/acme/webapp/.worktrees/feature-issue-777-x';
    const message = describeMissingWorkingDirectory(baseCtx({ cwd: worktreePath }));
    expect(message).toContain(worktreePath);
    expect(message).toContain('acme/webapp');
    expect(message).toContain('selfHost=false');
    expect(message).toMatch(/clon(e|ed|ing)/i);
  });

  it('reports selfHost=true when the discriminator is true', () => {
    const message = describeMissingWorkingDirectory(baseCtx({ selfHost: true }));
    expect(message).toContain('selfHost=true');
  });

  it('leaves a short command verbatim', () => {
    const message = describeMissingWorkingDirectory(baseCtx({ command: 'git branch --show-current' }));
    expect(message).toContain('git branch --show-current');
    expect(message).not.toContain('…');
  });

  it('truncates a command longer than 120 characters with an ellipsis', () => {
    const longCommand = `git log ${'a'.repeat(130)}`;
    const message = describeMissingWorkingDirectory(baseCtx({ command: longCommand }));
    expect(message).toContain('…');
    expect(message).not.toContain(longCommand);
    expect(message).toContain(longCommand.slice(0, 120));
  });
});

// ── Pure-module tests: isSpawnEnoent ────────────────────────────────────────

describe('isSpawnEnoent()', () => {
  it('is true for an error shaped with code: ENOENT', () => {
    expect(isSpawnEnoent(enoentError())).toBe(true);
  });

  it('is false for a bare Error with no code (the node/bun message-divergence case)', () => {
    expect(isSpawnEnoent(new Error('spawnSync /bin/sh ENOENT'))).toBe(false);
  });

  it('is false for a non-ENOENT-coded error', () => {
    expect(isSpawnEnoent(Object.assign(new Error('boom'), { code: 'EACCES' }))).toBe(false);
  });

  it('is false for non-object values', () => {
    expect(isSpawnEnoent('not an error')).toBe(false);
    expect(isSpawnEnoent(null)).toBe(false);
    expect(isSpawnEnoent(undefined)).toBe(false);
  });
});

// ── Pure-module tests: rewrapMissingWorkingDirectory ────────────────────────

describe('rewrapMissingWorkingDirectory()', () => {
  it('returns the same object reference when the error is not a spawn ENOENT', () => {
    const original = new Error('gh: unauthenticated');
    const result = rewrapMissingWorkingDirectory(original, baseCtx(), () => false);
    expect(result).toBe(original);
  });

  it('returns the same object reference when the cwd exists', () => {
    const original = enoentError();
    const result = rewrapMissingWorkingDirectory(original, baseCtx(), () => true);
    expect(result).toBe(original);
  });

  it('rewraps when the error is ENOENT-coded and the cwd does not exist', () => {
    const original = enoentError();
    const result = rewrapMissingWorkingDirectory(original, baseCtx(), () => false) as NodeJS.ErrnoException;
    expect(result).not.toBe(original);
    expect(result.message).toContain(baseCtx().cwd);
  });

  it('preserves code: ENOENT on the rewrapped error', () => {
    const original = enoentError();
    const result = rewrapMissingWorkingDirectory(original, baseCtx(), () => false) as NodeJS.ErrnoException;
    expect(result.code).toBe('ENOENT');
  });

  it('carries the original error as cause on the rewrapped error', () => {
    const original = enoentError();
    const result = rewrapMissingWorkingDirectory(original, baseCtx(), () => false) as Error;
    expect((result as { cause?: unknown }).cause).toBe(original);
  });
});

// ── GitContext-level wiring tests ───────────────────────────────────────────

describe('GitContext #run wiring: missing working directory', () => {
  let targetReposDir: string;
  let frameworkRepoRoot: string;

  afterEach(() => {
    if (targetReposDir) fs.rmSync(targetReposDir, { recursive: true, force: true });
    if (frameworkRepoRoot) fs.rmSync(frameworkRepoRoot, { recursive: true, force: true });
  });

  function makeRoots(): void {
    targetReposDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-777-target-'));
    frameworkRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-777-framework-'));
  }

  it('getCurrentBranch() throws a message naming basePath, the repo and selfHost=false, still coded ENOENT', () => {
    makeRoots();
    const ctx = new GitContext(
      validOptions({ frameworkRepoRoot, targetReposDir, owner: 'acme', repo: 'webapp' }),
      { exec: makeEnoentExec() },
    );
    // basePath (targetReposDir/acme/webapp) is deliberately never created.
    expect(() => ctx.getCurrentBranch()).toThrowError();
    try {
      ctx.getCurrentBranch();
      expect.unreachable('expected getCurrentBranch to throw');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      expect(e.message).toContain(ctx.basePath);
      expect(e.message).toContain('acme/webapp');
      expect(e.message).toContain('selfHost=false');
      expect(e.code).toBe('ENOENT');
    }
  });

  it('an explicit absent worktree path is named instead of basePath', () => {
    makeRoots();
    const basePath = path.join(targetReposDir, 'acme', 'webapp');
    fs.mkdirSync(basePath, { recursive: true });
    const ctx = new GitContext(
      validOptions({ frameworkRepoRoot, targetReposDir, owner: 'acme', repo: 'webapp' }),
      { exec: makeEnoentExec() },
    );
    const worktreePath = ctx.worktreePathFor('feature-issue-777-x');
    try {
      ctx.getCurrentBranch(worktreePath);
      expect.unreachable('expected getCurrentBranch to throw');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      expect(e.message).toContain(worktreePath);
      expect(e.message).not.toContain(`${ctx.basePath} (`);
      expect(e.code).toBe('ENOENT');
    }
  });

  it('a context built while the workspace was absent reads it successfully once mkdirSync creates it', () => {
    makeRoots();
    const basePath = path.join(targetReposDir, 'acme', 'webapp');
    const exec: ExecFn = () => 'trunk\n';
    const ctx = new GitContext(
      validOptions({ frameworkRepoRoot, targetReposDir, owner: 'acme', repo: 'webapp' }),
      { exec },
    );
    fs.mkdirSync(basePath, { recursive: true });
    expect(() => ctx.getCurrentBranch()).not.toThrow();
    expect(ctx.getCurrentBranch()).toBe('trunk');
  });

  it('a non-ENOENT throw propagates with its message intact', () => {
    makeRoots();
    const exec: ExecFn = () => { throw new Error('gh: unauthenticated'); };
    const ctx = new GitContext(
      validOptions({ frameworkRepoRoot, targetReposDir }),
      { exec },
    );
    expect(() => ctx.getCurrentBranch()).toThrow('gh: unauthenticated');
  });

  it('an ENOENT-coded throw whose cwd does exist propagates verbatim (not a blanket wrap)', () => {
    makeRoots();
    const basePath = path.join(targetReposDir, 'acme', 'webapp');
    fs.mkdirSync(basePath, { recursive: true });
    const ctx = new GitContext(
      validOptions({ frameworkRepoRoot, targetReposDir, owner: 'acme', repo: 'webapp' }),
      { exec: makeEnoentExec() },
    );
    try {
      ctx.getCurrentBranch();
      expect.unreachable('expected getCurrentBranch to throw');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      expect(e.message).toBe('spawnSync /bin/sh ENOENT');
      expect(e.message).not.toContain(basePath);
    }
  });

  it('performs no filesystem existence probe on the happy path', () => {
    makeRoots();
    let probeCount = 0;
    const realFs: FsDeps = {
      existsSync: fs.existsSync,
      mkdirSync: fs.mkdirSync,
      copyFileSync: fs.copyFileSync,
      rmSync: fs.rmSync,
    };
    const countingFsDeps: FsDeps = {
      ...realFs,
      existsSync: (p: string) => { probeCount += 1; return realFs.existsSync(p); },
    };
    const exec: ExecFn = () => 'main\n';
    const ctx = new GitContext(
      validOptions({ frameworkRepoRoot, targetReposDir }),
      { exec, fsDeps: countingFsDeps },
    );
    ctx.exec('some-repo-api-command', { cwd: { kind: 'frameworkRoot' }, env: ctx.commandEnv() });
    expect(probeCount).toBe(0);
  });

  it('construct-before-clone: constructing for an absent workspace does not throw, and a repo-API op succeeds', () => {
    makeRoots();
    const exec: ExecFn = () => 'trunk\n';
    const ctx = new GitContext(
      validOptions({ frameworkRepoRoot, targetReposDir, owner: 'acme', repo: 'webapp' }),
      { exec },
    );
    expect(fs.existsSync(ctx.basePath)).toBe(false);
    const repoApiOp = () => ctx.exec('some-repo-api-command', { cwd: { kind: 'frameworkRoot' }, env: ctx.commandEnv() });
    expect(repoApiOp).not.toThrow();
    expect(repoApiOp()).toBe('trunk');
  });

  it('worktreeRegistration still swallows the enriched error and answers "missing"', () => {
    makeRoots();
    const ctx = new GitContext(
      validOptions({ frameworkRepoRoot, targetReposDir, owner: 'acme', repo: 'webapp' }),
      { exec: makeEnoentExec() },
    );
    expect(ctx.worktreeRegistration(ctx.worktreePathFor('feature-issue-777-x'))).toBe('missing');
  });

  it('resolveGitDir still swallows the enriched error and answers null', () => {
    makeRoots();
    const ctx = new GitContext(
      validOptions({ frameworkRepoRoot, targetReposDir, owner: 'acme', repo: 'webapp' }),
      { exec: makeEnoentExec() },
    );
    expect(ctx.resolveGitDir(ctx.worktreePathFor('feature-issue-777-x'))).toBe(null);
  });

  it('listWorktrees still swallows the enriched error and answers empty', () => {
    makeRoots();
    const ctx = new GitContext(
      validOptions({ frameworkRepoRoot, targetReposDir, owner: 'acme', repo: 'webapp' }),
      { exec: makeEnoentExec() },
    );
    expect(ctx.listWorktrees()).toEqual([]);
  });
});
