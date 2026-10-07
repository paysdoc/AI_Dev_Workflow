/**
 * Given and When steps of the scenarios that run phases over a workflow (feature-994-workflow.ts): what the workflow's worktree
 * holds, what the stand-in scenario runner and the stand-in review agent do, and which real phases run. The scenario test phase,
 * the review phase and the proof publish phase are the real ones; only R2, the scenario runner and Claude are stand-ins.
 */

import { Given, When, type DataTable } from '@cucumber/cucumber';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

import { listOf, outcomeOf, reportedScenarios, taggedScenarios, writeFeatureFilesOf, assertRepositoryType } from './feature-994-scenarios.ts';
import type { TagBehaviour } from './feature-994-runner.ts';
import { createWorkflow, publishProofOnPullRequest, runScenarioTests, runScenarioTestsThenReview } from './feature-994-workflow.ts';
import { s } from './feature-994-world.ts';

const RUN_TIMEOUT_MS = 60_000;

Given(
  'a workflow for issue {int} in a {string} repository, with a recording issue tracker, code host and screenshot store',
  function (issueNumber: number, type: string) {
    createWorkflow(issueNumber, assertRepositoryType(type));
  },
);

Given(
  "the workflow's worktree holds these scenarios, which the stand-in scenario runner reports with these outcomes and attachments:",
  function (table: DataTable) {
    writeFeatureFilesOf(taggedScenarios(table));
    s.reported = reportedScenarios(table);
  },
);

Given("the workflow's {string} holds:", function (file: string, text: string) {
  s.adwFiles.set(file, `${text}\n`);
});

Given('every run of the stand-in scenario runner also leaves {string} in its proof directory, attached to no test case', function (file: string) {
  s.strays = [...s.strays, file];
});

Given("the stand-in review agent's verdict on every review is a pass", function () {
  s.verdicts = [null];
});

Given(
  "the stand-in review agent's verdict on its first review is the blocker {string}, and on every later review a pass",
  function (blocker: string) {
    s.verdicts = [blocker, null];
  },
);

function behave(tag: string, behaviour: TagBehaviour): void {
  s.overrides = { ...s.overrides, [tag]: behaviour };
}

// The issue's tag is the one no scenario carries when the repository holds none of the issue's own.
Given('the stand-in scenario runner, asked for a tag no scenario carries, exits {int} and writes a JUnit report with no test case', function (exitCode: number) {
  behave(`@adw-${s.issueNumber}`, { exitCode, stdout: '', report: 'empty' });
});

Given(
  'the stand-in scenario runner, asked for a tag no scenario carries, exits {int} with {string} and writes a JUnit report with no test case',
  function (exitCode: number, stdout: string) {
    behave(`@adw-${s.issueNumber}`, { exitCode, stdout, report: 'empty' });
  },
);

Given(
  'the stand-in scenario runner, asked for a tag no scenario carries, exits {int} with {string} and writes no JUnit report',
  function (exitCode: number, stdout: string) {
    behave(`@adw-${s.issueNumber}`, { exitCode, stdout, report: 'none' });
  },
);

Given(
  'the stand-in scenario runner, asked for the tag {string}, exits {int} without printing anything or writing a JUnit report',
  function (tag: string, exitCode: number) {
    behave(tag, { exitCode, stdout: '', report: 'none' });
  },
);

When("the stand-in scenario runner's next runs report these outcomes and attachments instead:", function (table: DataTable) {
  const changes = table.hashes();
  s.reported = s.reported.map(row => {
    const change = changes.find(candidate => candidate['scenario'] === row.scenario);
    return change ? { ...row, outcome: outcomeOf(change['outcome']), attachments: listOf(change['attachments']) } : row;
  });
});

When('the scenario test phase runs', { timeout: RUN_TIMEOUT_MS }, async function (this: RegressionWorld) {
  await runScenarioTests(this);
});

When('the scenario test phase runs and the review phase judges its proof', { timeout: RUN_TIMEOUT_MS }, async function (this: RegressionWorld) {
  await runScenarioTestsThenReview(this);
});

When('the scenario test phase runs again and the review phase judges its new proof', { timeout: RUN_TIMEOUT_MS }, async function (this: RegressionWorld) {
  await runScenarioTestsThenReview(this);
});

When('the proof is published on pull request {int}', { timeout: RUN_TIMEOUT_MS }, async function (pullRequestNumber: number) {
  await publishProofOnPullRequest(pullRequestNumber);
});
