/**
 * BDD step definitions for feature-694.feature
 *
 * GitContext phase-level git-read migration — lsFiles / headShort / diff / log
 * route through the per-command-auth chokepoint; five consumers are de-allowlisted.
 *
 * §1  Git-read methods route through #run (via shared world W)
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
 *   - the "git-read operation" dispatchers (base-path and supplied-worktree-path forms)
 */

import { When } from '@cucumber/cucumber';
import assert from 'assert';
import { W } from './gitContextSharedWorld.ts';

// ── §1b — git-read operation dispatcher (base-path form) ──────────────────────
//
// Each op is invoked without an explicit worktree path, so it defaults to the
// context base path. The recording runner captures the cwd and child env; the
// globally-registered assertion steps from feature-659.steps.ts verify them.

When('the {string} git-read operation runs through the context', function (opName: string) {
  assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
  const ctx = W.ctx;

  switch (opName) {
    case 'ls-files':
      // Seed an empty file list so lsFiles returns without issue
      W.responseMap.set('ls-files', 'README.md\npackage.json\n');
      ctx.lsFiles(ctx.basePath);
      break;
    case 'head-short':
      // Seed a short hash so headShort returns a trimmed string
      W.responseMap.set('rev-parse --short HEAD', 'abc1234\n');
      ctx.headShort(ctx.basePath);
      break;
    case 'diff':
      // Pass basePath as the worktree cwd and a default range to keep cwd = base path
      W.responseMap.set('git diff ', '--- a/foo\n+++ b/foo\n');
      ctx.diff('main...HEAD', ctx.basePath);
      break;
    case 'log':
      // Seed a parseable %aI %s line so the call completes
      W.responseMap.set('git log ', '2024-01-01T00:00:00Z build-agent: feat: #1\n');
      ctx.log('feature-issue-1-demo', ctx.basePath);
      break;
    default:
      throw new Error(`Unknown git-read op: "${opName}"`);
  }
});

// ── §1a — git-read operation dispatcher (supplied-worktree-path form) ──────────
//
// The headline new contract: a read run against a given worktree path spawns
// with cwd = exactly that path. The supplied path is stored so the assertion
// step from feature-693.steps.ts can compare it against the recorded cwd.

When(
  'the {string} git-read operation runs through the context for worktree path {string}',
  function (opName: string, worktreePath: string) {
    assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
    const ctx = W.ctx;

    switch (opName) {
      case 'ls-files':
        W.responseMap.set('ls-files', 'README.md\n');
        ctx.lsFiles(worktreePath);
        break;
      case 'head-short':
        W.responseMap.set('rev-parse --short HEAD', 'abc1234\n');
        ctx.headShort(worktreePath);
        break;
      case 'diff':
        W.responseMap.set('git diff ', '--- a/foo\n+++ b/foo\n');
        ctx.diff('main...HEAD', worktreePath);
        break;
      case 'log':
        W.responseMap.set('git log ', '2024-01-01T00:00:00Z build-agent: feat: #1\n');
        ctx.log('feature-issue-1-demo', worktreePath);
        break;
      default:
        throw new Error(`Unknown git-read op: "${opName}"`);
    }
  },
);
