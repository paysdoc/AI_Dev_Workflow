/**
 * Step definitions for the Cucumber child runs of feature-963.feature: the regression suite's
 * surface scenarios run twice in a row, and throwaway @regression scenarios that exercise the lock
 * steps under the @regression hooks. The child runs go through cucumberChildRun.ts and by
 * feature-960's rules. The stub, worktree and agent steps are in the sibling feature-963-*.steps.ts
 * files, and the hooks in feature-963-state.ts.
 */

import { DataTable, Given, Then, When } from '@cucumber/cucumber';
import { TestStepResultStatus } from '@cucumber/messages';
import { Platform } from '@paysdoc/devplatform';
import assert from 'assert';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { getSpawnLockFilePath } from '../../../adws/triggers/spawnGate.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import {
  describeScenario,
  runCucumber,
  runCucumberWithTemp,
  verdictHolds,
  writeThrowawayFeature,
  type CucumberRun,
  type ScenarioOutcome,
} from '../../support/cucumberChildRun.ts';
import { stateOf } from './feature-963-state.ts';

const MAX_ROW_DURATION_MS = 5_000;
const SURFACE_ROWS_DIRECTORY = 'features/regression/surfaces/';

function freshDirectory(world: RegressionWorld): string {
  const directory = mkdtempSync(join(tmpdir(), 'adw-963-run-'));
  world.cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export function throwawayDirectory(world: RegressionWorld): string {
  const state = stateOf(world);
  state.throwawayDirectory ??= freshDirectory(world);
  return state.throwawayDirectory;
}

export function throwawayScenario(world: RegressionWorld): ScenarioOutcome {
  const { throwawayScenarios } = stateOf(world);
  assert.ok(throwawayScenarios, 'Expected the throwaway regression scenario to have been run first');
  return throwawayScenarios[0];
}

function assertRowPasses(run: CucumberRun, row: string, runNumber: number): void {
  const rowScenarios = run.scenarios.filter((scenario) => scenario.uri.endsWith(`${SURFACE_ROWS_DIRECTORY}${row}`));
  assert.strictEqual(rowScenarios.length, 1, `Expected exactly one scenario from ${row} in run ${runNumber}, but it ran ${rowScenarios.length}`);

  const [scenario] = rowScenarios;
  assert.ok(verdictHolds(scenario, 'passes'), `Expected ${row} to pass in run ${runNumber}, but the child Cucumber run reported:\n${describeScenario(scenario)}`);
  assert.ok(
    scenario.durationMs < MAX_ROW_DURATION_MS,
    `Expected ${row} to finish in under ${MAX_ROW_DURATION_MS} ms in run ${runNumber}, but it took ${Math.round(scenario.durationMs)} ms:\n${describeScenario(scenario)}`,
  );
}

/** A repository is a directory holding a `.git` entry, or a bare one, which holds HEAD beside objects/ and refs/. */
function isGitRepository(entries: readonly string[]): boolean {
  return entries.includes('.git') || (entries.includes('HEAD') && entries.includes('objects') && entries.includes('refs'));
}

function gitRepositoriesUnder(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  if (isGitRepository(entries.map((entry) => entry.name))) return [directory];
  return entries.filter((entry) => entry.isDirectory()).flatMap((entry) => gitRepositoriesUnder(join(directory, entry.name)));
}

When("the regression suite's surface scenarios are run through Cucumber twice in a row", function (this: RegressionWorld) {
  stateOf(this).surfaceRuns = [1, 2].map(() => runCucumberWithTemp({ directory: freshDirectory(this), tags: '@surface' }));
});

Then('each of these surface rows passes on both runs, in under 5 seconds each time:', function (this: RegressionWorld, table: DataTable) {
  const { surfaceRuns } = stateOf(this);
  assert.strictEqual(surfaceRuns.length, 2, 'Expected the surface scenarios to have been run twice first');
  for (const { row } of table.hashes()) {
    surfaceRuns.forEach((run, index) => assertRowPasses(run, row, index + 1));
  }
});

Then('the checkout holds no spawn lock for issue {int} in the repository {string}', function (issueNumber: number, repoFullName: string) {
  const [owner, repo] = repoFullName.split('/');
  const lockPath = getSpawnLockFilePath({ owner, repo, platform: Platform.GitHub }, issueNumber);
  assert.ok(!existsSync(lockPath), `Expected no spawn lock at ${lockPath}, but one is there`);
});

Then('neither run left a git repository in its temporary directory', function (this: RegressionWorld) {
  const { surfaceRuns } = stateOf(this);
  assert.strictEqual(surfaceRuns.length, 2, 'Expected the surface scenarios to have been run twice first');
  const left = surfaceRuns.flatMap((run) => gitRepositoriesUnder(run.tempDirectory));
  assert.deepStrictEqual(left, [], 'Expected neither run to leave a git repository in its temporary directory');
});

Given('a throwaway regression scenario with the steps:', function (this: RegressionWorld, steps: string) {
  stateOf(this).throwawayFeature = writeThrowawayFeature(throwawayDirectory(this), true, steps);
});

When('the throwaway regression scenario is run through Cucumber', function (this: RegressionWorld) {
  const { throwawayFeature } = stateOf(this);
  assert.ok(throwawayFeature, 'Expected a throwaway regression scenario to have been written first');
  const { tag, path } = throwawayFeature;

  const scenarios = runCucumber({ directory: throwawayDirectory(this), tags: `@${tag}`, featurePath: path });

  const ran = scenarios.map((scenario) => `${scenario.name} (${scenario.uri})`);
  assert.strictEqual(scenarios.length, 1, `Expected the child to run exactly the throwaway scenario, but it ran: ${ran.join('; ') || 'nothing'}`);
  assert.ok(scenarios[0].tags.includes(`@${tag}`), `Expected the scenario the child ran to carry @${tag}, but it ran: ${ran.join('; ')}`);
  stateOf(this).throwawayScenarios = scenarios;
});

Then('the throwaway regression scenario fails at the step {string}', function (this: RegressionWorld, stepText: string) {
  const scenario = throwawayScenario(this);
  const failedAt = scenario.steps.findIndex((step) => step.status === TestStepResultStatus.FAILED);
  assert.ok(failedAt >= 0, `Expected the throwaway scenario to fail, but the child Cucumber run reported:\n${describeScenario(scenario)}`);
  assert.strictEqual(scenario.steps[failedAt].text, stepText, `Expected the throwaway scenario to fail at "${stepText}":\n${describeScenario(scenario)}`);
  const notPassed = scenario.steps.slice(0, failedAt).filter((step) => step.status !== TestStepResultStatus.PASSED);
  assert.deepStrictEqual(notPassed.map((step) => step.text), [], `Expected every step before "${stepText}" to pass:\n${describeScenario(scenario)}`);
});

Then('the throwaway regression scenario passes', function (this: RegressionWorld) {
  const scenario = throwawayScenario(this);
  assert.ok(verdictHolds(scenario, 'passes'), `Expected the throwaway scenario to pass, but the child Cucumber run reported:\n${describeScenario(scenario)}`);
});
