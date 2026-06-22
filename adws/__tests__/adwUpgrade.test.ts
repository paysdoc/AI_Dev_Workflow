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
import { buildClaimBranchName, isAdwComment, parseAdwYml, isPushRejectionError } from '../core';
import { commentOnIssue } from '../github';
import type { CreatePROptions } from '../providers/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const REPO_INFO = { owner: 'acme', repo: 'target' };
const MOCK_HASH = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const FRAMEWORK_ROOT = '/framework';

function makeDeps(overrides: Partial<UpgradeDeps> = {}): UpgradeDeps {
  return {
    computeFrameworkHash: vi.fn().mockReturnValue(MOCK_HASH),
    ensureWorktree: vi.fn().mockReturnValue('/worktrees/adw-upgrade-a1b2c3d4e5f6'),
    reconcileWorktreeToRemote: vi.fn(),
    getDefaultBranch: vi.fn().mockReturnValue('main'),
    findPRByBranch: vi.fn().mockReturnValue(null),
    runInitCommand: vi.fn().mockResolvedValue({ success: true }),
    copyInitCommandToWorktree: vi.fn(),
    verifyAdwRegen: vi.fn().mockReturnValue({ ok: true, missing: [] }),
    writeAdwVersion: vi.fn(),
    commitChanges: vi.fn().mockReturnValue(true),
    pushBranch: vi.fn(),
    isPushRejection: vi.fn().mockReturnValue(false),
    createPullRequest: vi.fn().mockReturnValue({ url: 'https://github.com/acme/target/pull/99', number: 99 }),
    commentOnIssue: vi.fn<typeof commentOnIssue>(),
    ensureLogsDirectory: vi.fn().mockReturnValue('/logs/adwupgrade'),
    log: vi.fn(),
    readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: false, unitTests: true }),
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

describe('executeUpgrade — idempotency guard (existing claim-branch PR)', () => {
  it('no-ops with reason=pr_already_exists when a PR already exists for the claim branch', async () => {
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue({ number: 77, state: 'OPEN' }) });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('pr_already_exists');
  });

  it('does not regenerate, commit, push, or open a PR when a claim-branch PR exists', async () => {
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue({ number: 77, state: 'OPEN' }) });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.runInitCommand).not.toHaveBeenCalled();
    expect(deps.writeAdwVersion).not.toHaveBeenCalled();
    expect(deps.commitChanges).not.toHaveBeenCalled();
    expect(deps.pushBranch).not.toHaveBeenCalled();
    expect(deps.createPullRequest).not.toHaveBeenCalled();
  });

  it('also no-ops for a CLOSED claim-branch PR (human-rejected upgrade must not loop)', async () => {
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue({ number: 77, state: 'CLOSED' }) });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.reason).toBe('pr_already_exists');
    expect(deps.createPullRequest).not.toHaveBeenCalled();
  });

  it('proceeds normally when no PR exists for the claim branch (genuinely stalled)', async () => {
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue(null) });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.reason).toBe('pr_merged');
    expect(deps.createPullRequest).toHaveBeenCalledTimes(1);
  });

  it('rebuilds (does NOT no-op) when the claim-branch PR is labeled wontfix', async () => {
    const deps = makeDeps({
      findPRByBranch: vi.fn().mockReturnValue({ number: 3, state: 'MERGED', labels: [{ name: "Won't fix" }] }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.reason).toBe('pr_merged');
    expect(deps.createPullRequest).toHaveBeenCalledTimes(1);
  });
});

describe('executeUpgrade — success path (default: auto-merge)', () => {
  it('returns outcome=completed, reason=pr_merged, and prUrl on success', async () => {
    const deps = makeDeps();
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('pr_merged');
    expect(result.prUrl).toBe('https://github.com/acme/target/pull/99');
  });

  it('creates PR with Implements #<issueNumber> in body', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    const call = (deps.createPullRequest as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreatePROptions;
    expect(call.body).toMatch(/Implements #541/);
  });

  it('creates PR with Closes #<issueNumber> in body to auto-close tracking issue on merge', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    const call = (deps.createPullRequest as ReturnType<typeof vi.fn>).mock.calls[0][0] as CreatePROptions;
    expect(call.body).toMatch(/Closes #541/);
  });

  it('calls createPullRequest exactly once', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.createPullRequest).toHaveBeenCalledTimes(1);
  });

  it('calls mergePR once with (pr.number, repoInfo) on the default (hitl:false) path', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.mergePR).toHaveBeenCalledTimes(1);
    expect(deps.mergePR).toHaveBeenCalledWith(99, REPO_INFO);
  });

  it('never calls commentOnIssue on default success path', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).not.toHaveBeenCalled();
  });

  it('writes .adw-version with the runtime-computed hash (not a passed-in value)', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.writeAdwVersion).toHaveBeenCalledWith(
      expect.any(String),
      MOCK_HASH,
    );
  });
});

// ── HITL opt-in paths ─────────────────────────────────────────────────────────

describe('executeUpgrade — hitl:true path', () => {
  it('does not call mergePR when hitl: true', async () => {
    const deps = makeDeps({ readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: true, unitTests: true }) });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.mergePR).not.toHaveBeenCalled();
  });

  it('returns outcome=completed, reason=pr_opened_hitl when hitl: true', async () => {
    const deps = makeDeps({ readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: true, unitTests: true }) });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('pr_opened_hitl');
    expect(result.prUrl).toBe('https://github.com/acme/target/pull/99');
  });

  it('posts exactly one non-ADW comment when hitl: true', async () => {
    const deps = makeDeps({ readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: true, unitTests: true }) });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

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
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('merge_failed');
  });

  it('posts exactly one non-ADW comment when merge fails', async () => {
    const deps = makeDeps({
      mergePR: vi.fn().mockReturnValue({ success: false, error: 'required status check pending' }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
    const body = (deps.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(isAdwComment(body)).toBe(false);
  });

  it('does not throw when mergePR fails', async () => {
    const deps = makeDeps({
      mergePR: vi.fn().mockReturnValue({ success: false, error: 'branch protection' }),
    });
    await expect(
      executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps),
    ).resolves.toBeDefined();
  });
});

// ── Claim-lost path (non-fast-forward push) ───────────────────────────────────

describe('executeUpgrade — non-fast-forward push parks instead of crashing', () => {
  function rejectingDeps(extra: Partial<UpgradeDeps> = {}): UpgradeDeps {
    const nonFf = Object.assign(new Error('failed to push some refs'), {
      stderr: Buffer.from(' ! [rejected] adw-upgrade-x -> adw-upgrade-x (non-fast-forward)'),
    });
    return makeDeps({
      pushBranch: vi.fn().mockImplementation(() => { throw nonFf; }),
      isPushRejection: vi.fn().mockReturnValue(true),
      ...extra,
    });
  }

  it('returns outcome=completed, reason=claim_lost on a rejected push', async () => {
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, rejectingDeps());

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('claim_lost');
  });

  it('does not open a PR, merge, or comment when the push is rejected', async () => {
    const deps = rejectingDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.createPullRequest).not.toHaveBeenCalled();
    expect(deps.mergePR).not.toHaveBeenCalled();
    expect(deps.commentOnIssue).not.toHaveBeenCalled();
  });

  it('does not swallow a genuine (non-rejection) push failure — rethrows it', async () => {
    const fatal = Object.assign(new Error('fatal: unable to access remote'), {
      stderr: Buffer.from('fatal: Could not read from remote repository'),
    });
    const deps = makeDeps({
      pushBranch: vi.fn().mockImplementation(() => { throw fatal; }),
      isPushRejection: vi.fn().mockReturnValue(false),
    });

    await expect(
      executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps),
    ).rejects.toThrow('unable to access remote');
  });
});

describe('isPushRejectionError', () => {
  it('classifies a non-fast-forward execSync error (stderr Buffer) as a rejection', () => {
    const err = Object.assign(new Error('Command failed: git push'), {
      stderr: Buffer.from(' ! [rejected] branch -> branch (non-fast-forward)'),
    });
    expect(isPushRejectionError(err)).toBe(true);
  });

  it('does not classify an auth/connection failure as a rejection', () => {
    const err = Object.assign(new Error('Command failed: git push'), {
      stderr: Buffer.from('fatal: Could not read from remote repository'),
    });
    expect(isPushRejectionError(err)).toBe(false);
  });
});

describe('parseAdwYml — malformed state flows through default path', () => {
  it('parseAdwYml returns { hitl: false } for malformed value', () => {
    expect(parseAdwYml('hitl: maybe\n')).toEqual({ hitl: false, unitTests: true });
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
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    const expectedBranch = buildClaimBranchName(MOCK_HASH);
    expect(deps.ensureWorktree).toHaveBeenCalledWith(
      expectedBranch,
      expect.any(String),
    );
  });
});

// ── LLM failure path ──────────────────────────────────────────────────────────

describe('executeUpgrade — LLM failure path', () => {
  it('returns outcome=failed with reason=llm_failed', async () => {
    const deps = makeDeps({
      runInitCommand: vi.fn().mockResolvedValue({ success: false, error: 'Claude timeout' }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('llm_failed');
  });

  it('posts exactly one commentOnIssue', async () => {
    const deps = makeDeps({
      runInitCommand: vi.fn().mockResolvedValue({ success: false, error: 'Claude timeout' }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
    expect(deps.commentOnIssue).toHaveBeenCalledWith(541, expect.any(String), REPO_INFO);
  });

  it('failure comment is not an ADW comment', async () => {
    const deps = makeDeps({
      runInitCommand: vi.fn().mockResolvedValue({ success: false, error: 'Claude timeout' }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    const body = (deps.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(isAdwComment(body)).toBe(false);
  });

  it('does not call createPullRequest, writeAdwVersion, commitChanges, or pushBranch', async () => {
    const deps = makeDeps({
      runInitCommand: vi.fn().mockResolvedValue({ success: false, error: 'error' }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

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
    const result: UpgradeRunResult = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('worktree_error');
  });

  it('posts a failure comment when ensureWorktree throws', async () => {
    const deps = makeDeps({
      ensureWorktree: vi.fn().mockImplementation(() => { throw new Error('git remote error'); }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
  });

  it('does not call createPullRequest when ensureWorktree throws', async () => {
    const deps = makeDeps({
      ensureWorktree: vi.fn().mockImplementation(() => { throw new Error('git remote error'); }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.createPullRequest).not.toHaveBeenCalled();
  });
});

// ── E1: anti-brick gate — regen_incomplete path ───────────────────────────────

describe('executeUpgrade — anti-brick verification gate (E1)', () => {
  it('returns outcome=failed, reason=regen_incomplete when verifyAdwRegen returns ok:false', async () => {
    const deps = makeDeps({
      verifyAdwRegen: vi.fn().mockReturnValue({ ok: false, missing: ['commands.md'] }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('regen_incomplete');
  });

  it('does not call writeAdwVersion, commitChanges, pushBranch, createPullRequest, or mergePR when gate fails', async () => {
    const deps = makeDeps({
      verifyAdwRegen: vi.fn().mockReturnValue({ ok: false, missing: ['commands.md'] }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.writeAdwVersion).not.toHaveBeenCalled();
    expect(deps.commitChanges).not.toHaveBeenCalled();
    expect(deps.pushBranch).not.toHaveBeenCalled();
    expect(deps.createPullRequest).not.toHaveBeenCalled();
    expect(deps.mergePR).not.toHaveBeenCalled();
  });

  it('posts exactly one non-ADW comment when gate fails', async () => {
    const deps = makeDeps({
      verifyAdwRegen: vi.fn().mockReturnValue({ ok: false, missing: ['commands.md'] }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
    const body = (deps.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(isAdwComment(body)).toBe(false);
  });
});

// ── Receipt-freshness gate — expectedHash threading ───────────────────────────

describe('executeUpgrade — receipt-freshness gate: expectedHash is threaded', () => {
  it('calls verifyAdwRegen with (worktreePath, MOCK_HASH)', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.verifyAdwRegen).toHaveBeenCalledWith(expect.any(String), MOCK_HASH);
  });

  it('Test 1 (regression, legitimate no-op): verifyAdwRegen ok:true → stamps .adw-version and opens PR (pr_merged)', async () => {
    // This is the path the old git-diff gate wrongly blocked:
    // a byte-identical .adw/ regen with a fresh receipt must now produce a PR.
    const deps = makeDeps({
      verifyAdwRegen: vi.fn().mockReturnValue({ ok: true, missing: [] }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.reason).toBe('pr_merged');
    expect(deps.writeAdwVersion).toHaveBeenCalledTimes(1);
    expect(deps.createPullRequest).toHaveBeenCalledTimes(1);
  });

  it('Test 2 (stale receipt → fail closed): verifyAdwRegen ok:false → regen_incomplete, no stamp/PR/merge, one non-ADW comment', async () => {
    const deps = makeDeps({
      verifyAdwRegen: vi.fn().mockReturnValue({ ok: false, missing: ['.adw/.regen-receipt (stale)'] }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('regen_incomplete');
    expect(deps.writeAdwVersion).not.toHaveBeenCalled();
    expect(deps.commitChanges).not.toHaveBeenCalled();
    expect(deps.pushBranch).not.toHaveBeenCalled();
    expect(deps.createPullRequest).not.toHaveBeenCalled();
    expect(deps.mergePR).not.toHaveBeenCalled();
    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
    const body = (deps.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(isAdwComment(body)).toBe(false);
  });
});

// ── E2: gate pass — proceeds to stamp + PR ────────────────────────────────────

describe('executeUpgrade — gate passes (E2)', () => {
  it('calls writeAdwVersion when verifyAdwRegen returns ok:true', async () => {
    const deps = makeDeps(); // verifyAdwRegen returns ok:true by default
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.verifyAdwRegen).toHaveBeenCalledTimes(1);
    expect(deps.writeAdwVersion).toHaveBeenCalledTimes(1);
  });

  it('proceeds to pr_merged on the gate-pass path', async () => {
    const deps = makeDeps();
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.reason).toBe('pr_merged');
  });
});

// ── E3: ordering — copyInitCommandToWorktree before runInitCommand ─────────────

describe('executeUpgrade — copy-before-init ordering (E3)', () => {
  it('calls copyInitCommandToWorktree before runInitCommand', async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      copyInitCommandToWorktree: vi.fn().mockImplementation(() => { callOrder.push('copy'); }),
      runInitCommand: vi.fn().mockImplementation(async () => { callOrder.push('init'); return { success: true }; }),
    });

    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(callOrder.indexOf('copy')).toBeLessThan(callOrder.indexOf('init'));
  });

  it('calls copyInitCommandToWorktree with (worktreePath, frameworkRepoRoot)', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.copyInitCommandToWorktree).toHaveBeenCalledWith(
      expect.any(String),
      FRAMEWORK_ROOT,
    );
  });
});

// ── Hash error path ───────────────────────────────────────────────────────────

describe('executeUpgrade — hash error path', () => {
  it('returns outcome=failed with reason=hash_error when computeFrameworkHash throws', async () => {
    const deps = makeDeps({
      computeFrameworkHash: vi.fn().mockImplementation(() => { throw new Error('no hashInputs:'); }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('hash_error');
  });

  it('returns outcome=failed when computeFrameworkHash returns empty string', async () => {
    const deps = makeDeps({
      computeFrameworkHash: vi.fn().mockReturnValue(''),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('hash_error');
  });

  it('posts a failure comment on hash error', async () => {
    const deps = makeDeps({
      computeFrameworkHash: vi.fn().mockImplementation(() => { throw new Error('no hashInputs:'); }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
  });
});

// ── Reconcile-before-regen (stale worktree) ───────────────────────────────────

describe('executeUpgrade — reconcile-before-regen (stale worktree)', () => {
  it('calls reconcileWorktreeToRemote once with the worktreePath and claim branch', async () => {
    const worktreePath = '/worktrees/adw-upgrade-a1b2c3d4e5f6';
    const deps = makeDeps({
      ensureWorktree: vi.fn().mockReturnValue(worktreePath),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    const expectedBranch = buildClaimBranchName(MOCK_HASH);
    expect(deps.reconcileWorktreeToRemote).toHaveBeenCalledTimes(1);
    expect(deps.reconcileWorktreeToRemote).toHaveBeenCalledWith(worktreePath, expectedBranch);
  });

  it('calls reconcileWorktreeToRemote after ensureWorktree', async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      ensureWorktree: vi.fn().mockImplementation(() => {
        callOrder.push('ensureWorktree');
        return '/worktrees/adw-upgrade-a1b2c3d4e5f6';
      }),
      reconcileWorktreeToRemote: vi.fn().mockImplementation(() => { callOrder.push('reconcileWorktreeToRemote'); }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(callOrder.indexOf('ensureWorktree')).toBeLessThan(callOrder.indexOf('reconcileWorktreeToRemote'));
  });

  it('calls reconcileWorktreeToRemote before copyInitCommandToWorktree and runInitCommand', async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      reconcileWorktreeToRemote: vi.fn().mockImplementation(() => { callOrder.push('reconcile'); }),
      copyInitCommandToWorktree: vi.fn().mockImplementation(() => { callOrder.push('copy'); }),
      runInitCommand: vi.fn().mockImplementation(async () => { callOrder.push('init'); return { success: true }; }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(callOrder.indexOf('reconcile')).toBeLessThan(callOrder.indexOf('copy'));
    expect(callOrder.indexOf('reconcile')).toBeLessThan(callOrder.indexOf('init'));
  });

  it('success path still reaches pr_merged with reconcile wired in (diverged-reuse → fast-forwardable push)', async () => {
    const deps = makeDeps();
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('pr_merged');
    expect(deps.createPullRequest).toHaveBeenCalledTimes(1);
  });

  it('reconcile failure returns worktree_error, posts one non-ADW comment, skips all regen steps', async () => {
    const deps = makeDeps({
      reconcileWorktreeToRemote: vi.fn().mockImplementation(() => {
        throw new Error('git fetch failed: connection timeout');
      }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('worktree_error');

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
    const body = (deps.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(isAdwComment(body)).toBe(false);

    expect(deps.runInitCommand).not.toHaveBeenCalled();
    expect(deps.writeAdwVersion).not.toHaveBeenCalled();
    expect(deps.commitChanges).not.toHaveBeenCalled();
    expect(deps.pushBranch).not.toHaveBeenCalled();
    expect(deps.createPullRequest).not.toHaveBeenCalled();
  });
});
