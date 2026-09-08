/**
 * BDD step definitions for feature-695.feature
 *
 * GitContext label / board / secret migration.
 *
 * §1  setSecret routes through #run — new dispatcher "secret operation"
 * §2  Migrated consumers scanned by guard, violation-free → feature-691.steps.ts
 * §3  Whole-repo guard still passes → feature-691.steps.ts
 * §4  TypeScript type-check passes → feature-504.steps.ts (T22)
 *
 * Setup / assertion steps for §1 are provided by feature-659.steps.ts (shared world W).
 * Guard steps §2–§3 are provided by feature-691.steps.ts.
 * Type-check step §4 is provided by feature-504.steps.ts.
 * Do NOT redefine any of those steps here.
 *
 * This file adds only:
 *   - the "secret operation" dispatcher for the new setSecret method
 */

import { When } from '@cucumber/cucumber';
import assert from 'assert';
import { W } from './gitContextSharedWorld.ts';
import { createGhRepoApi } from '../../../adws/providers/github/ghRepoApi.ts';

// ── §1 — secret operation dispatcher ─────────────────────────────────────────
//
// Dispatches to ctx.setSecret with a seed response map entry so the call
// returns without throwing. The recording runner captures cwd and child env;
// the globally-registered assertion steps from feature-659.steps.ts verify them.

When('the {string} secret operation runs through the context', function (opName: string) {
  assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
  const gh = createGhRepoApi(W.ctx);

  switch (opName) {
    case 'set-secret':
      W.responseMap.set('secret set', '');
      gh.setSecret('SOCKET_API_TOKEN', 's3cr3t-value');
      break;
    default:
      throw new Error(`Unknown secret op: "${opName}"`);
  }
});
