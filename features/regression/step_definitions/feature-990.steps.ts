/**
 * The Given and When steps of feature-990 that the regression scenarios use. The Given only describes the workflow;
 * nothing is committed to the target repository and nothing runs until the run (`buildTarget`).
 */

import { Given, When } from '@cucumber/cucumber';

import { describeWorkflow, runWorkflow, STEP_TIMEOUT_MS } from './feature-990-run.ts';

Given('a workflow of the {string} orchestrator for issue {int} in that repository', async function (orchestrator: string, issue: number) {
  await describeWorkflow(orchestrator, issue);
});

When('the workflow runs', { timeout: STEP_TIMEOUT_MS }, async function () {
  await runWorkflow();
});
