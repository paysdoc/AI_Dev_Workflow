/**
 * BDD step definitions for feature-661.feature
 *
 * GitContext — worktree operation migration (create/remove/list/path-lookup)
 *
 * §1-4 target-path authority, base-path cwd authority
 * §5   per-command token
 * §6-11 behaviour preservation
 * §12  two-context isolation
 * §13  type-check backstop (T22, handled by feature-504.steps.ts)
 *
 * Setup steps (context construction, recording runner, cwd perturbation) are
 * provided by feature-659.steps.ts — do NOT redefine them here.
 * "every captured command carried auth token" is provided by feature-662.steps.ts.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import {
  W,
  FRAMEWORK_ROOT,
} from './gitContextSharedWorld.ts';

// Module-level state for worktree op results
let lastWorktreeResult: boolean | null = null;
let lastListResult: string[] | null = null;

// ── Runner-state Givens ───────────────────────────────────────────────────────

Given('the branch {string} does not exist locally or on origin', function (branch: string) {
  const err = new Error(`fatal: ambiguous argument '${branch}'`);
  W.responseMap.set(`git rev-parse --verify "${branch}"`, err);
  W.responseMap.set(`git rev-parse --verify "origin/${branch}"`, err);
  W.responseMap.set(`git fetch origin "${branch}"`, err);
});

Given(
  'the runner reports a worktree listing with the main repository and two issue worktrees',
  function () {
    assert.ok(W.ctx !== null, 'Expected a GitContext to be set up');
    const basePath = W.ctx.basePath;
    const wt1 = basePath + '/.worktrees/feature-issue-100-one';
    const wt2 = basePath + '/.worktrees/feature-issue-100-two';
    const porcelain = [
      `worktree ${basePath}`,
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      `worktree ${wt1}`,
      'HEAD def456',
      'branch refs/heads/feature-issue-100-one',
      '',
      `worktree ${wt2}`,
      'HEAD ghi789',
      'branch refs/heads/feature-issue-100-two',
      '',
    ].join('\n');
    W.responseMap.set('git worktree list --porcelain', porcelain);
  },
);

// ── Op dispatch — single context ─────────────────────────────────────────────

When(
  'the {string} worktree operation for branch {string} runs through the context',
  function (op: string, branch: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
    W.lastError = null;
    lastWorktreeResult = null;
    try {
      if (op === 'create') {
        W.ctx.createWorktree(branch);
      } else if (op === 'remove') {
        lastWorktreeResult = W.ctx.removeWorktree(branch);
      } else {
        throw new Error(`Unknown worktree op: "${op}"`);
      }
    } catch (err) {
      W.lastError = err as Error;
    }
  },
);

When(
  'a worktree for branch {string} is created from base {string} through the context',
  function (branch: string, baseBranch: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
    W.lastError = null;
    try {
      W.ctx.createWorktreeForNewBranch(branch, baseBranch);
    } catch (err) {
      W.lastError = err as Error;
    }
  },
);

When('the worktrees are listed through the context', function () {
  assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
  W.lastError = null;
  lastListResult = null;
  try {
    lastListResult = W.ctx.listWorktrees();
  } catch (err) {
    W.lastError = err as Error;
  }
});

// ── Op dispatch — two contexts ────────────────────────────────────────────────

When(
  'the {string} worktree operation for branch {string} runs through the {string} context',
  function (op: string, branch: string, key: string) {
    const entry = W.contextsByKey.get(key);
    assert.ok(entry !== undefined, `Expected a context for key "${key}"`);
    W.lastError = null;
    try {
      if (op === 'create') {
        entry.ctx.createWorktree(branch);
      } else if (op === 'remove') {
        entry.ctx.removeWorktree(branch);
      } else {
        throw new Error(`Unknown worktree op: "${op}"`);
      }
    } catch (err) {
      W.lastError = err as Error;
    }
  },
);

// ── Target-path assertions ─────────────────────────────────────────────────────

Then(
  'a recorded worktree command targets the worktree path for branch {string}',
  function (branch: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext');
    const expected = W.ctx.worktreePathFor(branch);
    const found = W.spyCalls.some((c) => c.command.includes(expected));
    assert.ok(
      found,
      `Expected some recorded command to contain worktree path "${expected}" but calls were:\n${W.spyCalls.map((c) => c.command).join('\n')}`,
    );
  },
);

Then(
  'the recorded worktree path for branch {string} is under the target workspace, not the framework repo root',
  function (branch: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext');
    const expected = W.ctx.worktreePathFor(branch);
    assert.ok(
      expected.startsWith(W.ctx.basePath),
      `Expected "${expected}" to start with base path "${W.ctx.basePath}"`,
    );
    assert.ok(
      !expected.startsWith(FRAMEWORK_ROOT),
      `Expected "${expected}" NOT to start with FRAMEWORK_ROOT "${FRAMEWORK_ROOT}"`,
    );
    const found = W.spyCalls.some((c) => c.command.includes(expected));
    assert.ok(
      found,
      `Expected some recorded command to contain "${expected}" but calls were:\n${W.spyCalls.map((c) => c.command).join('\n')}`,
    );
  },
);

// ── Base-path cwd assertions ──────────────────────────────────────────────────

Then('the captured commands ran with cwd equal to the context base path', function () {
  assert.ok(W.ctx !== null, 'Expected a GitContext');
  assert.ok(W.spyCalls.length > 0, 'Expected at least one recorded command');
  const basePath = W.ctx.basePath;
  for (const call of W.spyCalls) {
    assert.strictEqual(
      call.cwd,
      basePath,
      `Command "${call.command}" ran with cwd "${call.cwd}" but expected "${basePath}"`,
    );
  }
});

// ── Behaviour-preservation assertions ────────────────────────────────────────

Then(
  'a recorded worktree-add command for branch {string} targets its resolved worktree path',
  function (branch: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext');
    const expected = W.ctx.worktreePathFor(branch);
    const found = W.spyCalls.some(
      (c) => c.command.includes('git worktree add') && c.command.includes(`"${expected}"`) && c.command.includes(`"${branch}"`),
    );
    assert.ok(
      found,
      `Expected a "git worktree add" command targeting "${expected}" for branch "${branch}" but calls were:\n${W.spyCalls.map((c) => c.command).join('\n')}`,
    );
  },
);

Then(
  'a recorded worktree-add command creates branch {string} from base {string}',
  function (branch: string, base: string) {
    const found = W.spyCalls.some(
      (c) =>
        c.command.includes('git worktree add -b') &&
        c.command.includes(`"${branch}"`) &&
        c.command.includes(`"origin/${base}"`),
    );
    assert.ok(
      found,
      `Expected a "git worktree add -b" command for branch "${branch}" from "origin/${base}" but calls were:\n${W.spyCalls.map((c) => c.command).join('\n')}`,
    );
  },
);

Then('the worktree operation fails loudly', function () {
  assert.ok(W.lastError !== null, 'Expected an error to have been thrown but none was');
});

Then(
  'a recorded worktree-remove command for branch {string} is issued',
  function (branch: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext');
    const expected = W.ctx.worktreePathFor(branch);
    const found = W.spyCalls.some(
      (c) => c.command.includes('git worktree remove') && c.command.includes(`"${expected}"`),
    );
    assert.ok(
      found,
      `Expected a "git worktree remove" command for path "${expected}" but calls were:\n${W.spyCalls.map((c) => c.command).join('\n')}`,
    );
  },
);

Then(
  'a recorded local-branch deletion for branch {string} is issued',
  function (branch: string) {
    const found = W.spyCalls.some(
      (c) => (c.command.includes('git branch -D') || c.command.includes('git branch -d')) && c.command.includes(`"${branch}"`),
    );
    assert.ok(
      found,
      `Expected a local-branch deletion command for "${branch}" but calls were:\n${W.spyCalls.map((c) => c.command).join('\n')}`,
    );
  },
);

Then('the operation reports the worktree was removed', function () {
  assert.strictEqual(lastWorktreeResult, true, 'Expected removeWorktree to return true');
});

Then(
  'the listed worktrees are only the entries under the context\'s .worktrees directory',
  function () {
    assert.ok(lastListResult !== null, 'Expected listWorktrees to have been called');
    assert.ok(lastListResult.length > 0, 'Expected at least one worktree in the list');
    for (const wt of lastListResult) {
      assert.ok(
        wt.includes('.worktrees'),
        `Expected "${wt}" to be under .worktrees/ directory`,
      );
    }
  },
);

Then('the main repository path is not among the listed worktrees', function () {
  assert.ok(W.ctx !== null, 'Expected a GitContext');
  assert.ok(lastListResult !== null, 'Expected listWorktrees to have been called');
  const basePath = W.ctx.basePath;
  assert.ok(
    !lastListResult.includes(basePath),
    `Expected main repo path "${basePath}" to NOT be in listed worktrees`,
  );
});

// ── Two-context isolation assertions ──────────────────────────────────────────

Then(
  'the {string} context created its worktree for branch {string} under its own base path',
  function (key: string, branch: string) {
    const entry = W.contextsByKey.get(key);
    assert.ok(entry !== undefined, `Expected a context for key "${key}"`);
    const expectedPath = entry.ctx.worktreePathFor(branch);
    const found = entry.calls.some(
      (c) => c.command.includes('git worktree add') && c.command.includes(expectedPath),
    );
    assert.ok(
      found,
      `Expected "${key}" to have issued "git worktree add" targeting "${expectedPath}" but calls were:\n${entry.calls.map((c) => c.command).join('\n')}`,
    );
    assert.ok(
      expectedPath.startsWith(entry.ctx.basePath),
      `Expected "${expectedPath}" to start with base path "${entry.ctx.basePath}"`,
    );
  },
);

Then(
  'the {string} context\'s worktree commands do not target the {string} context base path',
  function (key: string, otherKey: string) {
    const entry = W.contextsByKey.get(key);
    const otherEntry = W.contextsByKey.get(otherKey);
    assert.ok(entry !== undefined, `Expected a context for key "${key}"`);
    assert.ok(otherEntry !== undefined, `Expected a context for key "${otherKey}"`);
    const otherBasePath = otherEntry.ctx.basePath;
    for (const call of entry.calls) {
      assert.ok(
        !call.command.includes(otherBasePath),
        `Expected "${key}" NOT to issue a command targeting "${otherBasePath}" but found: ${call.command}`,
      );
    }
  },
);
