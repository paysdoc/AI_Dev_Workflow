import { describe, it, expect, vi } from 'vitest';
import {
  executeUpgrade,
  buildUpgradePrBody,
  buildUpgradePrTitle,
  buildUpgradeFailureComment,
  type UpgradeDeps,
  type UpgradeRunResult,
} from '../adwUpgrade';
import { buildClaimBranchName, isAdwComment } from '../core';
import { commentOnIssue } from '../github';
import type { CreatePROptions } from '../providers/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const REPO_INFO = { owner: 'acme', repo: 'target' };
const MOCK_HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const FRAMEWORK_ROOT = '/framework';
const BASE_REPO = '/base/repo';

function makeDeps(overrides: Partial<UpgradeDeps> = {}): UpgradeDeps {
  return {
    computeFrameworkHash: vi.fn().mockReturnValue(MOCK_HASH),
    ensureWorktree: vi.fn().mockReturnValue('/worktrees/adw-upgrade-a1b2c3d4e5f6'),
    getDefaultBranch: vi.fn().mockReturnValue('main'),
    runInitCommand: vi.fn().mockResolvedValue({ success: true }),
    writeAdwVersion: vi.fn(),
    commitChanges: vi.fn().mockReturnValue(true),
    pushBranch: vi.fn(),
    createPullRequest: vi.fn().mockReturnValue({ url: 'https://github.com/acme/target/pull/99', number: 99 }),
    commentOnIssue: vi.fn<typeof commentOnIssue>(),
    ensureLogsDirectory: vi.fn().mockReturnValue('/logs/adwupgrade'),
    log: vi.fn(),
    ...overrides,
  };
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('buildUpgradePrBody', () => {
  it('begins with Implements #<issueNumber>', () => {
    const body = buildUpgradePrBody(541, MOCK_HASH);
    expect(body).toMatch(/^Implements #541/);
  });

  it('contains the full hash', () => {
    const body = buildUpgradePrBody(541, MOCK_HASH);
    expect(body).toContain(MOCK_HASH);
  });
});

describe('buildUpgradePrTitle', () => {
  it('includes the first 12 chars of the hash', () => {
    const title = buildUpgradePrTitle(MOCK_HASH);
    expect(title).toContain(MOCK_HASH.slice(0, 12));
  });
});

describe('buildUpgradeFailureComment', () => {
  it('is NOT an ADW workflow comment (concurrency-guard guarantee)', () => {
    const comment = buildUpgradeFailureComment('LLM timed out', 'test-adw-id', 541);
    expect(isAdwComment(comment)).toBe(false);
  });

  it('includes the failure reason', () => {
    const comment = buildUpgradeFailureComment('LLM timed out', 'test-adw-id', 541);
    expect(comment).toContain('LLM timed out');
  });

  it('includes the adwId', () => {
    const comment = buildUpgradeFailureComment('error', 'test-adw-id', 541);
    expect(comment).toContain('test-adw-id');
  });

  it('includes a re-run command referencing the issue number', () => {
    const comment = buildUpgradeFailureComment('error', 'test-adw-id', 541);
    expect(comment).toContain('541');
  });
});

// ── Success path ──────────────────────────────────────────────────────────────

describe('executeUpgrade — success path', () => {
  it('returns outcome=completed and prUrl on success', async () => {
    const deps = makeDeps();
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('pr_opened');
    expect(result.prUrl).toBe('https://github.com/acme/target/pull/99');
  });

  it('creates PR with Implements #<issueNumber> in body', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    const call = (deps.createPullRequest as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreatePROptions;
    expect(call.body).toMatch(/Implements #541/);
  });

  it('calls createPullRequest exactly once', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.createPullRequest).toHaveBeenCalledTimes(1);
  });

  it('never calls commentOnIssue on success', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).not.toHaveBeenCalled();
  });

  it('writes .adw-version with the runtime-computed hash (not a passed-in value)', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.writeAdwVersion).toHaveBeenCalledWith(
      expect.any(String),
      MOCK_HASH,
    );
  });
});

// ── Branch derivation ─────────────────────────────────────────────────────────

describe('executeUpgrade — branch derivation', () => {
  it('calls ensureWorktree with adw-upgrade-<hash> (matches buildClaimBranchName)', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    const expectedBranch = buildClaimBranchName(MOCK_HASH);
    expect(deps.ensureWorktree).toHaveBeenCalledWith(
      expectedBranch,
      expect.any(String),
      BASE_REPO,
    );
  });
});

// ── LLM failure path ──────────────────────────────────────────────────────────

describe('executeUpgrade — LLM failure path', () => {
  it('returns outcome=failed with reason=llm_failed', async () => {
    const deps = makeDeps({
      runInitCommand: vi.fn().mockResolvedValue({ success: false, error: 'Claude timeout' }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('llm_failed');
  });

  it('posts exactly one commentOnIssue', async () => {
    const deps = makeDeps({
      runInitCommand: vi.fn().mockResolvedValue({ success: false, error: 'Claude timeout' }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
    expect(deps.commentOnIssue).toHaveBeenCalledWith(541, expect.any(String), REPO_INFO);
  });

  it('failure comment is not an ADW comment', async () => {
    const deps = makeDeps({
      runInitCommand: vi.fn().mockResolvedValue({ success: false, error: 'Claude timeout' }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    const body = (deps.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(isAdwComment(body)).toBe(false);
  });

  it('does not call createPullRequest, writeAdwVersion, commitChanges, or pushBranch', async () => {
    const deps = makeDeps({
      runInitCommand: vi.fn().mockResolvedValue({ success: false, error: 'error' }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.createPullRequest).not.toHaveBeenCalled();
    expect(deps.writeAdwVersion).not.toHaveBeenCalled();
    expect(deps.commitChanges).not.toHaveBeenCalled();
    expect(deps.pushBranch).not.toHaveBeenCalled();
  });
});

// ── Worktree error path ───────────────────────────────────────────────────────

describe('executeUpgrade — worktree error path', () => {
  it('returns outcome=failed with reason=worktree_error when ensureWorktree throws', async () => {
    const deps = makeDeps({
      ensureWorktree: vi.fn().mockImplementation(() => { throw new Error('git remote error'); }),
    });
    const result: UpgradeRunResult = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('worktree_error');
  });

  it('posts a failure comment when ensureWorktree throws', async () => {
    const deps = makeDeps({
      ensureWorktree: vi.fn().mockImplementation(() => { throw new Error('git remote error'); }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
  });

  it('does not call createPullRequest when ensureWorktree throws', async () => {
    const deps = makeDeps({
      ensureWorktree: vi.fn().mockImplementation(() => { throw new Error('git remote error'); }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.createPullRequest).not.toHaveBeenCalled();
  });
});

// ── Hash error path ───────────────────────────────────────────────────────────

describe('executeUpgrade — hash error path', () => {
  it('returns outcome=failed with reason=hash_error when computeFrameworkHash throws', async () => {
    const deps = makeDeps({
      computeFrameworkHash: vi.fn().mockImplementation(() => { throw new Error('no hashInputs:'); }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('hash_error');
  });

  it('returns outcome=failed when computeFrameworkHash returns empty string', async () => {
    const deps = makeDeps({
      computeFrameworkHash: vi.fn().mockReturnValue(''),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('hash_error');
  });

  it('posts a failure comment on hash error', async () => {
    const deps = makeDeps({
      computeFrameworkHash: vi.fn().mockImplementation(() => { throw new Error('no hashInputs:'); }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
  });
});
