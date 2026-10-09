/**
 * The Given and When steps of feature-990. A Given only describes the target repository, the scenarios, the agents and
 * the workflow; nothing is committed to the repository and nothing runs until the first run (`buildTarget`), except in
 * the Givens that say a workflow "has run". The Then steps are in feature-990-baseline.steps.ts,
 * feature-990-park.steps.ts and feature-990-scenarios.steps.ts; the park assertions feature-989 defines are reused.
 */

import { Given, When, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';

import { configuredChecksFrom } from '../../regression/step_definitions/feature-988-commands.ts';
import { parkCommentsOn, requireParkCommentOn } from './feature-989-comments.ts';
import { ownerComments, describeWorkflow, runWorkflow, STEP_TIMEOUT_MS } from './feature-990-run.ts';
import type { ScenarioOutcomes } from './feature-990-scripts.ts';
import { pushChecksToBaseBranch, WORKSPACE_FEATURE } from './feature-990-target.ts';
import { topLevelState } from './feature-990-read.ts';
import { BASE_BRANCH, requireWorkflowSetup, s, type ServerSetup } from './feature-990-world.ts';

const COMMANDS_FILE = '.adw/commands.md';

const OUTCOME_ON_ISSUE_BRANCH: Readonly<Record<string, ScenarioOutcomes['onIssueBranch']>> = { fails: 'fails', passes: 'passes' };
const OUTCOME_ON_BASE_BRANCH: Readonly<Record<string, ScenarioOutcomes['onBaseBranch']>> = {
  fails: 'fails',
  passes: 'passes',
  'does not exist': 'does not exist',
};

function assertBaseBranchAndFile(branch: string, file: string): void {
  assert.strictEqual(branch, BASE_BRANCH, `The scenarios' target repository has the default branch "${BASE_BRANCH}"`);
  assert.strictEqual(file, COMMANDS_FILE, `The static checks are configured in ${COMMANDS_FILE}`);
}

function declareServer(server: ServerSetup): void {
  s.server = server;
}

function outcomeOf<T>(table: Readonly<Record<string, T>>, text: string, column: string): T {
  const outcome = table[text];
  assert.ok(outcome !== undefined, `Unknown outcome "${text}" in the column "${column}"; the table may say: ${Object.keys(table).join(', ')}`);
  return outcome;
}

function toScenario(row: Record<string, string>): ScenarioOutcomes {
  return {
    name: row['scenario'] ?? '',
    feature: WORKSPACE_FEATURE,
    tag: row['tag'] ?? '',
    onIssueBranch: outcomeOf(OUTCOME_ON_ISSUE_BRANCH, row["on the issue's branch"] ?? '', "on the issue's branch"),
    onBaseBranch: outcomeOf(OUTCOME_ON_BASE_BRANCH, row['on the base branch'] ?? '', 'on the base branch'),
  };
}

Given('a target repository whose default branch {string} has a {string} that configures these static checks, in this order:', function (branch: string, file: string, table: DataTable) {
  assertBaseBranchAndFile(branch, file);
  s.checks = configuredChecksFrom(table.hashes() as { check: string; command: string }[]);
});

Given('a target repository whose default branch {string} has a {string} under which every static check passes', function (branch: string, file: string) {
  assertBaseBranchAndFile(branch, file);
  s.checks = null;
});

Given("the default branch's {string} declares no dev server", function (file: string) {
  assert.strictEqual(file, COMMANDS_FILE);
  declareServer({ kind: 'none' });
});

Given("the default branch's {string} declares a dev server that starts and answers its health check", function (file: string) {
  assert.strictEqual(file, COMMANDS_FILE);
  declareServer({ kind: 'healthy' });
});

Given(
  "the default branch's {string} declares a dev server that prints {string} to standard error and exits {int} instead of starting",
  function (file: string, standardError: string, exitCode: number) {
    assert.strictEqual(file, COMMANDS_FILE);
    assert.strictEqual(exitCode, 1, 'The dev server of this scenario exits 1');
    declareServer({ kind: 'broken', standardError });
  },
);

Given('every scenario of the target repository fails when it runs without a dev server started on its own worktree', function () {
  s.requiresServer = true;
});

Given("the target repository's scenarios have these outcomes:", function (table: DataTable) {
  s.scenarios = table.hashes().map(toScenario);
});

Given("the scenario fix agent makes every failing scenario it is handed pass on the issue's branch", function () {
  s.scenarioFixAgent = 'fixes';
});

Given('the scenario fix agent changes nothing', function () {
  s.scenarioFixAgent = 'nothing';
});

Given('a workflow of the {string} orchestrator for issue {int} in that repository', async function (orchestrator: string, issue: number) {
  await describeWorkflow(orchestrator, issue);
});

Given('the build phase of that workflow fails with the error {string}', function (error: string) {
  s.buildFailure = error;
});

Given('a commit pushed to {string} since then makes the lint print {string} and exit {int}', function (branch: string, text: string, exitCode: number) {
  assert.strictEqual(branch, BASE_BRANCH);
  const lintOnly = (s.checks ?? []).map(entry => (entry.check === 'lint' ? { check: entry.check, command: `prints "${text}" and exits ${exitCode}` } : { check: entry.check, command: entry.command === 'N/A' ? 'N/A' : entry.described }));
  pushChecksToBaseBranch(configuredChecksFrom(lintOnly));
});

Given(
  'the workflow has run and parked the issue as {string} with the {string} park comment',
  { timeout: STEP_TIMEOUT_MS },
  async function (stage: string, reason: string) {
    const { issue } = requireWorkflowSetup();
    await runWorkflow();

    const state = topLevelState();
    assert.strictEqual(state?.workflowStage, stage, `Expected the first run to park the workflow for issue ${issue} as "${stage}"`);
    assert.strictEqual(state?.parkReason, reason, `Expected the first run to park the workflow for issue ${issue} for "${reason}"`);
    assert.ok(parkCommentsOn(issue).length > 0, `Expected the first run to post a park comment on issue ${issue}`);
    requireParkCommentOn(issue);
  },
);

When('the workflow runs', { timeout: STEP_TIMEOUT_MS }, async function () {
  await runWorkflow();
});

When('the workflow runs again', { timeout: STEP_TIMEOUT_MS }, async function () {
  await runWorkflow();
});

When('the owner comments {string} on issue {int}', function (directive: string, issue: number) {
  ownerComments(directive, issue);
});
