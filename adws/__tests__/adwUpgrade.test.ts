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
import { buildClaimBranchName, isAdwComment, parseAdwYml, isPushRejectionError, countUpgradeFailureComments, UPGRADE_FAILURE_SIGNATURE } from '../core';
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
    reconcileWorktreeToRemote: vi.fn(),
    getDefaultBranch: vi.fn().mockReturnValue('main'),
    findPRByBranch: vi.fn().mockReturnValue(null),
    runInitCommand: vi.fn().mockResolvedValue({ success: true }),
    copyInitCommandToWorktree: vi.fn(),
    verifyAdwRegen: vi.fn().mockReturnValue({ ok: true, missing: [] }),
    copyStarterSettings: vi.fn().mockReturnValue({ action: 'copied', destPath: '/worktrees/adw-upgrade-a1b2c3d4e5f6/.claude/settings.json' }),
    writeAdwVersion: vi.fn(),
    commitChanges: vi.fn().mockReturnValue(true),
    pushBranch: vi.fn(),
    isPushRejection: vi.fn().mockReturnValue(false),
    createPullRequest: vi.fn().mockReturnValue({ url: 'https://github.com/acme/target/pull/99', number: 99 }),
    commentOnIssue: vi.fn(),
    ensureLogsDirectory: vi.fn().mockReturnValue('/logs/adwupgrade'),
    log: vi.fn(),
    readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: false, unitTests: true }),
    mergePR: vi.fn().mockReturnValue({ success: true }),
    fetchIssueLabels: vi.fn().mockReturnValue([]),
    fetchIssueComments: vi.fn().mockReturnValue([]),
    ensureLabel: vi.fn(),
    applyLabel: vi.fn(),
    moveToStatus: vi.fn().mockResolvedValue(true),
    postSlack: vi.fn().mockResolvedValue(undefined),
    maxFailures: 3,
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
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue({ number: 77, state: 'OPEN', labels: [] }) });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('pr_already_exists');
  });

  it('does not regenerate, commit, push, or open a PR when a claim-branch PR exists', async () => {
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue({ number: 77, state: 'OPEN', labels: [] }) });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.runInitCommand).not.toHaveBeenCalled();
    expect(deps.writeAdwVersion).not.toHaveBeenCalled();
    expect(deps.commitChanges).not.toHaveBeenCalled();
    expect(deps.pushBranch).not.toHaveBeenCalled();
    expect(deps.createPullRequest).not.toHaveBeenCalled();
  });

  it('also no-ops for a CLOSED claim-branch PR (human-rejected upgrade must not loop)', async () => {
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue({ number: 77, state: 'CLOSED', labels: [] }) });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.reason).toBe('pr_already_exists');
    expect(deps.createPullRequest).not.toHaveBeenCalled();
  });

  it('proceeds normally when no PR exists for the claim branch (genuinely stalled)', async () => {
    const deps = makeDeps({ findPRByBranch: vi.fn().mockReturnValue(null) });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.reason).toBe('pr_merged');
    expect(deps.createPullRequest).toHaveBeenCalledTimes(1);
  });

  it('rebuilds (does NOT no-op) when the claim-branch PR is labeled wontfix', async () => {
    const deps = makeDeps({
      findPRByBranch: vi.fn().mockReturnValue({ number: 3, state: 'MERGED', labels: ["Won't fix"] }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.reason).toBe('pr_merged');
    expect(deps.createPullRequest).toHaveBeenCalledTimes(1);
  });
});

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
    expect(deps.mergePR).toHaveBeenCalledWith(99);
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
    const deps = makeDeps({ readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: true, unitTests: true }) });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.mergePR).not.toHaveBeenCalled();
  });

  it('returns outcome=completed, reason=pr_opened_hitl when hitl: true', async () => {
    const deps = makeDeps({ readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: true, unitTests: true }) });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('pr_opened_hitl');
    expect(result.prUrl).toBe('https://github.com/acme/target/pull/99');
  });

  it('posts exactly one non-ADW comment when hitl: true', async () => {
    const deps = makeDeps({ readAdwYmlConfig: vi.fn().mockReturnValue({ hitl: true, unitTests: true }) });
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
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, rejectingDeps());

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('claim_lost');
  });

  it('does not open a PR, merge, or comment when the push is rejected', async () => {
    const deps = rejectingDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.createPullRequest).not.toHaveBeenCalled();
    expect(deps.mergePR).not.toHaveBeenCalled();
    expect(deps.commentOnIssue).not.toHaveBeenCalled();
  });

  it('does not swallow a genuine (non-rejection) push failure — returns failed/push_error instead of throwing', async () => {
    const fatal = Object.assign(new Error('fatal: unable to access remote'), {
      stderr: Buffer.from('fatal: Could not read from remote repository'),
    });
    const deps = makeDeps({
      pushBranch: vi.fn().mockImplementation(() => { throw fatal; }),
      isPushRejection: vi.fn().mockReturnValue(false),
    });

    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('push_error');
  });
});

// ── Step 6 no-throw: commit/push failures return, not throw (issue #730) ─────

describe('executeUpgrade — step 6 commit/push failures', () => {
  it('commitChanges throw → outcome=failed, reason=commit_error, one counted failure comment, no push/PR', async () => {
    const deps = makeDeps({
      commitChanges: vi.fn().mockImplementation(() => { throw new Error('commit boom'); }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('commit_error');
    expect(deps.pushBranch).not.toHaveBeenCalled();
    expect(deps.createPullRequest).not.toHaveBeenCalled();
    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);

    const body = (deps.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(body.startsWith(UPGRADE_FAILURE_SIGNATURE)).toBe(true);
    expect(countUpgradeFailureComments([{ body, author: 'adw-bot[bot]' }])).toBe(1);
  });

  it('does not reject (resolves cleanly) when commitChanges throws', async () => {
    const deps = makeDeps({
      commitChanges: vi.fn().mockImplementation(() => { throw new Error('commit boom'); }),
    });

    await expect(
      executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps),
    ).resolves.toBeDefined();
  });

  it('pushBranch non-rejection throw → outcome=failed, reason=push_error, one counted failure comment, no PR', async () => {
    const deps = makeDeps({
      pushBranch: vi.fn().mockImplementation(() => { throw new Error('push boom'); }),
      isPushRejection: vi.fn().mockReturnValue(false),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('push_error');
    expect(deps.createPullRequest).not.toHaveBeenCalled();
    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);

    const body = (deps.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(body.startsWith(UPGRADE_FAILURE_SIGNATURE)).toBe(true);
    expect(countUpgradeFailureComments([{ body, author: 'adw-bot[bot]' }])).toBe(1);
  });

  it('does not reject (resolves cleanly) when pushBranch throws a non-rejection error', async () => {
    const deps = makeDeps({
      pushBranch: vi.fn().mockImplementation(() => { throw new Error('push boom'); }),
      isPushRejection: vi.fn().mockReturnValue(false),
    });

    await expect(
      executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps),
    ).resolves.toBeDefined();
  });

  it('pushBranch rejection (isPushRejection=true) stays claim_lost and posts no failure comment', async () => {
    const rejection = Object.assign(new Error('failed to push some refs'), {
      stderr: Buffer.from(' ! [rejected] adw-upgrade-x -> adw-upgrade-x (non-fast-forward)'),
    });
    const deps = makeDeps({
      pushBranch: vi.fn().mockImplementation(() => { throw rejection; }),
      isPushRejection: vi.fn().mockReturnValue(true),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('claim_lost');
    expect(deps.commentOnIssue).not.toHaveBeenCalled();
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
    expect(parseAdwYml('hitl: maybe\n')).toEqual({ hitl: false, unitTests: true, guardrails: false });
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
    expect(deps.commentOnIssue).toHaveBeenCalledWith(541, expect.any(String));
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

// ── E1: anti-brick gate — regen_incomplete path ───────────────────────────────

describe('executeUpgrade — anti-brick verification gate (E1)', () => {
  it('returns outcome=failed, reason=regen_incomplete when verifyAdwRegen returns ok:false', async () => {
    const deps = makeDeps({
      verifyAdwRegen: vi.fn().mockReturnValue({ ok: false, missing: ['commands.md'] }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('failed');
    expect(result.reason).toBe('regen_incomplete');
  });

  it('does not call writeAdwVersion, commitChanges, pushBranch, createPullRequest, or mergePR when gate fails', async () => {
    const deps = makeDeps({
      verifyAdwRegen: vi.fn().mockReturnValue({ ok: false, missing: ['commands.md'] }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

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
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
    const body = (deps.commentOnIssue as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(isAdwComment(body)).toBe(false);
  });
});

// ── Validity gate — single-arg signature ─────────────────────────────────────

describe('executeUpgrade — validity gate', () => {
  it('calls verifyAdwRegen with (worktreePath) — one-arg validity-only signature', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.verifyAdwRegen).toHaveBeenCalledWith(expect.any(String));
  });

  it('Test 1 (regression, legitimate no-op): verifyAdwRegen ok:true → stamps .adw-version and opens PR (pr_merged)', async () => {
    // This is the path the old git-diff gate wrongly blocked:
    // a byte-identical .adw/ regen with a fresh receipt must now produce a PR.
    const deps = makeDeps({
      verifyAdwRegen: vi.fn().mockReturnValue({ ok: true, missing: [] }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.reason).toBe('pr_merged');
    expect(deps.writeAdwVersion).toHaveBeenCalledTimes(1);
    expect(deps.createPullRequest).toHaveBeenCalledTimes(1);
  });

  it('Test 2 (stale receipt → fail closed): verifyAdwRegen ok:false → regen_incomplete, no stamp/PR/merge, one non-ADW comment', async () => {
    const deps = makeDeps({
      verifyAdwRegen: vi.fn().mockReturnValue({ ok: false, missing: ['.adw/.regen-receipt (stale)'] }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

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
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.verifyAdwRegen).toHaveBeenCalledTimes(1);
    expect(deps.writeAdwVersion).toHaveBeenCalledTimes(1);
  });

  it('proceeds to pr_merged on the gate-pass path', async () => {
    const deps = makeDeps();
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

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

    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(callOrder.indexOf('copy')).toBeLessThan(callOrder.indexOf('init'));
  });

  it('calls copyInitCommandToWorktree with (worktreePath, frameworkRepoRoot)', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.copyInitCommandToWorktree).toHaveBeenCalledWith(
      expect.any(String),
      FRAMEWORK_ROOT,
    );
  });
});

// ── Starter guardrails settings copy (#763) ───────────────────────────────────

describe('executeUpgrade — starter guardrails settings copy (#763)', () => {
  it('calls copyStarterSettings exactly once with (worktreePath, frameworkRepoRoot)', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.copyStarterSettings).toHaveBeenCalledTimes(1);
    expect(deps.copyStarterSettings).toHaveBeenCalledWith(expect.any(String), FRAMEWORK_ROOT);
  });

  it('calls copyStarterSettings before commitChanges', async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      copyStarterSettings: vi.fn().mockImplementation(() => {
        callOrder.push('copyStarterSettings');
        return { action: 'copied', destPath: '/worktrees/x/.claude/settings.json' };
      }),
      commitChanges: vi.fn().mockImplementation(() => { callOrder.push('commitChanges'); return true; }),
    });

    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(callOrder.indexOf('copyStarterSettings')).toBeLessThan(callOrder.indexOf('commitChanges'));
  });

  it('commitChanges is still called with excludePaths for only adw_init.md — the starter settings file is not excluded', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.commitChanges).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { excludePaths: ['.claude/commands/adw_init.md'] },
    );
  });

  it('a skipped starter-settings result still proceeds to commit/push/PR (idempotency does not abort the run)', async () => {
    const deps = makeDeps({
      copyStarterSettings: vi.fn().mockReturnValue({ action: 'skipped', destPath: '/worktrees/x/.claude/settings.json' }),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('pr_merged');
    expect(deps.commitChanges).toHaveBeenCalledTimes(1);
    expect(deps.createPullRequest).toHaveBeenCalledTimes(1);
  });

  it('does not call copyStarterSettings when the verifyAdwRegen gate fails (regen_incomplete)', async () => {
    const deps = makeDeps({
      verifyAdwRegen: vi.fn().mockReturnValue({ ok: false, missing: ['commands.md'] }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.copyStarterSettings).not.toHaveBeenCalled();
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

// ── Failure-cap escalation (Part B) ──────────────────────────────────────────

describe('executeUpgrade — failure-cap escalation', () => {
  function makeEscalateDeps(failureCommentCount: number, cap: number, overrides: Partial<UpgradeDeps> = {}): UpgradeDeps {
    const failureBody = buildUpgradeFailureComment('error', 'id', 541);
    const comments = Array.from({ length: failureCommentCount }, () => ({
      body: failureBody,
      author: 'adw-bot[bot]',
    }));
    return makeDeps({
      fetchIssueComments: vi.fn().mockReturnValue(comments),
      maxFailures: cap,
      ...overrides,
    });
  }

  it('returns outcome=escalated when failure count reaches the cap', async () => {
    const deps = makeEscalateDeps(3, 3);
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('escalated');
    expect(result.reason).toBe('failure_cap_reached');
  });

  it('applies the terminal adw:blocked label on escalation', async () => {
    const deps = makeEscalateDeps(3, 3);
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.applyLabel).toHaveBeenCalledWith(541, 'adw:blocked');
  });

  it('moves the board to Blocked on escalation', async () => {
    const deps = makeEscalateDeps(3, 3);
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.moveToStatus).toHaveBeenCalledWith(541, 'Blocked');
  });

  it('posts exactly one Slack alert on escalation', async () => {
    const deps = makeEscalateDeps(3, 3);
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.postSlack).toHaveBeenCalledTimes(1);
  });

  it('posts one escalation comment to the issue on escalation', async () => {
    const deps = makeEscalateDeps(3, 3);
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.commentOnIssue).toHaveBeenCalledTimes(1);
  });

  it('does not regenerate (.adw/) when escalated', async () => {
    const deps = makeEscalateDeps(3, 3);
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.runInitCommand).not.toHaveBeenCalled();
    expect(deps.commitChanges).not.toHaveBeenCalled();
    expect(deps.createPullRequest).not.toHaveBeenCalled();
  });

  it('proceeds normally (pr_merged) when failure count is below the cap', async () => {
    const deps = makeEscalateDeps(2, 3);
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('pr_merged');
    expect(deps.applyLabel).not.toHaveBeenCalled();
    expect(deps.postSlack).not.toHaveBeenCalled();
  });
});

// ── Entry gate: already-escalated ─────────────────────────────────────────────

describe('executeUpgrade — entry gate (already-escalated issue)', () => {
  it('returns outcome=escalated immediately when terminal label is present', async () => {
    const deps = makeDeps({
      fetchIssueLabels: vi.fn().mockReturnValue(['adw:blocked']),
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('escalated');
    expect(result.reason).toBe('already_escalated');
  });

  it('does no regen work when terminal label is present', async () => {
    const deps = makeDeps({
      fetchIssueLabels: vi.fn().mockReturnValue(['adw:blocked']),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.runInitCommand).not.toHaveBeenCalled();
    expect(deps.commitChanges).not.toHaveBeenCalled();
    expect(deps.createPullRequest).not.toHaveBeenCalled();
    expect(deps.commentOnIssue).not.toHaveBeenCalled();
    expect(deps.postSlack).not.toHaveBeenCalled();
  });

  it('cap gate never fires when claim PR already exists (PR-idempotency guard is first)', async () => {
    const failureBody = buildUpgradeFailureComment('error', 'id', 541);
    const comments = Array.from({ length: 3 }, () => ({
      body: failureBody,
      author: 'adw-bot[bot]',
    }));
    const deps = makeDeps({
      findPRByBranch: vi.fn().mockReturnValue({ number: 77, state: 'OPEN', labels: [] }),
      fetchIssueComments: vi.fn().mockReturnValue(comments),
      maxFailures: 3,
    });
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(result.outcome).toBe('completed');
    expect(result.reason).toBe('pr_already_exists');
    expect(deps.applyLabel).not.toHaveBeenCalled();
    expect(deps.postSlack).not.toHaveBeenCalled();
  });
});

// ── Scoped regen commit (Part D) ──────────────────────────────────────────────

describe('executeUpgrade — scoped regen commit (Part D)', () => {
  it('calls commitChanges with excludePaths for adw_init.md', async () => {
    const deps = makeDeps();
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(deps.commitChanges).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { excludePaths: ['.claude/commands/adw_init.md'] },
    );
  });
});

// ── Reconcile-before-regen (stale worktree) ───────────────────────────────────

describe('executeUpgrade — reconcile-before-regen (stale worktree)', () => {
  it('calls reconcileWorktreeToRemote once with the worktreePath and claim branch', async () => {
    const worktreePath = '/worktrees/adw-upgrade-a1b2c3d4e5f6';
    const deps = makeDeps({
      ensureWorktree: vi.fn().mockReturnValue(worktreePath),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

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
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(callOrder.indexOf('ensureWorktree')).toBeLessThan(callOrder.indexOf('reconcileWorktreeToRemote'));
  });

  it('calls reconcileWorktreeToRemote before copyInitCommandToWorktree and runInitCommand', async () => {
    const callOrder: string[] = [];
    const deps = makeDeps({
      reconcileWorktreeToRemote: vi.fn().mockImplementation(() => { callOrder.push('reconcile'); }),
      copyInitCommandToWorktree: vi.fn().mockImplementation(() => { callOrder.push('copy'); }),
      runInitCommand: vi.fn().mockImplementation(async () => { callOrder.push('init'); return { success: true }; }),
    });
    await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

    expect(callOrder.indexOf('reconcile')).toBeLessThan(callOrder.indexOf('copy'));
    expect(callOrder.indexOf('reconcile')).toBeLessThan(callOrder.indexOf('init'));
  });

  it('success path still reaches pr_merged with reconcile wired in (diverged-reuse → fast-forwardable push)', async () => {
    const deps = makeDeps();
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

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
    const result = await executeUpgrade(541, 'test-id', REPO_INFO, BASE_REPO, FRAMEWORK_ROOT, deps);

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
