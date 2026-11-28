/**
 * The scenarios of feature-1142.feature run the real cron, with its Per-Issue Sweep due, against a target repository whose
 * scenario configuration names where its Per-Issue Scenarios and step definitions live. What the sweep did is read from the
 * forge writes the `gh` shadow recorded, the target repository's default branch and the cron's output.
 *
 * A cucumber-js dry run that wrote no report files no issue either, so in a cucumber-js target a cron run fails unless its
 * output shows the sweep read the report: only then does it log what it decided about the removal issue.
 */

import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import {
  cronOutputsOf,
  emptyIssueQueue,
  filedIssueNumber,
  filedIssues,
  isOnDefaultBranch,
  keepIssueOpen,
  labelsOf,
  mergedSweepPullRequests,
  outputTail,
  remoteFollowsDefaultBranch,
  runCronWithSweepDue,
  seedMergedPullRequest,
  subjectOfCommitDeleting,
} from './feature-1142-cron.ts';
import {
  CUCUMBER_JS,
  addPerIssueScenario,
  configureTarget,
  defineStep,
  perIssueFeatureOf,
  requireTarget,
  shareStepsWithRegressionSuite,
  useStep,
} from './feature-1142-target.ts';

const CRON_STEP_TIMEOUT_MS = 180_000;
const CHORE_LABEL = 'adw:chore';
/** The step a step definition file named for an issue registers on its third line. */
const ISSUE_STEP_LINE = 3;
const USAGE_REPORT_READ: readonly RegExp[] = [/no unused step definitions/, /filed removal issue #\d+/, /is still open — not filing another/];

async function runCron(world: RegressionWorld): Promise<void> {
  const output = await runCronWithSweepDue(world);
  if (requireTarget(world).framework !== CUCUMBER_JS) return;
  assert.ok(
    USAGE_REPORT_READ.some((line) => line.test(output)),
    `Expected the sweep to have read the usage report of its cucumber-js dry run and decided about the removal issue. Last output:\n${outputTail(output)}`,
  );
}

function theOneFiledIssue(world: RegressionWorld) {
  const filed = filedIssues(world);
  assert.strictEqual(filed.length, 1, `Expected the cron to have filed exactly one issue, but it filed ${filed.length}: ${filed.map((issue) => issue.title).join(', ') || 'none'}`);
  return filed[0];
}

Given(
  "the target repository's scenario configuration names the BDD framework {string}, the per-issue scenario directory {string} and the step definition directory {string}",
  function (this: RegressionWorld, framework: string, perIssueDirectory: string, stepDefinitionDirectory: string) {
    configureTarget(this, framework, perIssueDirectory, stepDefinitionDirectory);
  },
);

Given(
  'the target repository holds the Per-Issue Scenario {string} of issue {int}, whose pull request merged {int} days ago',
  async function (this: RegressionWorld, featurePath: string, issue: number, daysAgo: number) {
    addPerIssueScenario(this, featurePath, issue);
    await seedMergedPullRequest(this, issue, daysAgo);
  },
);

Given(
  'the target repository holds the step definition file {string}, which only the Per-Issue Scenario of issue {int} uses',
  function (this: RegressionWorld, file: string, issue: number) {
    const pattern = `the scenario of issue ${issue} has started`;
    defineStep(this, file, ISSUE_STEP_LINE, pattern);
    useStep(this, perIssueFeatureOf(this, issue), pattern);
  },
);

Given(
  'the Step Definition {string} on line {int} of {string} is used by no feature file but the Per-Issue Scenario of issue {int}',
  function (this: RegressionWorld, pattern: string, line: number, file: string, issue: number) {
    defineStep(this, file, line, pattern);
    useStep(this, perIssueFeatureOf(this, issue), pattern);
  },
);

Given(
  'the Step Definition {string} in {string} is used by no feature file but the Per-Issue Scenario of issue {int}',
  function (this: RegressionWorld, pattern: string, file: string, issue: number) {
    defineStep(this, file, null, pattern);
    useStep(this, perIssueFeatureOf(this, issue), pattern);
  },
);

Given(
  'every Step Definition in {string}, including each one the Per-Issue Scenario of issue {int} uses, is also used by the Regression Suite scenario {string}',
  function (this: RegressionWorld, directory: string, issue: number, regressionFeature: string) {
    shareStepsWithRegressionSuite(this, directory, issue, regressionFeature);
  },
);

When('the cron runs with its Per-Issue Sweep due', { timeout: CRON_STEP_TIMEOUT_MS }, async function (this: RegressionWorld) {
  await emptyIssueQueue(this);
  await runCron(this);
});

When(
  'the cron runs again with its Per-Issue Sweep due, while the chore issue its first run filed is still open',
  { timeout: CRON_STEP_TIMEOUT_MS },
  async function (this: RegressionWorld) {
    const filed = theOneFiledIssue(this);
    const issueNumber = filedIssueNumber(cronOutputsOf(this));
    await keepIssueOpen(this, issueNumber, filed);
    await runCron(this);

    const stillOpen = `removal issue #${issueNumber} is still open — not filing another`;
    assert.ok(this.lastOutput.includes(stillOpen), `Expected the sweep to find unused step definitions again and leave them to the open issue #${issueNumber}. Last output:\n${outputTail(this.lastOutput)}`);
  },
);

Then("the sweep's merged pull request removed {string} from the target repository's default branch", function (this: RegressionWorld, path: string) {
  const merged = mergedSweepPullRequests(this);
  assert.ok(merged.length > 0, `Expected the sweep to have opened and merged a pull request from its sweep branch. Last output:\n${outputTail(this.lastOutput)}`);
  assert.strictEqual(isOnDefaultBranch(this, path), false, `Expected ${path} to be gone from the target repository's default branch`);
  assert.match(subjectOfCommitDeleting(this, path), /^chore: sweep /, `Expected the sweep's commit, merged through pull request #${merged.join(', #')}, to have removed ${path}`);
  assert.ok(remoteFollowsDefaultBranch(this), "Expected the merge to have reached the target repository's origin/main");
});

Then('the cron filed exactly one chore issue in the target repository', function (this: RegressionWorld) {
  theOneFiledIssue(this);
  const issueNumber = filedIssueNumber(cronOutputsOf(this));
  assert.ok(labelsOf(this, issueNumber).includes(CHORE_LABEL), `Expected issue #${issueNumber} to be labelled ${CHORE_LABEL}, but its labels are: ${labelsOf(this, issueNumber).join(', ') || 'none'}`);
});

Then('that chore issue lists the Step Definition {string} at line {int} of {string}', function (this: RegressionWorld, pattern: string, line: number, file: string) {
  const { body } = theOneFiledIssue(this);
  const listing = body.split('\n').filter((bodyLine) => bodyLine.includes(`\`${file}:${line}\``) && bodyLine.includes(`\`${pattern}\``));
  assert.strictEqual(listing.length, 1, `Expected the chore issue to list "${pattern}" at ${file}:${line} once, but its body is:\n${body}`);
});

Then('the cron filed no issue in the target repository', function (this: RegressionWorld) {
  const filed = filedIssues(this);
  assert.deepStrictEqual(filed.map((issue) => issue.title), [], `Expected the cron to file no issue, but it filed: ${filed.map((issue) => issue.title).join(', ')}`);
});

Then('the cron logged that finding unused Step Definitions is not supported for the BDD framework {string}', function (this: RegressionWorld, framework: string) {
  const line = `finding unused step definitions is not supported for BDD framework "${framework}"`;
  assert.ok(cronOutputsOf(this).some((output) => output.includes(line)), `Expected the cron to log "${line}". Last output:\n${outputTail(this.lastOutput)}`);
});
