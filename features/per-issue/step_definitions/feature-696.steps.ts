/**
 * BDD step definitions for feature-696.feature
 *
 * GitContext fetch/merge/ls-remote migration — the four new remote-op methods
 * (fetchRemote, mergeBranch, abortMerge, lsRemote) route through the
 * per-command-auth chokepoint; the two remote-git consumers are de-allowlisted.
 *
 * §1  Remote-op methods route through #run (via shared world W)
 * §2  Each migrated consumer is scanned by the guard and violation-free → feature-691.steps.ts
 * §3  Whole-repo guard still passes → feature-691.steps.ts
 * §4  TypeScript type-check passes → feature-504.steps.ts (T22)
 *
 * Setup / assertion steps for §1 are provided by feature-659.steps.ts (shared world W).
 * The supplied-worktree-path cwd assertion is provided by feature-693.steps.ts.
 * Guard steps §2–§3 are provided by feature-691.steps.ts.
 * Type-check step §4 is provided by feature-504.steps.ts.
 * Do NOT redefine any of those steps here.
 *
 * This file adds only:
 *   - the "remote-op operation" dispatchers (base-path and supplied-worktree-path forms)
 */

import { When } from '@cucumber/cucumber';
import assert from 'assert';
import { W } from './gitContextSharedWorld.ts';

// ── §1b/§1c — remote-op operation dispatcher (base-path / default-cwd form) ──
//
// Invoked without an explicit worktree path so the method defaults to the context
// base path. The recording runner captures the cwd and child env; the globally-
// registered assertion steps from feature-659.steps.ts verify them.

When('the {string} remote-op operation runs through the context', function (opName: string) {
  assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
  const ctx = W.ctx;

  switch (opName) {
    case 'fetch-remote':
      W.responseMap.set('git fetch origin', '');
      ctx.fetchRemote('main', ctx.basePath);
      break;
    case 'merge-branch':
      W.responseMap.set('git merge', '');
      ctx.mergeBranch('origin/main', ctx.basePath);
      break;
    case 'abort-merge':
      W.responseMap.set('git merge --abort', '');
      ctx.abortMerge(ctx.basePath);
      break;
    case 'ls-remote':
      W.responseMap.set('git ls-remote origin', 'abc123\trefs/heads/main\n');
      ctx.lsRemote('main');
      break;
    default:
      throw new Error(`Unknown remote-op: "${opName}"`);
  }
});

// ── §1a — remote-op operation dispatcher (supplied-worktree-path form) ────────
//
// The headline new contract: a remote-op run against a given worktree path spawns
// with cwd = exactly that path. The supplied path is stored so the assertion step
// from feature-693.steps.ts can compare it against the recorded cwd.

When(
  'the {string} remote-op operation runs through the context for worktree path {string}',
  function (opName: string, worktreePath: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
    const ctx = W.ctx;

    switch (opName) {
      case 'fetch-remote':
        W.responseMap.set('git fetch origin', '');
        ctx.fetchRemote('main', worktreePath);
        break;
      case 'merge-branch':
        W.responseMap.set('git merge', '');
        ctx.mergeBranch('origin/main', worktreePath);
        break;
      case 'abort-merge':
        W.responseMap.set('git merge --abort', '');
        ctx.abortMerge(worktreePath);
        break;
      case 'ls-remote':
        W.responseMap.set('git ls-remote origin', 'abc123\trefs/heads/main\n');
        ctx.lsRemote('main', worktreePath);
        break;
      default:
        throw new Error(`Unknown remote-op: "${opName}"`);
    }
  },
);
