/**
 * BDD step definitions for feature-697.feature
 *
 * GitContext promotion-sweep PR ops migration — fetchPRChangedFiles, createPR
 * (with labels), and gitLogRead route through the per-command-auth chokepoint;
 * adwPromotionSweep.tsx is de-allowlisted.
 *
 * §1  Migrated PR/stats ops route through #run (via shared world W)
 * §2  Consumer de-allowlisted and guard-clean → feature-691.steps.ts
 * §3  Whole-repo guard still passes → feature-691.steps.ts
 * §4  TypeScript type-check passes → feature-504.steps.ts (T22)
 *
 * Setup / assertion steps for §1 are provided by feature-659.steps.ts (shared world W).
 * Guard steps §2–§3 are provided by feature-691.steps.ts.
 * Type-check step §4 is provided by feature-504.steps.ts.
 * Do NOT redefine any of those steps here.
 *
 * This file adds only:
 *   - the "promotion PR operation" dispatcher
 */

import { When } from '@cucumber/cucumber';
import assert from 'assert';
import { W } from './gitContextSharedWorld.ts';
import { createGhRepoApi } from '../../../adws/providers/github/ghRepoApi.ts';

// ── §1 — promotion PR operation dispatcher ────────────────────────────────────
//
// Invoked with one of the three op names: "pr-changed-files", "pr-create",
// "stats-log". The recording runner captures the cwd and child env; the globally-
// registered assertion steps from feature-659.steps.ts verify them.

When('the {string} promotion PR operation runs through the context', function (opName: string) {
  assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
  const ctx = W.ctx;
  const gh = createGhRepoApi(ctx);

  switch (opName) {
    case 'pr-changed-files':
      W.responseMap.set('gh pr view', '{"files":[]}');
      gh.fetchPRChangedFiles(7);
      break;
    case 'pr-create':
      W.responseMap.set('gh pr create', 'https://github.com/acme/webapp/pull/1\n');
      gh.createPR('Test PR', 'test body', 'feature-test-branch', undefined, ['regression-promotion']);
      break;
    case 'stats-log':
      W.responseMap.set('git log', '');
      ctx.logSince({ since: '2024-01-01', grep: '^regression-promotion:', oneline: true });
      break;
    default:
      throw new Error(`Unknown promotion PR op: "${opName}"`);
  }
});
