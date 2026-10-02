/**
 * Scenarios of feature-962.feature, the Given, When and After steps. The regression workflow is
 * RUN, the way a GitHub runner runs it, each job in a throwaway checkout of its own, against a
 * stand-in `docker` on PATH. NEVER THE REAL DOCKER, NEVER THE REAL SUITE, and nothing is ever
 * installed: every checkout holds a narrowed suite of one scenario (feature-962-suite.ts). No step
 * reads the workflow, `test/Dockerfile` or `test/docker-run.sh` for an assertion: the Then steps
 * (feature-962-then.steps.ts, feature-962-mounts.steps.ts) check only what a run produced.
 */

import { After, Given, When } from '@cucumber/cucumber';

import './feature-962-parameters.ts';
import type { StepStatus } from './feature-962-suite.ts';
import { runRegressionWorkflow } from './feature-962-run.ts';
import type { RegressionEvent } from './feature-962-event.ts';
import { createJobSandbox, createRunRoot } from './feature-962-sandbox.ts';
import { runSuite } from './feature-962-suiteRun.ts';
import { endScenario, removeAfterScenario, scenario, update } from './feature-962-world.ts';

const REPO_ROOT = process.cwd();
/** The runner kills a workflow step after 60 seconds, so a hung step fails the run long before this. */
const WORKFLOW_RUN_TIMEOUT_MS = 10 * 60_000;
/** The suite run is killed after four minutes, which is before the scenario would time out. */
const SUITE_RUN_KILL_MS = 4 * 60_000;
const SUITE_RUN_TIMEOUT_MS = 5 * 60_000;

After({ tags: '@adw-962' }, function () {
  endScenario();
});

async function runWorkflowFor(event: RegressionEvent): Promise<void> {
  const runRoot = createRunRoot();
  removeAfterScenario(runRoot);
  const { suite, dockerExitStatus } = scenario();
  update({ run: await runRegressionWorkflow({ repoRoot: REPO_ROOT, runRoot, event, suite, dockerExitStatus }) });
}

async function runSuiteInCheckout(): Promise<void> {
  const runRoot = createRunRoot();
  removeAfterScenario(runRoot);
  const { suite, dockerExitStatus } = scenario();
  const sandbox = createJobSandbox({
    repoRoot: REPO_ROOT, runRoot, name: 'suite', eventName: 'workflow_dispatch', suite, dockerExitStatus, linkModules: true,
  });
  update({ suiteRun: await runSuite(sandbox, SUITE_RUN_KILL_MS) });
}

Given('the @regression suite in the checkout is a single scenario whose step is {suiteStepStatus}', function (status: StepStatus) {
  update({ suite: status });
});

Given('the @regression suite in the checkout is a single scenario that runs the ADW TypeScript type-check', function () {
  update({ suite: 'type-check' });
});

Given('the suite run inside the Docker container exits with status {int}', function (status: number) {
  update({ dockerExitStatus: status });
});

When('the regression workflow runs on its daily schedule', { timeout: WORKFLOW_RUN_TIMEOUT_MS }, async function () {
  await runWorkflowFor({ name: 'schedule' });
});

When('the regression workflow is run manually with the runtime {string}', { timeout: WORKFLOW_RUN_TIMEOUT_MS }, async function (runtime: string) {
  await runWorkflowFor({ name: 'workflow_dispatch', inputs: { runtime } });
});

When('the @regression suite runs in the checkout', { timeout: SUITE_RUN_TIMEOUT_MS }, runSuiteInCheckout);
