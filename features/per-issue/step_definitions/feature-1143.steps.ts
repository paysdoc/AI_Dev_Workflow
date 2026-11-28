/**
 * The scenario of feature-1143.feature runs the real cron, with its Per-Issue Sweep due, against a cucumber-jvm repository whose
 * ".adw/" is what "adw_init" writes for "mobile:kotlincm". What the sweep did is read from the forge writes the `gh` shadow
 * recorded and from the cron's output.
 *
 * A dry run whose report the sweep could not read files no issue either, so the cron run fails unless its output shows the
 * sweep read the cucumber-jvm report: only then does it log what it decided about the removal issue.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { emptyIssueQueue, filedIssueNumber, filedIssues, labelsOf, outputTail, runCronWithSweepDue, type FiledIssue } from './feature-1142-cron.ts';
import { configureJvmTarget, declarationLineOf, defineJvmStep, useStepInRegressionSuite } from './feature-1143-target.ts';

const CRON_STEP_TIMEOUT_MS = 180_000;
const CHORE_LABEL = 'adw:chore';
const CUCUMBER_JVM_DRY_RUN = 'reading step usage from a cucumber-jvm dry run';
const REMOVAL_ISSUE_DECIDED: readonly RegExp[] = [/no unused step definitions/, /filed removal issue #\d+/, /is still open — not filing another/];

const cronOutputs = new WeakMap<RegressionWorld, string>();

function cronOutputOf(world: RegressionWorld): string {
  const output = cronOutputs.get(world);
  assert.ok(output !== undefined, 'Expected the cron to have run first');
  return output;
}

function theOneFiledIssue(world: RegressionWorld): FiledIssue {
  const filed = filedIssues(world);
  assert.strictEqual(filed.length, 1, `Expected the cron to have filed exactly one issue, but it filed ${filed.length}: ${filed.map((issue) => issue.title).join(', ') || 'none'}`);
  return filed[0];
}

Given(
  'a cucumber-jvm repository whose ".adw\\/" is what "adw_init" writes for the application type {string}, with its Step Definitions under {string}',
  function (this: RegressionWorld, applicationType: string, stepDefinitionDirectory: string) {
    configureJvmTarget(this, applicationType, stepDefinitionDirectory);
  },
);

Given(
  "the cucumber-jvm repository's Step Definition {string} in {string} is used by the Regression Suite scenario {string}",
  function (this: RegressionWorld, pattern: string, file: string, regressionFeature: string) {
    defineJvmStep(this, file, pattern);
    useStepInRegressionSuite(this, regressionFeature, pattern);
  },
);

Given("the cucumber-jvm repository's Step Definition {string} in {string} is used by no feature file", function (this: RegressionWorld, pattern: string, file: string) {
  defineJvmStep(this, file, pattern);
});

When('the cron runs against the cucumber-jvm repository with its Per-Issue Sweep due', { timeout: CRON_STEP_TIMEOUT_MS }, async function (this: RegressionWorld) {
  await emptyIssueQueue(this);
  const output = await runCronWithSweepDue(this);
  cronOutputs.set(this, output);
  assert.ok(
    output.includes(CUCUMBER_JVM_DRY_RUN) && REMOVAL_ISSUE_DECIDED.some((line) => line.test(output)),
    `Expected the sweep to have read the unused report of its cucumber-jvm dry run and decided about the removal issue. Last output:\n${outputTail(output)}`,
  );
});

Then('the cron filed exactly one chore issue in the cucumber-jvm repository', function (this: RegressionWorld) {
  theOneFiledIssue(this);
  const issueNumber = filedIssueNumber([cronOutputOf(this)]);
  assert.ok(labelsOf(this, issueNumber).includes(CHORE_LABEL), `Expected issue #${issueNumber} to be labelled ${CHORE_LABEL}, but its labels are: ${labelsOf(this, issueNumber).join(', ') || 'none'}`);
});

Then('that chore issue lists the Step Definition {string} in {string}', function (this: RegressionWorld, pattern: string, file: string) {
  const { body } = theOneFiledIssue(this);
  const location = `\`${file}:${declarationLineOf(this, file, pattern)}\``;
  const listing = body.split('\n').filter((line) => line.includes(location) && line.includes(`\`${pattern}\``));
  assert.strictEqual(listing.length, 1, `Expected the chore issue to list "${pattern}" at ${location} once, but its body is:\n${body}`);
});

Then('that chore issue does not list the Step Definition {string}', function (this: RegressionWorld, pattern: string) {
  const { body } = theOneFiledIssue(this);
  const listing = body.split('\n').filter((line) => line.includes(`\`${pattern}\``));
  assert.deepStrictEqual(listing, [], `Expected the chore issue not to list "${pattern}", but its body is:\n${body}`);
});
