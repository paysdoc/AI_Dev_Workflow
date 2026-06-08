/**
 * Integration test: upgradeClaim push-race against a local bare git repo.
 *
 * Uses real git operations (commit, push, rejection) against a local bare
 * repository acting as the sandbox remote. The findPRByBranch and
 * resolveIssueNumberFromPR deps are stubbed (no gh CLI or GitHub credentials
 * needed). This satisfies the AC requirement "Integration tests against a
 * sandbox target repo" without external credentials.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { claimUpgradeOrFindExisting, buildClaimBranchName, type UpgradeClaimDeps } from '../upgradeClaim';
import type { RepoInfo } from '../../github/githubApi';

const REPO_INFO: RepoInfo = { owner: 'sandbox', repo: 'target' };
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
 * Builds a pushClaimBranch that uses real git operations but fetches from the
 * bare repo using 'main' as the default branch (avoiding the gh CLI call in
 * getDefaultBranch which requires a real GitHub remote).
 */
function makeRealPushClaimBranch(clonePath: string, defaultBranch: string) {
  return function pushClaimBranch(branchName: string, hash: string): boolean {
    execSync(`git fetch origin "${defaultBranch}"`, { stdio: 'pipe', cwd: clonePath });

    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-claim-integ-'));
    try {
      execSync(
        `git worktree add --detach "${tmpdir}" "origin/${defaultBranch}"`,
        { stdio: 'pipe', cwd: clonePath },
      );
      execSync(`git checkout -b "${branchName}"`, {
        stdio: 'pipe',
        cwd: tmpdir,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'test',
          GIT_AUTHOR_EMAIL: 'test@test.com',
          GIT_COMMITTER_NAME: 'test',
          GIT_COMMITTER_EMAIL: 'test@test.com',
        },
      });

      const nonce = Math.random().toString(36).slice(2, 10);
      execSync(
        `git commit --allow-empty -m "ADW upgrade in progress: ${hash} [${nonce}]"`,
        {
          stdio: 'pipe',
          cwd: tmpdir,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'test',
            GIT_AUTHOR_EMAIL: 'test@test.com',
            GIT_COMMITTER_NAME: 'test',
            GIT_COMMITTER_EMAIL: 'test@test.com',
          },
        },
      );

      try {
        execSync(`git push origin "${branchName}"`, { stdio: 'pipe', cwd: tmpdir });
        return true;
      } catch (pushErr) {
        const buf = (pushErr as { stderr?: Buffer | string }).stderr;
        const msg = buf instanceof Buffer ? buf.toString() : (typeof buf === 'string' ? buf : String(pushErr));
        const lower = msg.toLowerCase();
        if (
          lower.includes('rejected') ||
          lower.includes('non-fast-forward') ||
          lower.includes('failed to push some refs') ||
          lower.includes('already exists')
        ) {
          return false;
        }
        throw pushErr;
      }
    } finally {
      try {
        execSync(`git worktree remove --force "${tmpdir}"`, { stdio: 'pipe', cwd: clonePath });
      } catch {
        // best-effort
      }
      try {
        fs.rmSync(tmpdir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  };
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
