/**
 * BDD step definitions for feature-662.feature
 *
 * Extends the feature-659 harness (via the shared world) with:
 *  - Runner-state Givens (worktree dirty/clean, remote-advanced, fetch-fail)
 *  - Op dispatch When steps (commit, push, fetch-and-reset, delete-branch)
 *  - Worktree-cwd, per-command identity/token, sequence, and behaviour assertions
 *
 * Setup steps (context construction, recording runner, two-context runner, cwd
 * perturbation, parent-env snapshot, snapshot assertion) are provided by
 * feature-659.steps.ts — do NOT redefine them here.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { GitContext } from '../../../adws/gitContext/index.ts';
import { W, parseAuthor } from './gitContextSharedWorld.ts';

// ── Runner-state Givens ───────────────────────────────────────────────────────
// These run AFTER the recording runner step, but the spy reads responseMap by
// reference at call time so the configuration is visible when ops execute.

Given('the worktree for branch {string} has uncommitted changes', function (_branch: string) {
  W.responseMap.set('git status --porcelain', 'M  some-file.ts\n');
});

Given('the worktree for branch {string} is clean', function (_branch: string) {
  W.responseMap.set('git status --porcelain', '');
});

Given('the remote has advanced beyond ADW for branch {string}', function (_branch: string) {
  const err = new Error('remote: error: push rejected');
  (err as unknown as { stderr: string }).stderr = 'stale info';
  W.responseMap.set('git push --force-with-lease', err);
});

Given('the branch {string} has no remote-tracking ref yet', function (branch: string) {
  W.responseMap.set(`git fetch origin "${branch}"`, new Error('no remote ref'));
});

Given('fetching origin for branch {string} fails', function (branch: string) {
  W.responseMap.set(`git fetch origin "${branch}"`, new Error('network unreachable'));
});

// ── Op dispatch ───────────────────────────────────────────────────────────────

function runOpOnContext(ctx: GitContext, opName: string, branch: string): void {
  const worktreePath = ctx.worktreePathFor(branch);
  if (opName === 'commit') {
    ctx.commitChanges('test commit message', worktreePath);
  } else if (opName === 'push') {
    ctx.pushBranch(branch, worktreePath);
  } else if (opName === 'fetch-and-reset') {
    ctx.fetchAndResetToRemote(branch, worktreePath);
  } else if (opName === 'delete-branch') {
    ctx.deleteRemoteBranch(branch, worktreePath);
  } else {
    throw new Error(`Unknown op name: "${opName}"`);
  }
}

When(
  'the {string} operation for branch {string} runs through the context',
  function (opName: string, branch: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
    W.lastError = null;
    try {
      runOpOnContext(W.ctx, opName, branch);
    } catch (err) {
      W.lastError = err as Error;
    }
  },
);

When(
  'the {string} operation for branch {string} runs through the {string} context',
  function (opName: string, branch: string, key: string) {
    const entry = W.contextsByKey.get(key);
    assert.ok(entry !== undefined, `Expected a context for key "${key}"`);
    W.lastError = null;
    try {
      runOpOnContext(entry.ctx, opName, branch);
    } catch (err) {
      W.lastError = err as Error;
    }
  },
);

// ── Worktree-cwd assertions ───────────────────────────────────────────────────

Then(
  'the captured commands ran with cwd equal to the worktree path for branch {string}',
  function (branch: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext');
    assert.ok(W.spyCalls.length > 0, 'Expected at least one recorded command');
    const expected = W.ctx.worktreePathFor(branch);
    for (const call of W.spyCalls) {
      assert.strictEqual(
        call.cwd,
        expected,
        `Command "${call.command}" ran with cwd "${call.cwd}" but expected "${expected}"`,
      );
    }
  },
);

Then(
  'the {string} command ran with cwd equal to the worktree path for branch {string}',
  function (key: string, branch: string) {
    const entry = W.contextsByKey.get(key);
    assert.ok(entry !== undefined, `Expected context for key "${key}"`);
    assert.ok(entry.calls.length > 0, `Expected at least one recorded call for "${key}"`);
    const expected = entry.ctx.worktreePathFor(branch);
    const last = entry.calls[entry.calls.length - 1];
    assert.strictEqual(
      last.cwd,
      expected,
      `"${key}" last command ran with cwd "${last.cwd}" but expected "${expected}"`,
    );
  },
);

// ── Per-command identity / token assertions ───────────────────────────────────

Then(
  'every captured command carried git author {string} in its child environment',
  function (authorStr: string) {
    assert.ok(W.spyCalls.length > 0, 'Expected at least one recorded command');
    const { name, email } = parseAuthor(authorStr);
    for (const call of W.spyCalls) {
      assert.strictEqual(call.env['GIT_AUTHOR_NAME'], name);
      assert.strictEqual(call.env['GIT_AUTHOR_EMAIL'], email);
      assert.strictEqual(call.env['GIT_COMMITTER_NAME'], name);
      assert.strictEqual(call.env['GIT_COMMITTER_EMAIL'], email);
    }
  },
);

Then(
  'every captured command carried auth token {string} in its child environment',
  function (token: string) {
    assert.ok(W.spyCalls.length > 0, 'Expected at least one recorded command');
    for (const call of W.spyCalls) {
      assert.strictEqual(
        call.env['GH_TOKEN'],
        token,
        `Command "${call.command}" had GH_TOKEN="${call.env['GH_TOKEN']}" but expected "${token}"`,
      );
    }
  },
);

// ── Behaviour-preservation assertions ────────────────────────────────────────

Then('the operation fails with an actionable, non-resumable push error', function () {
  assert.ok(W.lastError !== null, 'Expected an error to have been thrown');
  const msg = W.lastError.message;
  assert.ok(/force-with-lease/i.test(msg), `Expected mention of force-with-lease: ${msg}`);
  assert.ok(/moved underneath|manual/i.test(msg), `Expected actionable guidance: ${msg}`);
});

Then('the operation completes without error', function () {
  assert.strictEqual(W.lastError, null, `Expected no error but got: ${W.lastError?.message}`);
});

Then('no commit command is recorded', function () {
  const hasCommit = W.spyCalls.some((c) => c.command.includes('git commit'));
  assert.strictEqual(hasCommit, false, 'Expected no git commit command to be recorded');
});

Then('the fetch is recorded before the hard reset', function () {
  const fetchIdx = W.spyCalls.findIndex((c) => c.command.includes('git fetch'));
  const resetIdx = W.spyCalls.findIndex((c) => c.command.includes('git reset --hard'));
  assert.ok(fetchIdx >= 0, 'Expected a git fetch command');
  assert.ok(resetIdx >= 0, 'Expected a git reset --hard command');
  assert.ok(fetchIdx < resetIdx, `Expected fetch (idx=${fetchIdx}) before reset (idx=${resetIdx})`);
});

Then('the operation fails and no hard reset command is recorded', function () {
  assert.ok(W.lastError !== null, 'Expected an error to have been thrown');
  const hasReset = W.spyCalls.some((c) => c.command.includes('git reset --hard'));
  assert.strictEqual(hasReset, false, 'Expected no git reset --hard after fetch failure');
});

Then('no branch-deletion command is recorded', function () {
  const hasDeletion = W.spyCalls.some(
    (c) => c.command.includes('git branch -D') || c.command.includes('git push origin --delete'),
  );
  assert.strictEqual(hasDeletion, false, 'Expected no branch-deletion command');
});

Then('a branch-deletion command for branch {string} is recorded', function (branch: string) {
  const hasDeletion = W.spyCalls.some(
    (c) =>
      (c.command.includes('git branch -D') || c.command.includes('git push origin --delete')) &&
      c.command.includes(branch),
  );
  assert.ok(hasDeletion, `Expected a branch-deletion command for "${branch}" but none found`);
});
