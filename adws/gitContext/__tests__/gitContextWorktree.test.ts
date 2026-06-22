/**
 * Behaviour tests for GitContext worktree methods.
 *
 * Mirrors vcs/__tests__/worktreeReset.test.ts in approach:
 * child_process and fs are mocked; tests assert command sequence and cwd
 * correctness. The headline property: a target context and a self-host context
 * resolve distinct worktree paths for the same branch.
 */

import * as path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitContext } from '../gitContext';
import type { GitContextOptions } from '../types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    copyFileSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
  };
});

import { execSync } from 'child_process';
import * as fs from 'fs';

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(fs.existsSync);

// ── Constants ─────────────────────────────────────────────────────────────────

const FRAMEWORK_ROOT = '/srv/adw/framework';
const TARGET_REPOS_DIR = '/srv/adw/repos';
const OWNER = 'acme';
const REPO = 'webapp';

function makeCtx(overrides: Partial<GitContextOptions> = {}): GitContext {
  return new GitContext({
    owner: OWNER,
    repo: REPO,
    selfHost: false,
    token: 'test-token',
    gitIdentity: {
      authorName: 'Bot',
      authorEmail: 'bot@test.dev',
      committerName: 'Bot',
      committerEmail: 'bot@test.dev',
    },
    frameworkRepoRoot: FRAMEWORK_ROOT,
    targetReposDir: TARGET_REPOS_DIR,
    ...overrides,
  });
}

const TARGET_BASE = path.join(TARGET_REPOS_DIR, OWNER, REPO);
const SELF_BASE = FRAMEWORK_ROOT;

function targetWtPath(branch: string): string {
  return path.join(TARGET_BASE, '.worktrees', branch);
}

function selfWtPath(branch: string): string {
  return path.join(SELF_BASE, '.worktrees', branch);
}

// ── Base correctness: headline anti-regression ─────────────────────────────

describe('base-path correctness', () => {
  it('target context and self-host context resolve distinct worktree paths for the same branch', () => {
    const targetCtx = makeCtx({ selfHost: false });
    const selfCtx = makeCtx({ selfHost: true });

    const branch = 'feature-issue-661-test';
    expect(targetCtx.worktreePathFor(branch)).not.toBe(selfCtx.worktreePathFor(branch));
    expect(targetCtx.worktreePathFor(branch)).toBe(targetWtPath(branch));
    expect(selfCtx.worktreePathFor(branch)).toBe(selfWtPath(branch));
  });
});

// ── resetWorktree ─────────────────────────────────────────────────────────────

describe('resetWorktree', () => {
  const branch = 'main';
  const ctx = makeCtx();
  const wtPath = targetWtPath(branch);
  const absGitDir = `${wtPath}/.git`;

  function setupCleanRepo(): void {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = cmd as string;
      if (c === 'git rev-parse --git-dir') return absGitDir;
      return '';
    });
    mockExistsSync.mockReturnValue(false); // no MERGE_HEAD, no rebase dirs
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs fetch / reset / clean in order on a clean worktree', () => {
    setupCleanRepo();
    ctx.resetWorktree(branch);

    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    const fetchIdx = calls.findIndex((c) => c.includes('git fetch origin'));
    const resetIdx = calls.findIndex((c) => c.includes('git reset --hard'));
    const cleanIdx = calls.findIndex((c) => c.includes('git clean -fdx'));

    expect(fetchIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeGreaterThan(fetchIdx);
    expect(cleanIdx).toBeGreaterThan(resetIdx);
  });

  it('runs git commands with the worktree path as cwd, not the base path', () => {
    setupCleanRepo();
    ctx.resetWorktree(branch);

    const fetchCall = mockExecSync.mock.calls.find((c) => (c[0] as string).includes('git fetch origin'));
    expect(fetchCall).toBeDefined();
    expect((fetchCall![1] as Record<string, unknown>).cwd).toBe(wtPath);
  });

  it('aborts in-progress merge before fetch', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = cmd as string;
      if (c === 'git rev-parse --git-dir') return absGitDir;
      return '';
    });
    const mergeHeadPath = path.join(absGitDir, 'MERGE_HEAD');
    mockExistsSync.mockImplementation((p: unknown) => (p as string) === mergeHeadPath);

    ctx.resetWorktree(branch);

    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    const mergeAbortIdx = calls.findIndex((c) => c === 'git merge --abort');
    const fetchIdx = calls.findIndex((c) => c.includes('git fetch origin'));
    expect(mergeAbortIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(mergeAbortIdx);
  });

  it('aborts in-progress rebase before fetch', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = cmd as string;
      if (c === 'git rev-parse --git-dir') return absGitDir;
      return '';
    });
    const rebaseApplyPath = path.join(absGitDir, 'rebase-apply');
    mockExistsSync.mockImplementation((p: unknown) => (p as string) === rebaseApplyPath);

    ctx.resetWorktree(branch);

    const calls = mockExecSync.mock.calls.map((c) => c[0] as string);
    const rebaseAbortIdx = calls.findIndex((c) => c === 'git rebase --abort');
    const fetchIdx = calls.findIndex((c) => c.includes('git fetch origin'));
    expect(rebaseAbortIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(rebaseAbortIdx);
  });

  it('throws when fetch fails', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = cmd as string;
      if (c === 'git rev-parse --git-dir') return absGitDir;
      if ((c as string).includes('git fetch')) throw new Error('network unreachable');
      return '';
    });
    mockExistsSync.mockReturnValue(false);

    expect(() => ctx.resetWorktree(branch)).toThrow(/fetch/);
  });

  it('throws when reset fails', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = cmd as string;
      if (c === 'git rev-parse --git-dir') return absGitDir;
      if (c.includes('git reset --hard')) throw new Error('reset failed');
      return '';
    });
    mockExistsSync.mockReturnValue(false);

    expect(() => ctx.resetWorktree(branch)).toThrow(/reset/);
  });

  it('throws when clean fails', () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = cmd as string;
      if (c === 'git rev-parse --git-dir') return absGitDir;
      if (c === 'git clean -fdx') throw new Error('clean failed');
      return '';
    });
    mockExistsSync.mockReturnValue(false);

    expect(() => ctx.resetWorktree(branch)).toThrow(/clean/);
  });
});

// ── createWorktreeForNewBranch ────────────────────────────────────────────────

describe('createWorktreeForNewBranch', () => {
  const branch = 'feature-issue-661-new';
  const ctx = makeCtx();
  const wtPath = targetWtPath(branch);

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReturnValue('');
  });

  it('calls git worktree add -b with HEAD as base when no baseBranch given', () => {
    ctx.createWorktreeForNewBranch(branch);

    const addCall = mockExecSync.mock.calls.find((c) =>
      (c[0] as string).includes('git worktree add -b'),
    );
    expect(addCall).toBeDefined();
    expect(addCall![0] as string).toContain('HEAD');
  });

  it('returns the expected worktree path under the base path', () => {
    const result = ctx.createWorktreeForNewBranch(branch);
    expect(result).toBe(wtPath);
  });

  it('runs git with cwd = basePath, not process.cwd()', () => {
    ctx.createWorktreeForNewBranch(branch);

    const addCall = mockExecSync.mock.calls.find((c) =>
      (c[0] as string).includes('git worktree add -b'),
    );
    expect((addCall![1] as Record<string, unknown>).cwd).toBe(TARGET_BASE);
  });

  it('throws when branch name is empty', () => {
    expect(() => ctx.createWorktreeForNewBranch('')).toThrow(/branchName/);
  });
});

// ── removeWorktreesForIssue ───────────────────────────────────────────────────

describe('removeWorktreesForIssue', () => {
  const ctx = makeCtx();

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  it('returns 0 when no worktrees match the issue number', () => {
    mockExecSync.mockReturnValue(
      `worktree ${TARGET_BASE}\nHEAD abc123\nbranch refs/heads/main\n\n`,
    );

    const result = ctx.removeWorktreesForIssue(999);
    expect(result).toBe(0);
  });

  it('removes matching worktrees and prunes', () => {
    const issueWtPath = path.join(TARGET_BASE, '.worktrees', 'feature-issue-42-foo');
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = cmd as string;
      if (c === 'git worktree list --porcelain') {
        return [
          `worktree ${TARGET_BASE}`,
          'HEAD abc',
          'branch refs/heads/main',
          '',
          `worktree ${issueWtPath}`,
          'HEAD def',
          'branch refs/heads/feature-issue-42-foo',
          '',
        ].join('\n');
      }
      return '';
    });

    const result = ctx.removeWorktreesForIssue(42);
    expect(result).toBe(1);

    const prune = mockExecSync.mock.calls.find((c) => (c[0] as string) === 'git worktree prune');
    expect(prune).toBeDefined();
  });
});

// ── listWorktrees ─────────────────────────────────────────────────────────────

describe('listWorktrees', () => {
  const ctx = makeCtx();

  beforeEach(() => vi.clearAllMocks());

  it('excludes the main repository root and includes only worktrees paths', () => {
    const wt1 = path.join(TARGET_BASE, '.worktrees', 'branch-a');
    const wt2 = path.join(TARGET_BASE, '.worktrees', 'branch-b');
    mockExecSync.mockReturnValue(
      [
        `worktree ${TARGET_BASE}`,
        'HEAD abc',
        '',
        `worktree ${wt1}`,
        'HEAD def',
        '',
        `worktree ${wt2}`,
        'HEAD ghi',
        '',
      ].join('\n'),
    );

    const result = ctx.listWorktrees();
    expect(result).toContain(wt1);
    expect(result).toContain(wt2);
    expect(result).not.toContain(TARGET_BASE);
  });
});
