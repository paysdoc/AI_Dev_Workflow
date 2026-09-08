/**
 * Integration test: upgradeClaim push-race against a local bare git repo.
 *
 * Uses real git operations (commit, push, rejection) against a local bare
 * repository acting as the sandbox remote. The findPRByBranch and
 * resolveIssueNumberFromPR deps are stubbed (no gh CLI or GitHub credentials
 * needed). This satisfies the AC requirement "Integration tests against a
 * sandbox target repo" without external credentials.
 *
 * The claim git ops now route through a real GitContext (no exec spy) — the
 * GitContext identity env vars (GIT_AUTHOR_*, etc.) are injected per-command
 * rather than from a manual process.env block in defaultPushClaimBranch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  claimUpgradeOrFindExisting,
  buildClaimBranchName,
  defaultPushClaimBranch,
  type UpgradeClaimDeps,
} from '../upgradeClaim';
import type { RepoIdentifier } from '../../providers/types';
import { Platform } from '../../providers/types';
import { GitContext } from '../../gitContext';
import { createLiteralTokenProvider } from '../../providers/github/githubTokenProvider';

const REPO_INFO: RepoIdentifier = { owner: 'sandbox', repo: 'target', platform: Platform.GitHub };
const HASH = 'integ1234';
const CLAIM_BRANCH = buildClaimBranchName(HASH);

let sandboxDir = '';
let bareRepoPath = '';

function git(cwd: string, ...args: string[]): string {
  return execSync(['git', ...args].join(' '), {
    cwd,
    stdio: 'pipe',
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@test.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@test.com',
    },
  }).trim();
}

function createClone(name: string): string {
  const clonePath = path.join(sandboxDir, name);
  execSync(`git clone "${bareRepoPath}" "${clonePath}"`, {
    stdio: 'pipe',
    env: { ...process.env },
  });
  git(clonePath, 'config', 'user.email', 'test@test.com');
  git(clonePath, 'config', 'user.name', 'test');
  return clonePath;
}

/**
 * Builds a real GitContext pointed at the sandbox clone, injecting the test
 * git identity via gitIdentity so every claim-op command carries the correct
 * GIT_AUTHOR_* / GIT_COMMITTER_* env vars through the per-command chokepoint.
 * The `getDefaultBranchFn` seam keeps `gh repo view` out of the test (no network).
 */
function makeRealPushClaimBranch(clonePath: string, defaultBranch: string) {
  const ctx = new GitContext({
    owner: 'sandbox',
    repo: 'target',
    selfHost: false,
    tokenProvider: createLiteralTokenProvider('x'),
    gitIdentity: {
      authorName: 'test',
      authorEmail: 'test@test.com',
      committerName: 'test',
      committerEmail: 'test@test.com',
    },
    frameworkRepoRoot: sandboxDir,
    targetReposDir: sandboxDir,
  });
  return (branchName: string, hash: string): boolean =>
    defaultPushClaimBranch(branchName, hash, clonePath, ctx, () => defaultBranch);
}

function makePartialDeps(clonePath: string, defaultBranch = 'main'): UpgradeClaimDeps {
  return {
    pushClaimBranch: makeRealPushClaimBranch(clonePath, defaultBranch),
    findPRByBranch: vi.fn().mockReturnValue(null),
    resolveIssueNumberFromPR: vi.fn().mockReturnValue(null),
    log: vi.fn(),
  };
}

beforeEach(() => {
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-claim-integ-sandbox-'));
  bareRepoPath = path.join(sandboxDir, 'remote.git');

  // Create bare repo
  execSync(`git init --bare "${bareRepoPath}"`, { stdio: 'pipe' });

  // Seed with an initial commit on main via a temporary clone
  const seedPath = path.join(sandboxDir, 'seed');
  execSync(`git clone "${bareRepoPath}" "${seedPath}"`, { stdio: 'pipe' });
  git(seedPath, 'config', 'user.email', 'test@test.com');
  git(seedPath, 'config', 'user.name', 'test');

  fs.writeFileSync(path.join(seedPath, 'README.md'), '# sandbox\n', 'utf-8');
  git(seedPath, 'add', 'README.md');
  git(seedPath, 'commit', '-m', '"initial commit"');
  git(seedPath, 'push', 'origin', 'main');

  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(sandboxDir, { recursive: true, force: true });
});

// ── §1 First claim against absent branch wins ─────────────────────────────────

describe('first claim wins against absent branch', () => {
  it('returns { won: true, branch } and bare repo contains the claim branch', async () => {
    const clone1 = createClone('clone1');
    const deps = makePartialDeps(clone1);

    const result = await claimUpgradeOrFindExisting(HASH, REPO_INFO, deps);

    expect(result).toEqual({ won: true, branch: CLAIM_BRANCH });

    // Verify the bare repo now contains the claim branch
    const refs = execSync(`git -C "${bareRepoPath}" branch`, { encoding: 'utf-8' }).trim();
    expect(refs).toContain(CLAIM_BRANCH);
  });

  it('the claim branch has exactly one empty commit ahead of main', async () => {
    const clone1 = createClone('clone1');
    const deps = makePartialDeps(clone1);

    await claimUpgradeOrFindExisting(HASH, REPO_INFO, deps);

    // Count commits on claim branch that are not on main
    const ahead = execSync(
      `git -C "${bareRepoPath}" rev-list --count main..${CLAIM_BRANCH}`,
      { encoding: 'utf-8' },
    ).trim();
    expect(ahead).toBe('1');
  });
});

// ── §2 Second claim loses when branch already exists ─────────────────────────

describe('second claim loses when branch already exists', () => {
  it('returns { won: false, existingBranch } from a second clone after first claim wins', async () => {
    const clone1 = createClone('clone1');
    const clone2 = createClone('clone2');

    // First claim wins
    await claimUpgradeOrFindExisting(HASH, REPO_INFO, makePartialDeps(clone1));

    // Second claim loses
    const result = await claimUpgradeOrFindExisting(HASH, REPO_INFO, makePartialDeps(clone2));

    expect(result.won).toBe(false);
    if (!result.won) {
      expect(result.existingBranch).toBe(CLAIM_BRANCH);
      expect(result.existingIssueNumber).toBeNull();
    }
  });
});

// ── §3 Race: exactly one winner ───────────────────────────────────────────────

describe('race: exactly one winner out of two concurrent claims', () => {
  it('produces exactly one winner and one loser', async () => {
    const clone1 = createClone('clone1');
    const clone2 = createClone('clone2');

    // Run both concurrently (Promise.all models simultaneous attempts)
    const [r1, r2] = await Promise.all([
      claimUpgradeOrFindExisting(HASH, REPO_INFO, makePartialDeps(clone1)),
      claimUpgradeOrFindExisting(HASH, REPO_INFO, makePartialDeps(clone2)),
    ]);

    const winners = [r1, r2].filter((r) => r.won === true);
    const losers = [r1, r2].filter((r) => r.won === false);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
  });

  it('loser reports existingBranch matching the claim branch', async () => {
    const clone1 = createClone('clone1');
    const clone2 = createClone('clone2');

    const [r1, r2] = await Promise.all([
      claimUpgradeOrFindExisting(HASH, REPO_INFO, makePartialDeps(clone1)),
      claimUpgradeOrFindExisting(HASH, REPO_INFO, makePartialDeps(clone2)),
    ]);

    const loser = [r1, r2].find((r) => r.won === false);
    expect(loser).toBeDefined();
    if (loser && !loser.won) {
      expect(loser.existingBranch).toBe(CLAIM_BRANCH);
    }
  });

  it('bare repo has exactly one accepted push (one branch tip ahead of main)', async () => {
    const clone1 = createClone('clone1');
    const clone2 = createClone('clone2');

    await Promise.all([
      claimUpgradeOrFindExisting(HASH, REPO_INFO, makePartialDeps(clone1)),
      claimUpgradeOrFindExisting(HASH, REPO_INFO, makePartialDeps(clone2)),
    ]);

    // The bare repo should have exactly one commit ahead of main on the claim branch
    const ahead = execSync(
      `git -C "${bareRepoPath}" rev-list --count main..${CLAIM_BRANCH}`,
      { encoding: 'utf-8' },
    ).trim();
    expect(ahead).toBe('1');
  });
});

// ── §4 Temp worktree cleanup ──────────────────────────────────────────────────

describe('temp worktree cleanup', () => {
  it('leaves no dangling git worktrees in the clone after a winning claim', async () => {
    const clone1 = createClone('clone1');
    await claimUpgradeOrFindExisting(HASH, REPO_INFO, makePartialDeps(clone1));

    const worktrees = execSync(`git -C "${clone1}" worktree list`, { encoding: 'utf-8' });
    // Only the main worktree (the clone itself) should remain
    const lines = worktrees.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it('leaves no dangling git worktrees after a losing claim', async () => {
    const clone1 = createClone('clone1');
    const clone2 = createClone('clone2');

    await claimUpgradeOrFindExisting(HASH, REPO_INFO, makePartialDeps(clone1));
    await claimUpgradeOrFindExisting(HASH, REPO_INFO, makePartialDeps(clone2));

    const worktrees = execSync(`git -C "${clone2}" worktree list`, { encoding: 'utf-8' });
    const lines = worktrees.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
  });
});

// ── §5 Regression: leftover local branch must not crash the claim (Bug B) ──────

describe('regression: pre-existing local claim branch does not crash the push (Bug B)', () => {
  it('still wins when a stale local branch of the same name already exists in the clone', async () => {
    const clone1 = createClone('clone1');
    // Simulate the leftover the original incident left behind: a prior attempt's local
    // branch of the same deterministic name. The old `git checkout -b "<branch>"` threw
    // "a branch named '<branch>' already exists" here, crashed the orchestrator, and bypassed
    // the loser path. The detached-HEAD + `push HEAD:refs/heads/<branch>` impl never touches
    // the local branch namespace, so this must just win.
    git(clone1, 'branch', CLAIM_BRANCH, 'origin/main');

    const result = await claimUpgradeOrFindExisting(HASH, REPO_INFO, makePartialDeps(clone1));

    expect(result).toEqual({ won: true, branch: CLAIM_BRANCH });
    const refs = execSync(`git -C "${bareRepoPath}" branch`, { encoding: 'utf-8' }).trim();
    expect(refs).toContain(CLAIM_BRANCH);
  });
});
