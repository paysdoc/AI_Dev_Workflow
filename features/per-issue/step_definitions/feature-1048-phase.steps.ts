/**
 * Scenario-test-phase scenarios of feature-1048: what the real `executeScenarioTestPhase` does on a host whose devices do not
 * boot or whose device tools are not installed, and what `## Retry` and `## Continue` then do to the parked workflow. The
 * workflow, the stand-in scenario command and the phase run with feature-992's steps over the stand-in device tools that
 * feature-1048's host steps install. The park is the real one, with `process.exit` trapped: the scenario reads the state it
 * wrote and the comment it posted, as an operator would.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';

import { AgentStateManager } from '../../../adws/core/agentState.ts';

import { TrappedExit } from '../../regression/step_definitions/feature-992-exit.ts';
import { runScenarioTestPhase } from '../../regression/step_definitions/feature-992-phase.steps.ts';
import { requireWorkflow } from '../../regression/step_definitions/feature-992-world.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { assertDirectiveSays, requireParkCommentOn } from './feature-989-comments.ts';
import { attemptScenarioTestPhase } from './feature-1045-phase.steps.ts';
import { requireAttempt } from './feature-1045-world.ts';
import {
  assertBootedTimes,
  assertDeletedWhatItCreated,
  assertNoEmulatorRunning,
  assertRanOnce,
  deviceNamed,
  requireStandInHost,
} from './feature-1048-devices.ts';

const PARKED_STAGE = 'human_gated';
const PHASE_TIMEOUT_MS = 60_000;

const stateOf = (adwId: string): ReturnType<typeof AgentStateManager.readTopLevelState> => AgentStateManager.readTopLevelState(adwId);

function describeAttempt({ completed, error }: ReturnType<typeof requireAttempt>): string {
  if (completed) return 'it completed';
  return error instanceof TrappedExit ? `it ended the workflow with exit code ${error.exitCode}` : `it threw: ${String(error)}`;
}

Given("the workflow's scenario test phase has run and parked the workflow as {string}", { timeout: PHASE_TIMEOUT_MS }, async function (this: RegressionWorld, stage: string) {
  assert.strictEqual(stage, PARKED_STAGE, `The stage a park leaves is "${PARKED_STAGE}"`);
  await attemptScenarioTestPhase(this);

  const attempt = requireAttempt();
  assert.ok(attempt.error instanceof TrappedExit && attempt.error.exitCode === 0, `Expected the scenario test phase to park the workflow (exit code 0), but ${describeAttempt(attempt)}`);
  assert.strictEqual(stateOf(requireWorkflow().adwId)?.workflowStage, stage, `Expected the workflow to be parked as "${stage}"`);
});

When("the resumed workflow's scenario test phase runs", { timeout: PHASE_TIMEOUT_MS }, async function (this: RegressionWorld) {
  const { scenarioProof } = await runScenarioTestPhase(requireWorkflow());
  this.scenarioProofResult = scenarioProof;
});

Then('the workflow for issue {int} is parked for the reason {string}', function (issueNumber: number, reason: string) {
  const workflow = requireWorkflow();
  assert.strictEqual(workflow.issueNumber, issueNumber, `Expected the scenario's workflow to be the one for issue ${issueNumber}`);
  assert.strictEqual(stateOf(workflow.adwId)?.parkReason, reason, `Expected the workflow for issue ${issueNumber} to be parked for "${reason}"`);
});

Then("the workflow's state records no waiver", function () {
  const state = stateOf(requireWorkflow().adwId);
  assert.ok(state, "Expected the workflow's top-level state to exist");
  assert.strictEqual(state.baseline, undefined, `Expected the workflow's state to record no waiver, but it records: ${JSON.stringify(state.baseline)}`);
});

Then('the scenario test phase tried {int} times to boot the {word}', function (times: number, device: string) {
  assertBootedTimes(requireStandInHost().commands, deviceNamed(device), times);
});

Then('the scenario test phase ran {string} only once', function (tool: string) {
  assertRanOnce(requireStandInHost().commands, tool);
});

Then('the scenario test phase deleted every AVD and every simulator it created', function () {
  assertDeletedWhatItCreated(requireStandInHost().commands);
});

Then('no emulator the scenario test phase started is still running', function () {
  assertNoEmulatorRunning(requireStandInHost().runningEmulators());
});

Then('the park comment posted on issue {int} names the platform {string}', function (issueNumber: number, platform: string) {
  const comment = requireParkCommentOn(issueNumber);
  assert.ok(comment.includes(`\`${platform}\``), `Expected the park comment to name the platform \`${platform}\`, got:\n${comment}`);
});

Then('the park comment posted on issue {int} says that {string} re-runs the scenario phase', function (issueNumber: number, directive: string) {
  assertDirectiveSays(requireParkCommentOn(issueNumber), directive, 're-runs the scenario phase');
});

Then('the park comment posted on issue {int} says that {string} waives nothing', function (issueNumber: number, directive: string) {
  assertDirectiveSays(requireParkCommentOn(issueNumber), directive, 'waives nothing');
});
