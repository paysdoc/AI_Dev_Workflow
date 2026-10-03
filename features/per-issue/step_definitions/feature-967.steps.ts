/**
 * Step definitions for feature-967.feature: the eight smoke scenarios run twice in a row in a child
 * Cucumber process, and throwaway scenarios that show the rows' Thens cannot pass on what they were
 * not seeded with. The child runs are feature-963's helpers; the environment they take is the one
 * the feature-966 Given gives them. Every check reads what the runs left: the child runs' step
 * results, the shared files of the checkout, the process table and the call log of a stand-in gh.
 * No step reads a source file. The hooks and the per-scenario state are in feature-967-state.ts.
 */

import { Given, Then, When, type DataTable } from '@cucumber/cucumber';
import { TestStepResultStatus } from '@cucumber/messages';
import assert from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { appendToPauseQueue } from '../../../adws/core/pauseQueue.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import {
  describeScenario,
  runCucumberWithTemp,
  verdictHolds,
  writeThrowawayFeature,
  type CucumberRun,
  type ScenarioOutcome,
} from '../../support/cucumberChildRun.ts';
import { stateOf as runStateOf } from './feature-963-state.ts';
import { throwawayDirectory, throwawayScenario } from './feature-963.steps.ts';
import { stateOf as isolationOf } from './feature-966-state.ts';
import { snapshotShared, stateOf, type SmokeScenario } from './feature-967-state.ts';

const SMOKE_DIRECTORY = 'features/regression/smoke/';
const SMOKE_TAGS = '@regression and @smoke';
/** The cron probe alone may wait 60 s for its first poll, and each of the two runs holds it. */
const RUNS_TIMEOUT_MS = 15 * 60_000;

function freshDirectory(world: RegressionWorld): string {
  const directory = mkdtempSync(join(tmpdir(), 'adw-967-run-'));
  world.cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function isSmokeScenario(scenario: ScenarioOutcome, { feature, scenario: name }: SmokeScenario): boolean {
  return scenario.uri.endsWith(`${SMOKE_DIRECTORY}${feature}`) && scenario.name === name;
}

function assertPasses(run: CucumberRun, row: SmokeScenario, runNumber: number): void {
  const found = run.scenarios.filter((scenario) => isSmokeScenario(scenario, row));
  assert.strictEqual(found.length, 1, `Expected exactly one scenario "${row.scenario}" from ${row.feature} in run ${runNumber}, but it ran ${found.length}`);
  assert.ok(verdictHolds(found[0], 'passes'), `Expected "${row.scenario}" of ${row.feature} to pass in run ${runNumber}, but the child Cucumber run reported:\n${describeScenario(found[0])}`);
}

Given('ADW\'s pause queue holds a workflow paused for the repository {string}', function (repoFullName: string) {
  appendToPauseQueue({
    adwId: 'throwaway967-paused-elsewhere',
    issueNumber: 9673,
    orchestratorScript: 'adws/adwSdlc.tsx',
    pausedAtPhase: 'build',
    pauseReason: 'rate_limited',
    pausedAt: new Date().toISOString(),
    worktreePath: join(tmpdir(), 'adw-967-no-such-worktree'),
    branchName: 'feature-issue-9673-paused-elsewhere',
    extraArgs: ['--target-repo', repoFullName],
  });
});

When("the regression suite's smoke scenarios are run through Cucumber twice in a row", { timeout: RUNS_TIMEOUT_MS }, function (this: RegressionWorld) {
  const state = stateOf(this);
  state.before = snapshotShared();
  const env = isolationOf(this).childEnvironment;
  state.smokeRuns = [1, 2].map(() => runCucumberWithTemp({ directory: freshDirectory(this), tags: SMOKE_TAGS, env }));
});

Then('each of these smoke scenarios passes on both runs:', function (this: RegressionWorld, table: DataTable) {
  const state = stateOf(this);
  assert.strictEqual(state.smokeRuns.length, 2, 'Expected the smoke scenarios to have been run twice first');
  const rows = table.hashes().map(({ feature, scenario }): SmokeScenario => ({ feature, scenario }));
  rows.forEach((row) => state.smokeRuns.forEach((run, index) => assertPasses(run, row, index + 1)));
});

Then('ADW\'s auth gate, the pause queue, the cron registry and the cron logs are as they were before the runs', function (this: RegressionWorld) {
  const { before } = stateOf(this);
  assert.ok(before, 'Expected the shared files to have been snapshotted just before the first run');
  assert.deepStrictEqual(snapshotShared(), before);
});

Given('a throwaway @webhook regression scenario with the steps:', function (this: RegressionWorld, steps: string) {
  runStateOf(this).throwawayFeature = writeThrowawayFeature(throwawayDirectory(this), true, steps, ['@webhook']);
});

Then('the throwaway regression scenario fails at its last step, and every step before that one passes', function (this: RegressionWorld) {
  const { steps } = throwawayScenario(this);
  const last = steps.length - 1;
  assert.ok(last >= 0, 'Expected the throwaway scenario to hold at least one step');
  assert.strictEqual(steps[last].status, TestStepResultStatus.FAILED, `Expected the throwaway scenario to fail at its last step "${steps[last].text}":\n${describeScenario(throwawayScenario(this))}`);
  const notPassed = steps.slice(0, last).filter((step) => step.status !== TestStepResultStatus.PASSED);
  assert.deepStrictEqual(notPassed.map((step) => step.text), [], `Expected every step before "${steps[last].text}" to pass:\n${describeScenario(throwawayScenario(this))}`);
});
