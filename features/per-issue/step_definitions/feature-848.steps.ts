/**
 * BDD step definitions for feature-848.feature
 *
 * Reuses, and never re-registers, phrases already defined by:
 *  - features/step_definitions/ensureCronOnEveryEventSteps.ts:
 *      "the ADW codebase is checked out"
 *  - feature-796.steps.ts:
 *      "a launch boundary for the repository {string} whose providers record every call"
 *      "issue {int} carries the label {string}"
 *      "issue {int} carries no labels"
 *      "the branch {string} has a pull request numbered {int} in state {string}"
 *      "pull request {int} has no approving review"
 *      "the merge orchestrator's production dependencies are built from that boundary"
 *      "the merge orchestrator runs for issue {int} under adw id {string}"
 *      "the merge orchestrator reports the outcome {string} for reason {string}"
 *  - feature-820.steps.ts:
 *      "the recording code host reports that it can approve pull requests"
 *      "a workflow configuration bound to that boundary whose pull request url names pull request {int}"
 *      "the review phase completes with no blocker issues for that configuration"
 *      "the boundary's code host recorded an approval of pull request {int}"
 *      "the boundary's code host recorded no approval"
 *      "the review phase reported the review as passed"
 *
 * Re-registering any phrase above would raise an AmbiguousStepDefinition and break every suite
 * that shares it. This file introduces only the seven phrases feature-848.feature adds: two
 * issue-record label overrides, a logger-capture Given/Then pair, and three recording-code-host
 * behaviour flags.
 *
 * The @adw-796 and @adw-820 Before/After hooks are tag-scoped and do not fire for @adw-848
 * scenarios, so this file owns its own reset/cleanup — over the same shared world796() state,
 * plus feature-820's local state via the two exports it added for this purpose
 * (resetFeature820State, currentWorkflowConfig).
 */

import { Before, After, Given, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { world796, resetWorld } from './feature-796.steps.ts';
import { resetFeature820State, currentWorkflowConfig } from './feature-820.steps.ts';
import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';

// ── Local module state — the captured logger output ────────────────────────────

let capturedLog: string[] | null = null;
let originalConsoleLog: typeof console.log | null = null;

/** Restores console.log if a capture is active. Idempotent. */
function stopLogCapture(): void {
  if (!originalConsoleLog) return;
  console.log = originalConsoleLog;
  originalConsoleLog = null;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

Before({ tags: '@adw-848' }, function () {
  resetWorld();
  resetFeature820State();
  stopLogCapture();
  capturedLog = null;
});

After({ tags: '@adw-848' }, function () {
  stopLogCapture();
  resetFeature820State();
  const w = world796();
  for (const dir of w.tempDirs) {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  for (const adwId of w.usedAdwIds) {
    const agentsDir = path.join(AGENTS_STATE_DIR, adwId);
    if (fs.existsSync(agentsDir)) fs.rmSync(agentsDir, { recursive: true, force: true });
    const logsDir = path.join(LOGS_DIR, adwId);
    if (fs.existsSync(logsDir)) fs.rmSync(logsDir, { recursive: true, force: true });
  }
  resetWorld();
});

// ── §1 — issue-record label overrides (the workflow-start snapshot) ────────────

Given('the issue record in that configuration carries the label {string}', function (label: string) {
  currentWorkflowConfig().issue.labels = [label];
});

Given('the issue record in that configuration carries no labels', function () {
  currentWorkflowConfig().issue.labels = [];
});

// ── §1 — logger capture ─────────────────────────────────────────────────────────

Given('the ADW logger\'s output is captured', function () {
  originalConsoleLog = console.log;
  const buffer: string[] = [];
  capturedLog = buffer;
  console.log = (...args: unknown[]) => { buffer.push(args.map(String).join(' ')); };
});

Then(
  'the captured log reports pull request approval skipped because issue {int} carries the {string} label',
  function (issueNumber: number, label: string) {
    stopLogCapture();
    assert.ok(capturedLog, 'Expected the ADW logger\'s output to have been captured');
    const found = capturedLog.some(
      line => line.includes('skipping') && line.includes('PR #') && line.includes(`issue #${issueNumber}`) && line.includes(label),
    );
    assert.ok(
      found,
      `Expected a captured log line reporting the approval skip for issue #${issueNumber} (label "${label}"), got: ${capturedLog.join(' | ')}`,
    );
  },
);

// ── §3/§4 — recording code host behaviour flags ─────────────────────────────────

Given('the recording code host reports every pull request approval as failed', function () {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.approveFails = true;
});

Given('the recording code host refuses the approval capability probe by name', function () {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.refuseCanApprove = true;
});

Given('the recording code host counts the approvals it submits as approving reviews', function () {
  const w = world796();
  assert.ok(w.activeFixture, 'Expected provider fixtures to have been set up first');
  w.activeFixture.approvalsCountAsReviews = true;
});
