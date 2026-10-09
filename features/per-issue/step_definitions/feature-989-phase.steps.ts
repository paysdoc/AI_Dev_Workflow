/**
 * Phase scenarios of feature-989, and the two feature-988 scenarios that are tagged for it too. Each runs the
 * real `executeUnitTestPhase` over a throwaway git worktree, with the real static-check gate, loop, guard,
 * fix-round port and park handler, the real shell for the checks, and the throwaway CLI for the test agent.
 * Only the fix agent's own run is scripted (see feature-989-fix-agent.ts). Shared steps of feature-988
 * (the workflow, the JUnit report, "the unit-test phase completed", the log and error-comment assertions)
 * are not defined again here.
 */

import { Given, When, Then, Before, After, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { MAX_TEST_RETRY_ATTEMPTS } from '../../../adws/core/config.ts';
import { handleRetryDirective, type RetryHandlerDeps } from '../../../adws/triggers/retryHandler.ts';

import { emptyBehaviour } from '../../regression/step_definitions/feature-929-compacting-cli.ts';
import { commentsOn, commitFile } from '../../regression/step_definitions/feature-929-workflow.ts';
import { describeEnd, requirePhase, requireWorkflow, runWorkflowUnitTestPhase, startedAgents } from './feature-988-phase.steps.ts';
import { beginScenario, endScenario, s } from '../../regression/step_definitions/feature-988-world.ts';
import { assertDirectiveSays, parkCommentsOn, requireParkCommentOn } from './feature-989-comments.ts';
import { fixAgentStarts, outputHandedFor, scriptFixAgent } from './feature-989-fix-agent.ts';
import { linesOfWorktreeFile, prepareBranchAndOrigin } from './feature-989-git.ts';

const TEST_AGENT_COMMAND = '/test';
const RETRY_DIRECTIVE = '## Retry';
const PARKED_STAGE = 'human_gated';
const RE_ARMED_STAGE = 'phase_timeout';

Before({ tags: '@adw-989' }, beginScenario);
After({ tags: '@adw-989' }, endScenario);

function testAgentRuns(): number {
  return startedAgents().filter(command => command === TEST_AGENT_COMMAND).length;
}

function topLevelStage(adwId: string): string | undefined {
  return AgentStateManager.readTopLevelState(adwId)?.workflowStage;
}

function assertParked(): void {
  const phase = requirePhase();
  assert.ok(!phase.completed && phase.exitCode === 0, `Expected the unit-test phase to stop the workflow as a park (exit code 0), but ${describeEnd(phase)}`);
  const { adwId } = requireWorkflow();
  assert.strictEqual(topLevelStage(adwId), PARKED_STAGE, `Expected the workflow to be parked as "${PARKED_STAGE}"`);
}

/** Recording dependencies for a `## Retry`: state is the real top-level state, and nothing else a retry could touch is real. */
function retryDeps(): RetryHandlerDeps {
  return {
    readTopLevelState: adwId => AgentStateManager.readTopLevelState(adwId),
    writeTopLevelState: (adwId, state) => AgentStateManager.writeTopLevelState(adwId, state),
    findPauseQueueEntry: () => null,
    removeFromPauseQueue: () => undefined,
    acquireIssueSpawnLock: () => true,
    releaseIssueSpawnLock: () => undefined,
    spawnDetached: () => assert.fail('A "## Retry" on a parked workflow spawns nothing: the orchestrator resumes through the re-armed stage'),
    postStageComment: () => undefined,
    targetRepoArgs: [],
  };
}

Given("the worktree's {string} names the test framework {string} and the BDD framework {string}", function (directory: string, testFramework: string, bddFramework: string) {
  assert.strictEqual(directory, '.adw/', 'The stack descriptors live in ".adw/"');
  const { worktreePath } = requireWorkflow();
  fs.appendFileSync(path.join(worktreePath, '.adw/commands.md'), `\n## Test Framework\n\n${testFramework}\n`);
  fs.writeFileSync(path.join(worktreePath, '.adw/scenarios.md'), `# Scenarios\n\n## BDD Framework\n\n${bddFramework}\n`);
});

Given("the build phase has committed a change to {string} on the workflow's branch", function (file: string) {
  const workflow = requireWorkflow();
  prepareBranchAndOrigin(workflow);
  commitFile(workflow.worktreePath, file, '{ "compilerOptions": { "strict": true } }\n');
});

Given("the static-check fix agent's rounds go as follows:", function (table: DataTable) {
  scriptFixAgent(requireWorkflow(), table);
});

Given("the static-check fix agent's rounds change nothing", function () {
  scriptFixAgent(requireWorkflow(), null);
});

Given('the test agent writes a JUnit report in which a unit test fails on every run', function () {
  // More runs than the cap allows, so that no run the loop could make is the one that passes.
  const everyRun = Array.from({ length: MAX_TEST_RETRY_ATTEMPTS + 2 }, (_, index) => index + 1);
  s.behaviour = { ...emptyBehaviour(), junitReportPath: path.join(requireWorkflow().logsDir, 'junit-unit.xml'), failingTestRuns: everyRun };
});

Given("the workflow's unit-test phase has run and parked the workflow as {string}", async function (stage: string) {
  assert.strictEqual(stage, PARKED_STAGE, `The stage a park leaves is "${PARKED_STAGE}"`);
  await runWorkflowUnitTestPhase();
  assertParked();
});

When('{string} is posted on issue {int}', function (directive: string, issueNumber: number) {
  assert.strictEqual(directive, RETRY_DIRECTIVE, 'The only directive this feature posts is "## Retry"');
  const { adwId } = requireWorkflow();
  const comments = [...commentsOn(issueNumber), directive].map(body => ({ body }));

  assert.ok(handleRetryDirective(issueNumber, comments, retryDeps()), `Expected "${RETRY_DIRECTIVE}" to act on the parked workflow`);
  assert.strictEqual(topLevelStage(adwId), RE_ARMED_STAGE, `Expected "${RETRY_DIRECTIVE}" to re-arm the workflow to "${RE_ARMED_STAGE}"`);
});

When("the resumed workflow's unit-test phase runs", runWorkflowUnitTestPhase);

Then('the static-check fix agent was started {int} time(s)', function (times: number) {
  assert.strictEqual(fixAgentStarts().length, times, `Expected the static-check fix agent to have been started ${times} time(s)`);
});

Then("the static-check fix agent's round {int} was handed the failing check {string} with the output {string}", function (round: number, check: string, output: string) {
  const start = fixAgentStarts()[round - 1];
  assert.ok(start, `Expected the static-check fix agent to have been started at least ${round} time(s), but it was started ${fixAgentStarts().length} time(s)`);
  assert.strictEqual(start.input.passed, false, 'Expected the fix agent to be handed a failing check');
  assert.strictEqual(outputHandedFor(start.input, check), output, `Expected round ${round} to be handed the output of "${check}"`);
});

Then('the test agent was not started', function () {
  assert.strictEqual(testAgentRuns(), 0, 'Expected the test agent not to have been started');
});

Then('the test agent was started once, after the last static-check fix round', function () {
  const starts = fixAgentStarts();
  assert.ok(starts.length > 0, 'Expected the static-check fix agent to have been started');
  starts.forEach((start, index) => {
    assert.ok(!start.cliRuns.includes(TEST_AGENT_COMMAND), `Expected the test agent not to have started before fix round ${index + 1}, but it had`);
  });
  assert.strictEqual(testAgentRuns(), 1, 'Expected the test agent to have been started once');
});

Then("the test agent was started as many times as the unit-test fix loop's cap allows", function () {
  assert.strictEqual(testAgentRuns(), MAX_TEST_RETRY_ATTEMPTS, `Expected the test agent to be started ${MAX_TEST_RETRY_ATTEMPTS} times, once per attempt the cap allows`);
});

Then('the unit-test phase did not complete', function () {
  const phase = requirePhase();
  assert.ok(!phase.completed, `Expected the unit-test phase not to complete, but ${describeEnd(phase)}`);
  assert.strictEqual(phase.exitCode, 0, `Expected the phase to stop the workflow deliberately (exit code 0), but ${describeEnd(phase)}`);
});

Then('the workflow for issue {int} is parked as {string}', function (issueNumber: number, stage: string) {
  const workflow = requireWorkflow();
  assert.strictEqual(workflow.issueNumber, issueNumber, `Expected the scenario's workflow to be the one for issue ${issueNumber}`);
  assert.strictEqual(topLevelStage(workflow.adwId), stage, `Expected the workflow for issue ${issueNumber} to be parked as "${stage}"`);
});

Then('the park comment posted on issue {int} names the failing check {string}', function (issueNumber: number, check: string) {
  const comment = requireParkCommentOn(issueNumber);
  assert.ok(comment.includes(`\`${check}\``), `Expected the park comment to name the failing check "${check}", got:\n${comment}`);
});

Then('the park comment posted on issue {int} says that {string} continues the static-check fix loop', function (issueNumber: number, directive: string) {
  assertDirectiveSays(requireParkCommentOn(issueNumber), directive, 'continues the static-check fix loop');
});

Then('the park comment posted on issue {int} says that the fix-round guard rejected a change to {string}', function (issueNumber: number, file: string) {
  const comment = requireParkCommentOn(issueNumber);
  assert.ok(comment.includes('fix-round guard rejected'), `Expected the park comment to say that the fix-round guard rejected the round, got:\n${comment}`);
  const reasonLines = comment.split('\n').filter(line => line.startsWith('- '));
  assert.ok(reasonLines.some(line => line.includes(`\`${file}\``)), `Expected a reason that names "${file}", got:\n${reasonLines.join('\n')}`);
});

Then('no park comment was posted on issue {int}', function (issueNumber: number) {
  assert.deepStrictEqual(parkCommentsOn(issueNumber), [], `Expected no park comment on issue ${issueNumber}`);
});

Then("the file {string} in the workflow's worktree does not hold the line {string}", function (file: string, line: string) {
  const lines = linesOfWorktreeFile(requireWorkflow().worktreePath, file);
  assert.ok(!lines.includes(line), `Expected "${file}" not to hold the line "${line}", but it holds:\n${lines.join('\n')}`);
});
