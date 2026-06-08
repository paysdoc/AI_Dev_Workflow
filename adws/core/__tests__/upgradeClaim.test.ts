import { describe, it, expect, vi } from 'vitest';
import {
  claimUpgradeOrFindExisting,
  buildClaimBranchName,
  buildClaimResult,
  buildDefaultUpgradeClaimDeps,
  type UpgradeClaimDeps,
} from '../upgradeClaim';
import type { RawPR } from '../../github/prApi';
import type { RepoInfo } from '../../github/githubApi';

// ── Helpers ───────────────────────────────────────────────────────────────────

const REPO_INFO: RepoInfo = { owner: 'acme', repo: 'myrepo' };
const HASH = 'abc123';
const BRANCH = 'adw-upgrade-abc123';

function makePR(overrides: Partial<RawPR> = {}): RawPR {
  return {
    number: 99,
    state: 'OPEN',
    headRefName: BRANCH,
    baseRefName: 'main',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<UpgradeClaimDeps> = {}): UpgradeClaimDeps {
  return {
    pushClaimBranch: vi.fn().mockReturnValue(true),
    findPRByBranch: vi.fn().mockReturnValue(null),
    resolveIssueNumberFromPR: vi.fn().mockReturnValue(null),
    log: vi.fn(),
    ...overrides,
  };
}

// ── buildClaimBranchName — pure ───────────────────────────────────────────────

describe('buildClaimBranchName', () => {
  it('produces adw-upgrade-<hash> for a valid hash', () => {
    expect(buildClaimBranchName('abc123')).toBe('adw-upgrade-abc123');
  });

  it('throws for an empty string', () => {
    expect(() => buildClaimBranchName('')).toThrow();
  });

  it('throws for a whitespace-only string', () => {
    expect(() => buildClaimBranchName('   ')).toThrow();
  });

  it('includes the full hash in the branch name', () => {
    const hash = 'deadbeef1234567890';
    expect(buildClaimBranchName(hash)).toBe(`adw-upgrade-${hash}`);
  });
});

// ── buildClaimResult — pure ───────────────────────────────────────────────────

describe('buildClaimResult', () => {
  it('returns won:true with branch when pushed is true', () => {
    const result = buildClaimResult(true, BRANCH, null);
    expect(result).toEqual({ won: true, branch: BRANCH });
  });

  it('returns won:false with existingBranch and null issueNumber when pushed is false and no PR', () => {
    const result = buildClaimResult(false, BRANCH, null);
    expect(result).toEqual({ won: false, existingIssueNumber: null, existingBranch: BRANCH });
  });

  it('returns won:false with resolved existingIssueNumber when pushed is false and PR found', () => {
    const result = buildClaimResult(false, BRANCH, 9701);
    expect(result).toEqual({ won: false, existingIssueNumber: 9701, existingBranch: BRANCH });
  });

  it('winner result has no existingBranch field', () => {
    const result = buildClaimResult(true, BRANCH, null);
    expect('existingBranch' in result).toBe(false);
  });

  it('loser result has no branch field', () => {
    const result = buildClaimResult(false, BRANCH, null);
    expect('branch' in result).toBe(false);
  });
});

// ── claimUpgradeOrFindExisting — winner path ──────────────────────────────────

describe('claimUpgradeOrFindExisting — winner path', () => {
  it('returns { won: true, branch } when pushClaimBranch returns true', async () => {
    const deps = makeDeps({ pushClaimBranch: vi.fn().mockReturnValue(true) });

    const result = await claimUpgradeOrFindExisting(HASH, REPO_INFO, deps);

    expect(result).toEqual({ won: true, branch: BRANCH });
  });

  it('does not call findPRByBranch or resolveIssueNumberFromPR on the winner path', async () => {
    const deps = makeDeps({ pushClaimBranch: vi.fn().mockReturnValue(true) });

    await claimUpgradeOrFindExisting(HASH, REPO_INFO, deps);

    expect(deps.findPRByBranch).not.toHaveBeenCalled();
    expect(deps.resolveIssueNumberFromPR).not.toHaveBeenCalled();
  });

  it('calls pushClaimBranch with the computed branch name, hash, and repoInfo', async () => {
    const pushFn = vi.fn().mockReturnValue(true);
    const deps = makeDeps({ pushClaimBranch: pushFn });

    await claimUpgradeOrFindExisting(HASH, REPO_INFO, deps);

    expect(pushFn).toHaveBeenCalledWith(BRANCH, HASH, REPO_INFO);
  });
});

// ── claimUpgradeOrFindExisting — loser path ───────────────────────────────────

describe('claimUpgradeOrFindExisting — loser path', () => {
  it('returns { won: false, existingIssueNumber: N, existingBranch } when PR and issue resolvable', async () => {
    const deps = makeDeps({
      pushClaimBranch: vi.fn().mockReturnValue(false),
      findPRByBranch: vi.fn().mockReturnValue(makePR({ number: 55 })),
      resolveIssueNumberFromPR: vi.fn().mockReturnValue(9701),
    });

    const result = await claimUpgradeOrFindExisting(HASH, REPO_INFO, deps);

    expect(result).toEqual({ won: false, existingIssueNumber: 9701, existingBranch: BRANCH });
  });

  it('returns existingIssueNumber: null when no PR found yet (race window)', async () => {
    const deps = makeDeps({
      pushClaimBranch: vi.fn().mockReturnValue(false),
      findPRByBranch: vi.fn().mockReturnValue(null),
    });

    const result = await claimUpgradeOrFindExisting(HASH, REPO_INFO, deps);

    expect(result).toMatchObject({ won: false, existingIssueNumber: null, existingBranch: BRANCH });
    expect(deps.resolveIssueNumberFromPR).not.toHaveBeenCalled();
  });

  it('returns existingIssueNumber: null when PR present but no Implements #N', async () => {
    const deps = makeDeps({
      pushClaimBranch: vi.fn().mockReturnValue(false),
      findPRByBranch: vi.fn().mockReturnValue(makePR()),
      resolveIssueNumberFromPR: vi.fn().mockReturnValue(null),
    });

    const result = await claimUpgradeOrFindExisting(HASH, REPO_INFO, deps);

    expect(result).toMatchObject({ won: false, existingIssueNumber: null });
  });

  it('calls findPRByBranch with the claim branch and repoInfo', async () => {
    const findFn = vi.fn().mockReturnValue(null);
    const deps = makeDeps({
      pushClaimBranch: vi.fn().mockReturnValue(false),
      findPRByBranch: findFn,
    });

    await claimUpgradeOrFindExisting(HASH, REPO_INFO, deps);

    expect(findFn).toHaveBeenCalledWith(BRANCH, REPO_INFO);
  });

  it('calls resolveIssueNumberFromPR with the PR number and repoInfo', async () => {
    const resolveFn = vi.fn().mockReturnValue(42);
    const deps = makeDeps({
      pushClaimBranch: vi.fn().mockReturnValue(false),
      findPRByBranch: vi.fn().mockReturnValue(makePR({ number: 99 })),
      resolveIssueNumberFromPR: resolveFn,
    });

    await claimUpgradeOrFindExisting(HASH, REPO_INFO, deps);

    expect(resolveFn).toHaveBeenCalledWith(99, REPO_INFO);
  });
});

// ── claimUpgradeOrFindExisting — concurrency logic ────────────────────────────

describe('claimUpgradeOrFindExisting — exactly one winner logic', () => {
  it('first call wins and second call loses when push alternates true/false', async () => {
    const pushFn = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const deps = makeDeps({
      pushClaimBranch: pushFn,
      findPRByBranch: vi.fn().mockReturnValue(null),
    });

    const first = await claimUpgradeOrFindExisting(HASH, REPO_INFO, deps);
    const second = await claimUpgradeOrFindExisting(HASH, REPO_INFO, deps);

    expect(first.won).toBe(true);
    expect(second.won).toBe(false);
  });
});

// ── claimUpgradeOrFindExisting — error propagation ────────────────────────────

describe('claimUpgradeOrFindExisting — error propagation', () => {
  it('propagates errors thrown by pushClaimBranch (not misclassified as loser)', async () => {
    const networkError = new Error('ECONNREFUSED: connection refused');
    const deps = makeDeps({
      pushClaimBranch: vi.fn().mockImplementation(() => { throw networkError; }),
    });

    await expect(claimUpgradeOrFindExisting(HASH, REPO_INFO, deps)).rejects.toThrow('ECONNREFUSED');
  });
});

// ── buildDefaultUpgradeClaimDeps — smoke test ─────────────────────────────────

describe('buildDefaultUpgradeClaimDeps', () => {
  it('returns an object with the expected dep keys', () => {
    const deps = buildDefaultUpgradeClaimDeps('/tmp');
    expect(typeof deps.pushClaimBranch).toBe('function');
    expect(typeof deps.findPRByBranch).toBe('function');
    expect(typeof deps.resolveIssueNumberFromPR).toBe('function');
    expect(typeof deps.log).toBe('function');
  });
});
