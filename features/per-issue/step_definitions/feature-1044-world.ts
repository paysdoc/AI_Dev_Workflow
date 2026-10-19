/**
 * What the feature-1044 scenarios share, and the hooks that bring up the worlds of the earlier features whose steps they reuse:
 * the framework hash (feature-537), the upgrade (feature-931), the scenario test phase (feature-992) and the baseline of a real
 * orchestrator process (feature-990). A scenario of the last kind says so in its steps ("a workflow of the ... orchestrator"),
 * and only that kind starts the subprocess harness. A hook that an earlier feature keys on its own tag does not run for these
 * scenarios, so every reset here is safe to run twice.
 */

import assert from 'assert';
import { After, Before, type ITestCaseHookParameter } from '@cucumber/cucumber';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { beginScenario, endScenario } from '../../regression/step_definitions/feature-988-world.ts';
import { disposeToolchain } from '../../regression/step_definitions/feature-992-standins.ts';
import { resetState as resetState992 } from '../../regression/step_definitions/feature-992-world.ts';
import type { GradleStandIn } from './feature-1044-gradle.ts';
import { setUpWorld990, tearDownWorld990 } from './feature-990-world.ts';

export interface State1044 {
  /** The Gradle wrapper a step put in the worktree; null until one does. */
  gradle: GradleStandIn | null;
}

function freshState(): State1044 {
  return { gradle: null };
}

export const s: State1044 = freshState();

function resetState(): void {
  Object.assign(s, freshState());
}

export function requireGradle(): GradleStandIn {
  assert.ok(s.gradle, "Expected the worktree's Gradle wrapper to have been described first");
  return s.gradle;
}

const ORCHESTRATOR_WORKFLOW = /^a workflow of the ".+" orchestrator/;

type Pickle = ITestCaseHookParameter['pickle'];

function runsAnOrchestrator(pickle: Pickle): boolean {
  return pickle.steps.some(step => ORCHESTRATOR_WORKFLOW.test(step.text));
}

Before({ tags: '@adw-1044' }, async function (this: RegressionWorld, { pickle }: ITestCaseHookParameter) {
  beginScenario();
  resetState992();
  resetState();
  if (runsAnOrchestrator(pickle)) await setUpWorld990(this);
});

After({ tags: '@adw-1044' }, async function (this: RegressionWorld, { pickle }: ITestCaseHookParameter) {
  if (runsAnOrchestrator(pickle)) await tearDownWorld990(this);
  await endScenario();
  disposeToolchain();
  resetState992();
  resetState();
});
