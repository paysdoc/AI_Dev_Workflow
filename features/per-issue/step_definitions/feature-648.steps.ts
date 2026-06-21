/**
 * Step definitions for feature-648.feature
 *
 * Drives the production `pushBranch` in-process over a real temp git repo
 * whose `origin` is a real bare remote (local, no network). Proves the three
 * behavioral acceptance criteria:
 *
 *  §1–§3 — rewritten branch recovers / append-only unchanged / first push ok
 *  §4     — genuine divergence: distinct error, remote not clobbered
 *  §5     — TypeScript type-check passes → feature-504.steps.ts (T22)
 *
 * Step phrases introduced here (not in vocabulary registry — novel for 648):
 *  - Given  'a target repository with a feature branch {string} pushed to its origin remote'
 *  - Given  'a target repository with an unpushed feature branch {string}'
 *  - Given  'the local history of branch {string} is rewritten by a {string}'
 *  - Given  'a forward commit is appended to branch {string}'
 *  - Given  'another writer advances branch {string} on the origin remote to a commit ADW has never seen'
 *  - When   'ADW pushes branch {string} in the PR-creating step'
 *  - Then   'the push to branch {string} succeeds'
 *  - Then   'the origin remote tip of branch {string} matches ADW\'s local tip'
 *  - Then   'the origin remote has a branch {string} at ADW\'s local tip'
 *  - Then   'the push to branch {string} is rejected as a branch-divergence failure'
 *  - Then   'the rejection is reported distinctly from a retryable transient push failure'
 *  - Then   'the origin remote tip of branch {string} still matches the commit pushed by the other writer'
 */

import { Given, When, Then, After } from '@cucumber/cucumber';
import assert from 'assert';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pushBranch } from '../../../adws/vcs/commitOperations';

interface PushCtx {
  bareRemote: string;
  workdir: string;
  workdir2?: string;
  localTip?: string;
  otherWriterTip?: string;
  pushResult?: 'success' | 'rejected';
  pushError?: Error;
}

const ctx: PushCtx = { bareRemote: '', workdir: '' };

function git(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function makeWorkdir(): string {
  return mkdtempSync(join(tmpdir(), 'adw-648-'));
}

After({ tags: '@adw-648' }, function () {
  if (ctx.bareRemote) { rmSync(ctx.bareRemote, { recursive: true, force: true }); ctx.bareRemote = ''; }
  if (ctx.workdir) { rmSync(ctx.workdir, { recursive: true, force: true }); ctx.workdir = ''; }
  if (ctx.workdir2) { rmSync(ctx.workdir2, { recursive: true, force: true }); ctx.workdir2 = undefined; }
  ctx.localTip = undefined;
  ctx.otherWriterTip = undefined;
  ctx.pushResult = undefined;
  ctx.pushError = undefined;
});

// ── Given — repository setup ───────────────────────────────────────────────────

Given(
  'a target repository with a feature branch {string} pushed to its origin remote',
  function (branch: string) {
    ctx.bareRemote = makeWorkdir();
    ctx.workdir = makeWorkdir();

    git('git init --bare', ctx.bareRemote);
    git(`git clone "${ctx.bareRemote}" .`, ctx.workdir);
    git('git config user.email "adw@test.local"', ctx.workdir);
    git('git config user.name "ADW Test"', ctx.workdir);
    // Create a base commit on the default branch so the feature branch's
    // initial commit has a parent. This is necessary for squash/rebase rewrites
    // that need to reset to the commit before the feature branch started.
    git('git commit --allow-empty -m "base commit"', ctx.workdir);
    git('git push -u origin HEAD', ctx.workdir);
    git(`git checkout -b ${branch}`, ctx.workdir);
    git('git commit --allow-empty -m "initial commit"', ctx.workdir);
    git(`git push -u origin ${branch}`, ctx.workdir);
  },
);

Given(
  'a target repository with an unpushed feature branch {string}',
  function (branch: string) {
    ctx.bareRemote = makeWorkdir();
    ctx.workdir = makeWorkdir();

    git('git init --bare', ctx.bareRemote);
    git(`git clone "${ctx.bareRemote}" .`, ctx.workdir);
    git('git config user.email "adw@test.local"', ctx.workdir);
    git('git config user.name "ADW Test"', ctx.workdir);
    // Need at least one commit so the repo is not empty; push on default branch,
    // then create the feature branch locally without pushing it.
    git('git commit --allow-empty -m "root commit"', ctx.workdir);
    git('git push -u origin HEAD', ctx.workdir);
    git(`git checkout -b ${branch}`, ctx.workdir);
    git('git commit --allow-empty -m "feature start"', ctx.workdir);
  },
);

Given(
  'the local history of branch {string} is rewritten by a {string}',
  function (branch: string, rewriteMode: string) {
    const cwd = ctx.workdir;
    assert.ok(cwd, 'workdir must be set by a prior Given');
    assert.ok(
      ['amend', 'squash', 'rebase'].includes(rewriteMode),
      `Unknown rewrite mode: ${rewriteMode}`,
    );

    if (rewriteMode === 'amend') {
      git('git commit --allow-empty --amend -m "rewritten by amend"', cwd);
    } else if (rewriteMode === 'squash') {
      // Add a second commit, then squash both feature commits back to the base
      // commit (parent of the pushed initial commit). The resulting squash
      // commit shares the base as its parent, so it diverges from the remote.
      git('git commit --allow-empty -m "extra commit for squash"', cwd);
      // HEAD~2 = base commit (grandparent: base -> initial -> HEAD)
      git('git reset --soft HEAD~2', cwd);
      git('git commit --allow-empty -m "squashed commit"', cwd);
    } else {
      // rebase: create a branch from the feature's parent (the base commit),
      // advance it, then rebase the feature branch onto it. The replayed
      // feature commit gets a new SHA and diverges from the remote.
      const parentSha = git(`git rev-parse ${branch}~1`, cwd);
      const baseBranch = 'base-for-rebase';
      git(`git checkout -b ${baseBranch} ${parentSha}`, cwd);
      git('git commit --allow-empty -m "advance base"', cwd);
      git(`git checkout ${branch}`, cwd);
      git(`git rebase ${baseBranch}`, cwd);
    }
  },
);

Given('a forward commit is appended to branch {string}', function (branch: string) {
  const cwd = ctx.workdir;
  assert.ok(cwd, 'workdir must be set by a prior Given');
  // Ensure we're on the right branch.
  git(`git checkout ${branch}`, cwd);
  git('git commit --allow-empty -m "forward commit"', cwd);
});

Given(
  'another writer advances branch {string} on the origin remote to a commit ADW has never seen',
  function (branch: string) {
    const cwd2 = makeWorkdir();
    ctx.workdir2 = cwd2;

    git(`git clone "${ctx.bareRemote}" .`, cwd2);
    git('git config user.email "other@test.local"', cwd2);
    git('git config user.name "Other Writer"', cwd2);
    git(`git checkout ${branch}`, cwd2);
    git('git commit --allow-empty -m "other writer commit"', cwd2);
    git(`git push origin ${branch}`, cwd2);

    ctx.otherWriterTip = git(`git rev-parse ${branch}`, ctx.bareRemote);
  },
);

// ── When ───────────────────────────────────────────────────────────────────────

When('ADW pushes branch {string} in the PR-creating step', function (branch: string) {
  ctx.localTip = git('git rev-parse HEAD', ctx.workdir);

  try {
    pushBranch(branch, ctx.workdir);
    ctx.pushResult = 'success';
  } catch (e) {
    ctx.pushResult = 'rejected';
    ctx.pushError = e as Error;
  }
});

// ── Then ───────────────────────────────────────────────────────────────────────

Then('the push to branch {string} succeeds', function (_branch: string) {
  assert.strictEqual(
    ctx.pushResult,
    'success',
    `Expected push to succeed but it was rejected: ${ctx.pushError?.message ?? ''}`,
  );
});

Then(
  "the origin remote tip of branch {string} matches ADW's local tip",
  function (branch: string) {
    const remoteTip = git(`git rev-parse ${branch}`, ctx.bareRemote);
    assert.strictEqual(
      remoteTip,
      ctx.localTip,
      `Remote tip ${remoteTip} does not match local tip ${ctx.localTip}`,
    );
  },
);

Then(
  "the origin remote has a branch {string} at ADW's local tip",
  function (branch: string) {
    const remoteTip = git(`git rev-parse ${branch}`, ctx.bareRemote);
    assert.strictEqual(
      remoteTip,
      ctx.localTip,
      `Remote branch tip ${remoteTip} does not match local tip ${ctx.localTip}`,
    );
  },
);

Then(
  'the push to branch {string} is rejected as a branch-divergence failure',
  function (_branch: string) {
    assert.strictEqual(
      ctx.pushResult,
      'rejected',
      'Expected push to be rejected as a branch-divergence failure, but it succeeded',
    );
    assert.ok(
      ctx.pushError instanceof Error,
      'Expected a thrown Error on branch-divergence rejection',
    );
  },
);

Then(
  'the rejection is reported distinctly from a retryable transient push failure',
  function () {
    assert.ok(
      ctx.pushError instanceof Error,
      'Expected pushError to be set by a prior step',
    );
    // The error must include the lease-rejection marker so callers can distinguish
    // it from transient network errors and avoid looping on the same push.
    assert.match(
      ctx.pushError.message,
      /force-with-lease/,
      `Error message must mention force-with-lease to be distinguishable from a transient error. Got: ${ctx.pushError.message}`,
    );
  },
);

Then(
  'the origin remote tip of branch {string} still matches the commit pushed by the other writer',
  function (branch: string) {
    const remoteTip = git(`git rev-parse ${branch}`, ctx.bareRemote);
    assert.strictEqual(
      remoteTip,
      ctx.otherWriterTip,
      `Remote tip ${remoteTip} should still be the other writer's commit ${ctx.otherWriterTip} — it was clobbered`,
    );
  },
);
