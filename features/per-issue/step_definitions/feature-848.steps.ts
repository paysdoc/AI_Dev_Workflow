/**
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

let capturedLog: string[] | null = null;
let originalConsoleLog: typeof console.log | null = null;

/** Idempotent. */
function stopLogCapture(): void {
  if (!originalConsoleLog) return;
  console.log = originalConsoleLog;
  originalConsoleLog = null;
}

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

Given('the issue record in that configuration carries the label {string}', function (label: string) {
  currentWorkflowConfig().issue.labels = [label];
});

Given('the issue record in that configuration carries no labels', function () {
  currentWorkflowConfig().issue.labels = [];
});

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
