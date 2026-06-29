/**
 * BDD step definitions for feature-698.feature
 *
 * GitContext upgradeClaim migration — the four claim git-op methods
 * (addDetachedWorktree, commitAllowEmpty, pushHeadToBranch, removeDetachedWorktree)
 * route through the per-command-auth chokepoint; upgradeClaim.ts is de-allowlisted.
 *
 * §1  Claim git-op methods route through #run (via shared world W)
 * §2  Lock contract survives the migration (HITL surface)
 * §3  upgradeClaim de-allowlisted and guard-clean → feature-691.steps.ts
 * §4  TypeScript type-check passes → feature-504.steps.ts
 *
 * Setup / assertion steps for §1 are provided by feature-659.steps.ts (shared world W).
 * The supplied-worktree-path cwd assertion is provided by feature-693.steps.ts.
 * Guard steps §3 are provided by feature-691.steps.ts.
 * Type-check step §4 is provided by feature-504.steps.ts.
 * Background "the ADW codebase is checked out" is provided by ensureCronOnEveryEventSteps.ts.
 * Do NOT redefine any of those steps here.
 *
 * This file adds only:
 *   - the "claim-op operation" dispatcher (supplied-worktree-path form)
 *   - the migrated claim push invocation steps (§2 When)
 *   - the §2 assertion steps (lock contract, push shape, commit shape, worktree shape)
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { W } from './gitContextSharedWorld.ts';
import { defaultPushClaimBranch, buildClaimBranchName } from '../../../adws/core/upgradeClaim.ts';

// ── Module-level state for §2 ─────────────────────────────────────────────────
// Not on W because these are ephemeral per-scenario, scoped to this feature.

let lastClaimPushResult: boolean | null = null;
let lastClaimPushError: unknown = null;
let capturedCallGroupA: Array<{ command: string; cwd: string; env: NodeJS.ProcessEnv }> = [];
let capturedCallGroupB: Array<{ command: string; cwd: string; env: NodeJS.ProcessEnv }> = [];

const FAKE_BASE_REPO = '/fake/base/repo';

// ── §2 Given helpers — configure the recording runner response for push ───────

Given('the recording runner is configured to accept the claim push', function () {
  // Default spy returns '' for unmatched commands — accept is the default; no-op.
  // Explicitly clear any prior rejection mapping to be safe.
  W.responseMap.delete('HEAD:refs/heads/');
});

Given('the recording runner is configured to reject the claim push as non-fast-forward', function () {
  const rejection = Object.assign(
    new Error('git push failed: rejected'),
    { stderr: Buffer.from('error: failed to push some refs\n! [rejected] HEAD -> adw-upgrade-test (non-fast-forward)\n') },
  );
  W.responseMap.set('HEAD:refs/heads/', rejection);
});

Given('the recording runner is configured to fail the claim push with a non-rejection git error', function () {
  const failure = Object.assign(
    new Error('git push failed: genuine error'),
    { stderr: Buffer.from('fatal: unable to access remote: Connection refused\n') },
  );
  W.responseMap.set('HEAD:refs/heads/', failure);
});

// ── §1 claim-op operation dispatcher (supplied-worktree-path form) ────────────
//
// Invoked with an explicit worktree path. The recording runner captures the cwd
// and child env; the globally-registered assertion steps from feature-659.steps.ts
// and feature-693.steps.ts verify them.

When(
  'the {string} claim-op operation runs through the context for worktree path {string}',
  function (opName: string, worktreePath: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
    const ctx = W.ctx;

    switch (opName) {
      case 'add-detached-worktree':
        W.responseMap.set('git worktree add --detach', '');
        ctx.addDetachedWorktree(worktreePath, 'origin/main', worktreePath);
        break;
      case 'commit-empty-claim':
        W.responseMap.set('git commit --allow-empty', '');
        ctx.commitAllowEmpty('ADW upgrade in progress: deadbeef [nonce1]', worktreePath);
        break;
      case 'push-claim-ref':
        W.responseMap.set('git push origin', '');
        ctx.pushHeadToBranch('adw-upgrade-deadbeef', worktreePath);
        break;
      case 'remove-claim-worktree':
        W.responseMap.set('git worktree remove --force', '');
        ctx.removeDetachedWorktree(worktreePath, worktreePath);
        break;
      default:
        throw new Error(`Unknown claim-op: "${opName}"`);
    }
  },
);

// ── §2 When — invoke the REAL migrated claim push through the recording context

When(
  'the migrated upgrade-claim push runs through the context for claim hash {string}',
  function (hash: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
    const ctx = W.ctx;
    const branchName = buildClaimBranchName(hash);

    lastClaimPushResult = null;
    lastClaimPushError = null;

    // Capture calls before invocation so we can isolate this call's contribution.
    const callsBefore = W.spyCalls.length;

    try {
      lastClaimPushResult = defaultPushClaimBranch(
        branchName,
        hash,
        FAKE_BASE_REPO,
        ctx,
        () => 'main',
      );
    } catch (err) {
      lastClaimPushError = err;
    }

    capturedCallGroupA = W.spyCalls.slice(callsBefore);
  },
);

When(
  'the migrated upgrade-claim push runs twice through the context for claim hash {string}',
  function (hash: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
    const ctx = W.ctx;
    const branchName = buildClaimBranchName(hash);

    const before1 = W.spyCalls.length;
    try {
      defaultPushClaimBranch(branchName, hash, FAKE_BASE_REPO, ctx, () => 'main');
    } catch { /* ignore */ }
    capturedCallGroupA = W.spyCalls.slice(before1);

    const before2 = W.spyCalls.length;
    try {
      defaultPushClaimBranch(branchName, hash, FAKE_BASE_REPO, ctx, () => 'main');
    } catch { /* ignore */ }
    capturedCallGroupB = W.spyCalls.slice(before2);
  },
);

// ── §2a then — push accepted ⇒ won ───────────────────────────────────────────

Then('the migrated claim push reports the upgrade claim was won', function () {
  assert.strictEqual(lastClaimPushError, null, `Expected no error but got: ${lastClaimPushError}`);
  assert.strictEqual(lastClaimPushResult, true, 'Expected push to return true (won) but got false or null');
});

// ── §2b then — push rejected ⇒ lost, not crash ───────────────────────────────

Then('the migrated claim push reports the upgrade claim was lost', function () {
  assert.strictEqual(lastClaimPushError, null, `Expected no error but got: ${lastClaimPushError}`);
  assert.strictEqual(lastClaimPushResult, false, 'Expected push to return false (lost) but got true or null');
});

// ── §2c then — genuine failure propagates ─────────────────────────────────────

Then('the migrated claim push propagates the git failure as an error', function () {
  assert.notStrictEqual(lastClaimPushError, null, 'Expected an error to be thrown but none was');
});

// ── §2d then — push shape: no force flag, correct ref ────────────────────────

Then(
  'the recorded claim push publishes the claim branch ref for hash {string}',
  function (hash: string) {
    const branchName = buildClaimBranchName(hash);
    const pushCall = capturedCallGroupA.find((c) =>
      c.command.includes('git push origin') && c.command.includes(branchName),
    );
    assert.ok(
      pushCall !== undefined,
      `Expected a push command for "${branchName}" but none found in: ${capturedCallGroupA.map((c) => c.command).join(', ')}`,
    );
    assert.ok(
      pushCall.command.includes(`HEAD:refs/heads/${branchName}`),
      `Expected push to use HEAD:refs/heads/${branchName} but got: ${pushCall.command}`,
    );
  },
);

Then('the recorded claim push carries no force flag', function () {
  const pushCall = capturedCallGroupA.find((c) => c.command.includes('git push origin'));
  assert.ok(pushCall !== undefined, 'Expected a push command but none found');
  assert.ok(
    !pushCall.command.includes('--force'),
    `Expected no --force flag but found it in: ${pushCall.command}`,
  );
  assert.ok(
    !pushCall.command.includes('--force-with-lease'),
    `Expected no --force-with-lease flag but found it in: ${pushCall.command}`,
  );
});

// ── §2e then — commit shape: allow-empty, nonce unique ───────────────────────

Then('the recorded claim commit is an allow-empty commit', function () {
  const commitCall = capturedCallGroupA.find((c) => c.command.includes('git commit'));
  assert.ok(commitCall !== undefined, 'Expected a commit command but none found');
  assert.ok(
    commitCall.command.includes('--allow-empty'),
    `Expected --allow-empty in commit command but got: ${commitCall.command}`,
  );
});

Then(
  'the recorded claim commit message contains the upgrade hash {string}',
  function (hash: string) {
    const commitCall = capturedCallGroupA.find((c) => c.command.includes('git commit'));
    assert.ok(commitCall !== undefined, 'Expected a commit command but none found');
    assert.ok(
      commitCall.command.includes(hash),
      `Expected commit message to contain hash "${hash}" but got: ${commitCall.command}`,
    );
  },
);

Then('the two recorded claim commit messages differ', function () {
  const commitA = capturedCallGroupA.find((c) => c.command.includes('git commit'));
  const commitB = capturedCallGroupB.find((c) => c.command.includes('git commit'));
  assert.ok(commitA !== undefined, 'Expected a commit command in first run but none found');
  assert.ok(commitB !== undefined, 'Expected a commit command in second run but none found');
  assert.notStrictEqual(
    commitA.command,
    commitB.command,
    `Expected two distinct commit messages (nonce differs) but both were: ${commitA.command}`,
  );
});

// ── §2f then — Bug-B: detached worktree, no local claim branch ───────────────

Then('the recorded commands add the claim worktree in detached mode', function () {
  const addCall = capturedCallGroupA.find((c) => c.command.includes('git worktree add'));
  assert.ok(addCall !== undefined, 'Expected a worktree add command but none found');
  assert.ok(
    addCall.command.includes('--detach'),
    `Expected --detach in worktree add command but got: ${addCall.command}`,
  );
});

Then(
  'the recorded commands never create a local branch named after the claim for hash {string}',
  function (hash: string) {
    const branchName = buildClaimBranchName(hash);
    const localBranchCreate = capturedCallGroupA.find(
      (c) =>
        (c.command.includes('git branch') || c.command.includes('git checkout -b')) &&
        c.command.includes(branchName),
    );
    assert.strictEqual(
      localBranchCreate,
      undefined,
      `Expected no local branch creation for "${branchName}" but found: ${localBranchCreate?.command}`,
    );
  },
);

// ── §2g then — cleanup in finally ─────────────────────────────────────────────

Then('the recorded commands force-remove the temporary claim worktree', function () {
  const removeCall = capturedCallGroupA.find(
    (c) => c.command.includes('git worktree remove') && c.command.includes('--force'),
  );
  assert.ok(
    removeCall !== undefined,
    `Expected a force worktree remove command but none found in: ${capturedCallGroupA.map((c) => c.command).join(', ')}`,
  );
});
