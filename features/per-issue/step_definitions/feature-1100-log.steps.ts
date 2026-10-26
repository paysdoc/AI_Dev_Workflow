/**
 * The scenario of feature-1100.feature that runs the merge orchestrator as a process carries `@subprocess` but no `@regression`, so
 * the regression hooks give it neither the mock infrastructure nor the subprocess harness nor a cleanup. The hooks here do what
 * those do, for that scenario alone: the `@regression` scenarios that carry `@adw-1100` get theirs from the regression hooks.
 * The rest are the two Thens that read the merge log the process left behind in the checkout.
 */

import { After, Before, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import { REPO_ROOT } from '../../../adws/core/environment.ts';
import { setupMockInfrastructure, teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';
import { runCleanup } from '../../regression/support/cleanup.ts';
import { createSubprocessHarness } from '../../regression/support/subprocessHarness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const OWN_SUBPROCESS_SCENARIO = '@adw-1100 and @subprocess and not @regression';

/** The colour the console shows an error in, which the merge log is written without. */
const ANSI_COLOUR = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, 'gu');
const ISO_TIMESTAMP = '\\[\\d{4}-\\d{2}-\\d{2}T[^\\]]+\\]';
const OUTPUT_TAIL_LINES = 40;

Before({ tags: OWN_SUBPROCESS_SCENARIO }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

// Declared after the hook above, which sets up the mock server, so the order is guaranteed by this file.
Before({ tags: OWN_SUBPROCESS_SCENARIO }, function (this: RegressionWorld) {
  this.subprocess = createSubprocessHarness(this);
});

After({ tags: OWN_SUBPROCESS_SCENARIO }, async function (this: RegressionWorld) {
  await runCleanup(this);
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.subprocess = null;
  this.lastExitCode = -1;
  this.lastOutput = '';
  this.seededIssues = new Set();
  this.worktreePaths.clear();
  this.harnessEnv = {};
  this.cleanup = [];
});

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** Relative to the checkout, which is where the process runs and where its `logs/` directory is. */
function readMergeLog(logPath: string): string {
  const file = resolve(REPO_ROOT, logPath);
  assert.ok(existsSync(file), `Expected the orchestrator subprocess to have left the merge log ${file}, but it does not exist`);
  return readFileSync(file, 'utf-8');
}

function linesAbout(output: string, prNumber: number): string[] {
  return output
    .replace(ANSI_COLOUR, '')
    .split('\n')
    .filter((line) => line.includes(`PR #${prNumber}`));
}

Then(
  'the merge log {string} holds every line the orchestrator subprocess printed about PR #{int}',
  function (this: RegressionWorld, logPath: string, prNumber: number) {
    const printed = linesAbout(this.lastOutput, prNumber);
    const tail = this.lastOutput.trim().split('\n').slice(-OUTPUT_TAIL_LINES).join('\n');
    assert.ok(printed.length > 0, `Expected the orchestrator subprocess to print lines about PR #${prNumber}, but its output holds none. Last output:\n${tail}`);

    const logged = new Set(readMergeLog(logPath).split('\n'));
    const missing = printed.filter((line) => !logged.has(line));
    assert.deepStrictEqual(missing, [], `Expected ${logPath} to hold every line the process printed about PR #${prNumber}, but it lacks:\n${missing.join('\n')}`);
  },
);

Then(
  'the merge log {string} holds a timestamped {string} line for PR #{int}',
  function (this: RegressionWorld, logPath: string, text: string, prNumber: number) {
    const timestamped = new RegExp(`${ISO_TIMESTAMP}.* ${escapeForRegExp(text)}.*PR #${prNumber}\\b`, 'u');
    const log = readMergeLog(logPath);
    assert.ok(log.split('\n').some((line) => timestamped.test(line)), `Expected ${logPath} to hold a timestamped "${text}" line for PR #${prNumber}. It holds:\n${log}`);
  },
);
