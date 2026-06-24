/**
 * BDD step definitions for feature-692.feature
 *
 * GitContext identity-read migration — git-remote / gh-api-user identity reads
 * route through the per-command-auth chokepoint; consumers are de-allowlisted.
 *
 * §1  Identity-read methods route through #run (via shared world W)
 * §2  Each migrated consumer is scanned by the guard and violation-free
 * §3  Whole-repo guard still passes → feature-691.steps.ts
 * §4  TypeScript type-check passes → feature-504.steps.ts (T22)
 *
 * Setup / assertion steps for §1 are provided by feature-659.steps.ts.
 * Guard steps §2–§3 and the type-check step are provided by feature-691.steps.ts
 * and feature-504.steps.ts respectively — do NOT redefine them here.
 *
 * This file adds only the identity-read dispatcher, using distinct phrasing
 * ("identity-read operation") to avoid collisions with feature-659's "read operation"
 * and feature-691's "gh-read operation".
 */

import { When } from '@cucumber/cucumber';
import assert from 'assert';
import { W } from './gitContextSharedWorld.ts';

// ── §1 — identity-read operation dispatcher ───────────────────────────────────

When('the {string} identity-read operation runs through the context', function (opName: string) {
  assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');

  switch (opName) {
    case 'remote-url':
      // Seed parseable output so the method completes without a real subprocess.
      W.responseMap.set('remote get-url', 'git@github.com:acme/webapp.git\n');
      W.ctx.remoteUrl();
      break;
    case 'authenticated-user':
      // Seed parseable JSON so authenticatedUser() returns and callers can parse .login.
      W.responseMap.set('api user', '{"login":"acme-bot"}\n');
      W.ctx.authenticatedUser();
      break;
    default:
      throw new Error(`Unknown identity-read op: "${opName}"`);
  }
});
