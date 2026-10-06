/**
 * The Then steps of feature-990 about the baseline: where and when it ran, what it left in the workflow's state, which
 * phases did and did not run after it, and that its worktree is gone once the process has exited. Everything is read
 * from what the run left behind: the execution log, the top-level state and the logs the scenario's programs kept.
 */

import { DataTable, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';

import { BaselineStatus } from '../../../adws/core/baselineGate.ts';

import { baseBranchTip } from './feature-990-target.ts';
import {
  baselineCheckouts,
  checkRuns,
  executionLogText,
  isBaseWorktree,
  planStarts,
  remainingBaseWorktrees,
  serverEvents,
  topLevelState,
  executionLog,
} from './feature-990-read.ts';
import { lastRun } from './feature-990-run.ts';
import { requireWorkflowSetup, s } from './feature-990-world.ts';

const GREEN_BASELINE = /^Baseline green on /;

function describeChecks(runs: ReadonlyArray<{ check: string; cwd: string }>): string {
  return runs.map(run => `${run.check} in ${run.cwd}`).join('\n') || '(none)';
}

Then('the plan phase did not run', function () {
  assert.deepStrictEqual(planStarts().map(start => start.command), [], 'Expected no planning agent to have been started');
});

Then('the unit-test phase did not run', function () {
  const log = executionLogText();
  assert.ok(!/Starting test phase/.test(log), `Expected the unit-test phase not to have started, but the execution log says so:\n${log}`);
});

Then('the plan phase ran', function () {
  assert.ok(planStarts().length > 0, 'Expected a planning agent to have been started');
});

Then('the plan phase ran after the baseline', function () {
  const green = executionLog().filter(line => GREEN_BASELINE.test(line.message));
  assert.ok(green.length > 0, `Expected the execution log to say that the baseline was green, got:\n${executionLogText()}`);
  const [firstPlan] = planStarts();
  assert.ok(firstPlan, 'Expected a planning agent to have been started');
  assert.ok(green.some(line => line.at <= firstPlan.at), 'Expected the baseline to be green before the first planning agent started');
});

Then('the worktree of the base branch {string} that the baseline ran in has been removed', function (baseBranch: string) {
  const checkouts = baselineCheckouts();
  assert.ok(checkouts.length > 0, `Expected the baseline to have checked the base branch out, but the execution log holds no such line:\n${executionLogText()}`);
  checkouts.forEach((checkout) => {
    assert.strictEqual(checkout.baseBranch, baseBranch);
    assert.ok(!fs.existsSync(checkout.path), `Expected the base worktree ${checkout.path} to have been removed when the process ended`);
  });
  assert.deepStrictEqual(remainingBaseWorktrees(), [], 'Expected no worktree of the base branch to remain, as a directory or as a git worktree');
});

Then('the baseline ran these static checks on a worktree of its own, checked out at the base branch {string}, in this order:', function (baseBranch: string, table: DataTable) {
  const [checkout] = baselineCheckouts();
  assert.ok(checkout, 'Expected the baseline to have checked the base branch out');
  assert.strictEqual(checkout.baseBranch, baseBranch);
  assert.ok(baseBranchTip().startsWith(checkout.commit), `Expected the baseline to have checked out the tip of "${baseBranch}", but it checked out ${checkout.commit}`);
  assert.ok(isBaseWorktree(checkout.path), `Expected a worktree of its own, but the baseline checked out ${checkout.path}`);

  const ran = checkRuns().filter(run => isBaseWorktree(run.cwd));
  assert.deepStrictEqual(ran.map(run => run.check), table.hashes().map(row => row.check), `Expected these static checks on the base worktree, got:\n${describeChecks(ran)}`);
  ran.forEach(run => assert.ok(run.cwd.endsWith(checkout.path.split('/').pop() ?? ''), `Expected "${run.check}" to run in ${checkout.path}, but it ran in ${run.cwd}`));
});

Then("the workflow's state records that the baseline passed on the base branch {string}", function (baseBranch: string) {
  const baseline = topLevelState()?.baseline;
  assert.ok(baseline && baseline.status === BaselineStatus.Passed, `Expected the baseline to be recorded as passed, got ${JSON.stringify(baseline)}`);
  assert.strictEqual(baseline.baseBranch, baseBranch);
  assert.ok(baseBranchTip().startsWith(baseline.baseCommit), `Expected the recorded commit ${baseline.baseCommit} to be the tip of "${baseBranch}"`);
  assert.ok(!Number.isNaN(Date.parse(baseline.recordedAt)), `Expected a time in the baseline record, got ${baseline.recordedAt}`);
});

Then("the workflow's state records a waiver of the baseline", function () {
  const baseline = topLevelState()?.baseline;
  assert.ok(baseline && baseline.status === BaselineStatus.Waived, `Expected the baseline to be recorded as waived, got ${JSON.stringify(baseline)}`);
});

Then('the baseline started the dev server on its worktree of the base branch {string}', function (baseBranch: string) {
  const [checkout] = baselineCheckouts();
  assert.ok(checkout, 'Expected the baseline to have checked the base branch out');
  assert.strictEqual(checkout.baseBranch, baseBranch);
  const started = serverEvents().filter(event => event.event === 'started' && isBaseWorktree(event.cwd));
  assert.ok(started.length > 0, `Expected the dev server to have started on the base worktree, got: ${JSON.stringify(serverEvents())}`);
});

Then('the dev server the baseline started had stopped before the plan phase ran', function () {
  const started = serverEvents().find(event => event.event === 'started' && isBaseWorktree(event.cwd));
  assert.ok(started, 'Expected the baseline to have started the dev server');
  const stopped = serverEvents().find(event => event.event === 'stopped' && event.cwd === started.cwd);
  assert.ok(stopped, `Expected the dev server started in ${started.cwd} to have stopped, got: ${JSON.stringify(serverEvents())}`);
  const [firstPlan] = planStarts();
  assert.ok(firstPlan, 'Expected a planning agent to have been started');
  assert.ok(stopped.at <= firstPlan.at, `Expected the dev server to have stopped (${stopped.at}) before the plan phase ran (${firstPlan.at})`);
});

Then('the baseline has run {int} times on a worktree of the base branch {string}', function (times: number, baseBranch: string) {
  const checkouts = baselineCheckouts();
  assert.strictEqual(checkouts.length, times, `Expected the baseline to have run ${times} times, but the execution log holds ${checkouts.length} checkout(s)`);
  checkouts.forEach(checkout => assert.strictEqual(checkout.baseBranch, baseBranch));
  const onBase = new Set(checkRuns().filter(run => isBaseWorktree(run.cwd)).map(run => run.cwd));
  assert.ok(onBase.size > 0, 'Expected the static checks to have run on a base worktree');
});

Then('the workflow ended with exit code {int}', function (exitCode: number) {
  const run = lastRun();
  assert.strictEqual(run.exitCode, exitCode, `Expected the workflow of issue ${requireWorkflowSetup().issue} to end with exit code ${exitCode}. Last output:\n${run.output.split('\n').slice(-30).join('\n')}`);
  if (s.buildFailure !== null) {
    assert.ok(run.output.includes(s.buildFailure), `Expected the run to fail with "${s.buildFailure}". Last output:\n${run.output.split('\n').slice(-30).join('\n')}`);
  }
});
