/**
 * BDD step definitions for feature-693.feature
 *
 * GitContext VCS probe/branch migration — worktree-probe, branch-list, force-delete,
 * and dirty-tree reads route through the per-command-auth chokepoint; five consumers
 * are de-allowlisted.
 *
 * §1  Probe/branch methods route through #run (via shared world W)
 * §2  Each migrated consumer is scanned by the guard and violation-free → feature-691.steps.ts
 * §3  Whole-repo guard still passes → feature-691.steps.ts
 * §4  TypeScript type-check passes → feature-504.steps.ts (T22)
 *
 * Setup / assertion steps for §1 are provided by feature-659.steps.ts (shared world W).
 * Guard steps §2–§3 are provided by feature-691.steps.ts.
 * Type-check step §4 is provided by feature-504.steps.ts.
 * Do NOT redefine any of those steps here.
 *
 * This file adds only:
 *   - the "vcs-probe operation" dispatchers (base-path and supplied-worktree-path forms)
 *   - the "cwd equal to the supplied worktree path" assertion
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { W } from './gitContextSharedWorld.ts';

// ── §1b/§1c — vcs-probe operation dispatcher (base-path form) ────────────────
//
// Each op is invoked without an explicit worktree path, so it defaults to the
// context base path. The recording runner captures the cwd and child env; the
// globally-registered assertion steps from feature-659.steps.ts verify them.

When('the {string} vcs-probe operation runs through the context', function (opName: string) {
  assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
  const ctx = W.ctx;

  switch (opName) {
    case 'resolve-git-dir':
      // Seed an absolute path so resolveGitDir returns without throwing.
      W.responseMap.set('rev-parse --git-dir', `${ctx.basePath}/.git\n`);
      ctx.resolveGitDir(ctx.basePath);
      break;
    case 'current-branch':
      ctx.currentBranchSymbolic(ctx.basePath);
      break;
    case 'worktree-list':
      // Seed a parseable worktree block so worktreeBranches parses without error.
      W.responseMap.set(
        'worktree list --porcelain',
        `worktree ${ctx.basePath}\nbranch refs/heads/feature-issue-1-demo\n\n`,
      );
      ctx.worktreeBranches(ctx.basePath);
      break;
    case 'list-local-branches':
      ctx.localBranches(ctx.basePath);
      break;
    case 'delete-local-branch':
      // Use a non-protected branch so deleteLocalBranch actually spawns (not short-circuited).
      ctx.deleteLocalBranch('feature-issue-1-demo', ctx.basePath);
      break;
    case 'uncommitted-status':
      // hasUncommittedChanges requires an explicit path; pass basePath to keep cwd = base path.
      ctx.hasUncommittedChanges(ctx.basePath);
      break;
    default:
      throw new Error(`Unknown vcs-probe op: "${opName}"`);
  }
});

// ── §1a — vcs-probe operation dispatcher (supplied-worktree-path form) ────────
//
// The headline new contract: a probe run against a given worktree path spawns
// with cwd = exactly that path. The supplied path is stored so the assertion
// step below can compare it against the recorded cwd.

When(
  'the {string} vcs-probe operation runs through the context for worktree path {string}',
  function (opName: string, worktreePath: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
    const ctx = W.ctx;

    switch (opName) {
      case 'resolve-git-dir':
        W.responseMap.set('rev-parse --git-dir', `${worktreePath}/.git\n`);
        ctx.resolveGitDir(worktreePath);
        break;
      case 'current-branch':
        ctx.currentBranchSymbolic(worktreePath);
        break;
      case 'worktree-list':
        W.responseMap.set(
          'worktree list --porcelain',
          `worktree ${worktreePath}\nbranch refs/heads/feature-issue-1-demo\n\n`,
        );
        ctx.worktreeBranches(worktreePath);
        break;
      case 'list-local-branches':
        ctx.localBranches(worktreePath);
        break;
      case 'delete-local-branch':
        ctx.deleteLocalBranch('feature-issue-1-demo', worktreePath);
        break;
      case 'uncommitted-status':
        ctx.hasUncommittedChanges(worktreePath);
        break;
      default:
        throw new Error(`Unknown vcs-probe op: "${opName}"`);
    }
  },
);

// ── §1a — supplied worktree path assertion ────────────────────────────────────
//
// Asserts the last recorded spy call's cwd equals the literal path supplied in
// the When step — NOT the context base path, NOT the ambient process cwd.

Then(
  'the captured command ran with cwd equal to the supplied worktree path {string}',
  function (worktreePath: string) {
    assert.ok(W.spyCalls.length > 0, 'Expected at least one recorded spy call');
    const lastCall = W.spyCalls[W.spyCalls.length - 1];
    assert.strictEqual(
      lastCall.cwd,
      worktreePath,
      `Expected cwd="${worktreePath}" but the command ran with cwd="${lastCall.cwd}"`,
    );
  },
);
