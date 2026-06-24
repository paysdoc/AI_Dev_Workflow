/**
 * BDD step definitions for feature-691.feature
 *
 * GitContext gh-read migration — new read methods route through #run;
 * migrated consumers are de-allowlisted and guard-clean.
 *
 * §1  New gh-read methods carry token + identity + base-path cwd (via shared world)
 * §2  Each migrated consumer is scanned by the guard and violation-free
 * §3  Whole-repo guard still passes after de-allowlisting
 * §4  TypeScript type-check passes → feature-504.steps.ts (T22)
 *
 * Setup / assertion steps for §1 are provided by feature-659.steps.ts (shared world W).
 * Guard steps §2–§3 use module-scope state for the scan result.
 */

import { execSync } from 'child_process';
import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { scanFiles } from '../../../adws/checkGitGhGuard.ts';
import { W } from './gitContextSharedWorld.ts';

// ── Guard world state ─────────────────────────────────────────────────────────

interface GuardScanResult {
  violations: { file: string; line: number; command: string }[];
  scannedCount: number;
}

let lastGuardResult: GuardScanResult | null = null;
let guardPassedRepo: boolean | null = null;

// ── §1 — new gh-read operation dispatcher ─────────────────────────────────────

When('the {string} gh-read operation runs through the context', function (opName: string) {
  assert.ok(W.ctx !== null, 'Expected a GitContext to be set up with a recording runner');
  // Seed parseable default responses so each op completes (spy returns these by default)
  W.responseMap.set('issue list', '[]');
  W.responseMap.set('issue view', '[]');
  W.responseMap.set('pr list', '[]');

  switch (opName) {
    case 'list-open-issues':
      W.ctx.listOpenIssues({ fields: ['number', 'comments'], limit: 100 });
      break;
    case 'view-issue-comments':
      W.ctx.issueComments(1);
      break;
    case 'list-merged-prs':
      W.ctx.fetchMergedPRs();
      break;
    default:
      throw new Error(`Unknown gh-read op: "${opName}"`);
  }
});

// ── §2 — guard scan per-file ──────────────────────────────────────────────────

When('the git\\/gh guard scans the file {string}', function (filePath: string) {
  lastGuardResult = scanFiles([filePath], process.cwd());
});

Then('the git\\/gh guard scanned that file', function () {
  assert.ok(lastGuardResult !== null, 'Expected a guard scan result to be set');
  assert.strictEqual(
    lastGuardResult.scannedCount,
    1,
    `Expected scannedCount=1 (file not allowlisted) but got ${lastGuardResult.scannedCount}`,
  );
});

Then('the git\\/gh guard reports no violation in that file', function () {
  assert.ok(lastGuardResult !== null, 'Expected a guard scan result to be set');
  assert.strictEqual(
    lastGuardResult.violations.length,
    0,
    `Expected no violations but got: ${lastGuardResult.violations.map(v => `${v.file}:${v.line} ${v.command}`).join(', ')}`,
  );
});

// ── §3 — whole-repo guard ─────────────────────────────────────────────────────

When('the git\\/gh guard is run across the repository', function () {
  try {
    execSync('bunx tsx adws/checkGitGhGuard.ts', { cwd: process.cwd(), encoding: 'utf-8', stdio: 'pipe' });
    guardPassedRepo = true;
  } catch {
    guardPassedRepo = false;
  }
});

Then('the git\\/gh guard reports no violations', function () {
  assert.strictEqual(
    guardPassedRepo,
    true,
    'Expected the git/gh guard to report no violations (exit 0) across the repository',
  );
});
