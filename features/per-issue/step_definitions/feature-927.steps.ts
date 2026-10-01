/**
 * Novel step definitions for the review-gate scenarios. They call each orchestrator's exported
 * entry point with only the phases faked, so the review loop, the gate and the stop path run for
 * real. The state writer and process.exit are wrapped for the run only.
 */

import { Given, When, Before, After } from '@cucumber/cucumber';
import assert from 'assert';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { setupMockInfrastructure, teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';
import { MAX_REVIEW_RETRY_ATTEMPTS } from '../../../adws/core/config.ts';
import { runOrchestrator } from './feature-927-run.ts';
import {
  removeScenarioArtefacts,
  resetWorld,
  restoreRecorders,
  startWorkflow,
  world,
  type ReviewVerdict,
} from './feature-927-world.ts';

const EXPECTED_REVIEW_BUDGET = 3;
const PASSING: ReviewVerdict = { passed: true, blockers: 0 };

function failing(blockers: number): ReviewVerdict {
  return { passed: false, blockers };
}

// The mock context makes the shared state-file step read the real state file instead of falling
// back to inspecting source.
async function prepareScenario(cucumberWorld: RegressionWorld): Promise<void> {
  assert.strictEqual(
    MAX_REVIEW_RETRY_ATTEMPTS,
    EXPECTED_REVIEW_BUDGET,
    `These scenarios assume the default review budget of ${EXPECTED_REVIEW_BUDGET}, but MAX_REVIEW_RETRY_ATTEMPTS is ${MAX_REVIEW_RETRY_ATTEMPTS}; run them through the project's cucumber.js, which pins it`,
  );
  cucumberWorld.mockContext = await setupMockInfrastructure();
  resetWorld();
}

async function finishScenario(cucumberWorld: RegressionWorld): Promise<void> {
  restoreRecorders();
  removeScenarioArtefacts();
  await teardownMockInfrastructure();
  cucumberWorld.mockContext = null;
}

Before({ tags: '@adw-927' }, async function (this: RegressionWorld) {
  await prepareScenario(this);
});

After({ tags: '@adw-927' }, async function (this: RegressionWorld) {
  await finishScenario(this);
});

Given(
  'an {string} workflow has started for issue {int} under adwId {string} on the branch {string}',
  function (orchestrator: string, issueNumber: number, adwId: string, branchName: string) {
    startWorkflow(orchestrator, issueNumber, adwId, branchName);
  },
);

Given('issue {int} has no labels', function (issueNumber: number) {
  world.labels.set(issueNumber, []);
});

Given('issue {int} is labelled {string}', function (issueNumber: number, label: string) {
  world.labels.set(issueNumber, [label]);
});

Given('the diff judge escalates the chore into a review loop', function () {
  world.diffEscalates = true;
});

Given('the diff judge rules the chore safe', function () {
  world.diffEscalates = false;
});

Given('the review fails with {int} blocker(s) on every attempt', function (blockers: number) {
  world.reviewScript = [failing(blockers)];
});

Given('the review passes on its first attempt', function () {
  world.reviewScript = [PASSING];
});

Given(
  'the review fails with {int} blocker(s) on its first attempt and passes on its second',
  function (blockers: number) {
    world.reviewScript = [failing(blockers), PASSING];
  },
);

When('the {string} orchestrator runs its workflow', async function (orchestrator: string) {
  await runOrchestrator(orchestrator);
});
