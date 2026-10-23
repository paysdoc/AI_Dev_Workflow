/**
 * The Then steps of feature-990 that the regression scenarios use. They read what a real orchestrator's run left
 * behind: the top-level state, the execution log, the agent starts the recorder logged and the comments the process
 * posted.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import { BaselineStatus } from '../../../adws/core/baselineGate.ts';

import { parkCommentsOn } from './feature-989-comments.ts';
import { baseBranchTip } from './feature-990-target.ts';
import { executionLog, executionLogText, planStarts, topLevelState } from './feature-990-read.ts';

const GREEN_BASELINE = /^Baseline green on /;

Then('the plan phase ran after the baseline', function () {
  const green = executionLog().filter(line => GREEN_BASELINE.test(line.message));
  assert.ok(green.length > 0, `Expected the execution log to say that the baseline was green, got:\n${executionLogText()}`);
  const [firstPlan] = planStarts();
  assert.ok(firstPlan, 'Expected a planning agent to have been started');
  assert.ok(green.some(line => line.at <= firstPlan.at), 'Expected the baseline to be green before the first planning agent started');
});

Then("the workflow's state records that the baseline passed on the base branch {string}", function (baseBranch: string) {
  const baseline = topLevelState()?.baseline;
  assert.ok(baseline && baseline.status === BaselineStatus.Passed, `Expected the baseline to be recorded as passed, got ${JSON.stringify(baseline)}`);
  assert.strictEqual(baseline.baseBranch, baseBranch);
  assert.ok(baseBranchTip().startsWith(baseline.baseCommit), `Expected the recorded commit ${baseline.baseCommit} to be the tip of "${baseBranch}"`);
  assert.ok(!Number.isNaN(Date.parse(baseline.recordedAt)), `Expected a time in the baseline record, got ${baseline.recordedAt}`);
});

Then('no park comment was posted on issue {int}', function (issueNumber: number) {
  assert.deepStrictEqual(parkCommentsOn(issueNumber), [], `Expected no park comment on issue ${issueNumber}`);
});
