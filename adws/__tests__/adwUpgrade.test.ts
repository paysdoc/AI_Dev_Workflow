import { describe, it, expect, vi } from 'vitest';
import {
  executeUpgrade,
  buildUpgradePrBody,
  buildUpgradePrTitle,
  buildUpgradeFailureComment,
  buildUpgradeHitlComment,
  buildUpgradeMergeFailedComment,
  type UpgradeDeps,
  type UpgradeRunResult,
} from '../adwUpgrade';
import { buildClaimBranchName, isAdwComment, parseAdwYml } from '../core';
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
    readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: false }),
    mergePR: vi.fn().mockReturnValue({ success: true }),
    ...overrides,
  };
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('buildUpgradePrBody', () => {
  it('begins with Implements #<issueNumber>', () => {
    const body = buildUpgradePrBody(541, MOCK_HASH);
    expect(body).toMatch(/^Implements #541/);
  });

  it('contains Closes #<issueNumber> to auto-close the tracking issue on merge', () => {
    expect(buildUpgradePrBody(541, MOCK_HASH)).toContain('Closes #541');
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

describe('executeUpgrade — success path (default: auto-merge)', () => {
  it('returns outcome=completed, reason=pr_merged, and prUrl on success', async () => {
    const deps = makeDeps();
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('pr_merged');
    expect(result.prUrl).toBe('https://github.com/acme/target/pull/99');
  });

  it('creates PR with Implements #<issueNumber> in body', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    const call = (deps.createPullRequest as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreatePROptions;
    expect(call.body).toMatch(/Implements #541/);
  });

  it('creates PR with Closes #<issueNumber> in body to auto-close tracking issue on merge', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    const call = (deps.createPullRequest as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreatePROptions;
    expect(call.body).toMatch(/Closes #541/);
  });

  it('calls createPullRequest exactly once', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.createPullRequest).toHaveBeenCalledTimes(1);
  });

  it('calls mergePR once with (pr.number, repoInfo) on the default (hitl:false) path', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.mergePR).toHaveBeenCalledTimes(1);
    expect(deps.mergePR).toHaveBeenCalledWith(99, REPO_INFO);
  });

  it('never calls commentOnIssue on default success path', async () => {
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

// ── HITL opt-in paths ─────────────────────────────────────────────────────────

describe('executeUpgrade — hitl:true path', () => {
  it('does not call mergePR when hitl: true', async () => {
    const deps = makeDeps({ readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: true }) });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.mergePR).not.toHaveBeenCalled();
  });

  it('returns outcome=completed, reason=pr_opened_hitl when hitl: true', async () => {
    const deps = makeDeps({ readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: true }) });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('pr_opened_hitl');
    expect(result.prUrl).toBe('https://github.com/acme/target/pull/99');
  });

  it('posts exactly one non-ADW comment when hitl: true', async () => {
    const deps = makeDeps({ readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: true }) });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
    const body = (deps.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(isAdwComment(body)).toBe(false);
  });
});

describe('executeUpgrade — merge failure (non-fatal)', () => {
  it('returns outcome=completed, reason=merge_failed when mergePR fails', async () => {
    const deps = makeDeps({
      mergePR: vi.fn().mockReturnValue({ success: false, error: 'required status check pending' }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('merge_failed');
  });

  it('posts exactly one non-ADW comment when merge fails', async () => {
    const deps = makeDeps({
      mergePR: vi.fn().mockReturnValue({ success: false, error: 'required status check pending' }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
    const body = (deps.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(isAdwComment(body)).toBe(false);
  });

  it('does not throw when mergePR fails', async () => {
    const deps = makeDeps({
      mergePR: vi.fn().mockReturnValue({ success: false, error: 'branch protection' }),
    });
    await expect(
      executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps),
    ).resolves.toBeDefined();
  });
});

describe('parseAdwYml — malformed state flows through default path', () => {
  it('parseAdwYml returns { hitl: false } for malformed value', () => {
    expect(parseAdwYml('hitl: maybe\n')).toEqual({ hitl: false });
  });
});

// ── Non-workflow comment helpers ──────────────────────────────────────────────

describe('buildUpgradeHitlComment', () => {
  it('is NOT an ADW workflow comment', () => {
    const comment = buildUpgradeHitlComment(99, 'test-adw-id');
    expect(isAdwComment(comment)).toBe(false);
  });

  it('references the PR number', () => {
    const comment = buildUpgradeHitlComment(99, 'test-adw-id');
    expect(comment).toContain('99');
  });

  it('references the adwId', () => {
    const comment = buildUpgradeHitlComment(99, 'test-adw-id');
    expect(comment).toContain('test-adw-id');
  });
});

describe('buildUpgradeMergeFailedComment', () => {
  it('is NOT an ADW workflow comment', () => {
    const comment = buildUpgradeMergeFailedComment(99, 'branch protection', 'test-adw-id');
    expect(isAdwComment(comment)).toBe(false);
  });

  it('references the PR number', () => {
    const comment = buildUpgradeMergeFailedComment(99, 'branch protection', 'test-adw-id');
    expect(comment).toContain('99');
  });

  it('includes the failure reason', () => {
    const comment = buildUpgradeMergeFailedComment(99, 'branch protection', 'test-adw-id');
    expect(comment).toContain('branch protection');
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
