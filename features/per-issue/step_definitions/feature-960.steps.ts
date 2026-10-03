/**
 * Step definitions for feature-960.feature. Every scenario writes a throwaway feature to a temp
 * directory outside the checkout, runs it through Cucumber in a child process (cucumberChildRun.ts)
 * and judges the regression step library by the step results and error messages the child reports.
 * No step function is called directly and no source file or step-definition file is read.
 */

import { After, Before, DataTable, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { REPO_ROOT } from '../../../adws/core/environment.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import {
  describeScenario,
  failureMessage,
  runCucumber,
  verdictHolds,
  writeThrowawayFeature,
  type ScenarioOutcome,
  type ThrowawayFeature,
  type Verdict,
} from '../../support/cucumberChildRun.ts';

// Never @adw-960: the flagged scenarios of features 908, 912 and 927 carry that tag and must not run these hooks.
// Feature-966 reuses this file's throwaway-feature phrases, whose scratch directory only this After hook removes.
const HOOK_TAG = '@adw-f2mx98-bug-regression-then or @adw-p5u9xh-bug-build-the-hermet';

// `agents/` also holds the state of real workflows, so only adwIds made up for this feature may be seeded or cleared.
const THROWAWAY_ADW_ID = /^throwaway960-[a-z0-9-]+$/;

const SMOKE_DIRECTORY = 'features/regression/smoke/';
const SURFACE_DIRECTORY = 'features/regression/surfaces/';
const NOT_PENDING_SHOWN = 3;

interface ScenarioState {
  /** adwIds whose `agents/<adwId>/` directory a step created or cleared. */
  adwIds: Set<string>;
  /** Holds what the scenario made outside the checkout: the throwaway feature, the run's message stream and the child's temp directory. */
  directory: string | null;
  feature: ThrowawayFeature | null;
  scenarios: readonly ScenarioOutcome[] | null;
}

function freshState(): ScenarioState {
  return { adwIds: new Set(), directory: null, feature: null, scenarios: null };
}

const state = freshState();

function resetState(): void {
  Object.assign(state, freshState());
}

function stateDirectory(adwId: string): string {
  return resolve(REPO_ROOT, 'agents', adwId);
}

function claimStateDirectory(adwId: string): string {
  assert.match(adwId, THROWAWAY_ADW_ID, `Only a throwaway adwId may be seeded or cleared under agents/, but got "${adwId}"`);
  state.adwIds.add(adwId);
  return stateDirectory(adwId);
}

function scratchDirectory(): string {
  if (!state.directory) state.directory = mkdtempSync(join(tmpdir(), 'throwaway960-'));
  return state.directory;
}

function ranScenarios(): readonly ScenarioOutcome[] {
  assert.ok(state.scenarios, 'Expected Cucumber to have been run first');
  return state.scenarios;
}

function throwawayScenario(): ScenarioOutcome {
  return ranScenarios()[0];
}

function assertFailureMessage(expectation: string, holds: (message: string) => boolean): void {
  const message = failureMessage(throwawayScenario());
  assert.ok(holds(message), `Expected the failure message to ${expectation}, but it reads:\n${message}`);
}

function assertRanScenarioFrom(scenarios: readonly ScenarioOutcome[], directory: string): void {
  assert.ok(
    scenarios.some((scenario) => scenario.uri.startsWith(directory)),
    `Expected the child to run at least one scenario from ${directory}, but it ran ${scenarios.length} scenario(s) in all`,
  );
}

Before({ tags: HOOK_TAG }, resetState);

After({ tags: HOOK_TAG }, function () {
  state.adwIds.forEach((adwId) => rmSync(stateDirectory(adwId), { recursive: true, force: true }));
  if (state.directory) rmSync(state.directory, { recursive: true, force: true });
  resetState();
});

Given(
  'the ADW checkout holds a top-level state file for adwId {string} recording workflowStage {string}',
  function (adwId: string, workflowStage: string) {
    const directory = claimStateDirectory(adwId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'state.json'), JSON.stringify({ adwId, workflowStage }), 'utf-8');
  },
);

Given('the ADW checkout holds no top-level state file for adwId {string}', function (adwId: string) {
  rmSync(claimStateDirectory(adwId), { recursive: true, force: true });
});

Given(
  /^a throwaway feature whose only scenario runs (outside|inside) the @regression hooks, with the steps:$/,
  function (placement: 'outside' | 'inside', steps: string) {
    state.feature = writeThrowawayFeature(scratchDirectory(), placement === 'inside', steps);
  },
);

// Stands in for W1 and W10 until they get real bodies, and appears only inside throwaway features.
Given('a stand-in subprocess step has recorded exit code {int}', function (this: RegressionWorld, exitCode: number) {
  this.lastExitCode = exitCode;
});

When('the throwaway feature is run through Cucumber', function () {
  assert.ok(state.feature, 'Expected a throwaway feature to have been written first');
  const { tag, path } = state.feature;
  const scenarios = runCucumber({ directory: scratchDirectory(), tags: `@${tag}`, featurePath: path });
  const ran = scenarios.map((scenario) => `${scenario.name} (${scenario.uri})`);
  assert.strictEqual(scenarios.length, 1, `Expected the child to run exactly the throwaway scenario, but it ran: ${ran.join('; ') || 'nothing'}`);
  assert.ok(scenarios[0].tags.includes(`@${tag}`), `Expected the scenario the child ran to carry @${tag}, but it ran: ${ran.join('; ')}`);
  state.scenarios = scenarios;
});

When("the regression suite's smoke and surface scenarios are run through Cucumber", function () {
  state.scenarios = runCucumber({ directory: scratchDirectory(), tags: '@smoke or @surface' });
});

Then(/^the throwaway scenario (passes|fails|is reported pending)$/, function (verdict: Verdict) {
  const scenario = throwawayScenario();
  assert.ok(
    verdictHolds(scenario, verdict),
    `Expected the throwaway scenario ${verdict}, but the child Cucumber run reported:\n${describeScenario(scenario)}`,
  );
});

Then('the failure message names the state file path {string}', function (relativePath: string) {
  assertFailureMessage(`name ${relativePath}`, (message) => message.includes(relativePath));
});

// G11 makes the worktree in a temp directory inside the child, so only the tail of its path is known, plus the adwId in its name.
Then('the failure message names the state file path inside the worktree registered for adwId {string}', function (adwId: string) {
  assertFailureMessage(`name a .adw/state.json inside the worktree registered for adwId "${adwId}"`, (message) =>
    (message.match(/[^\s,]+\/\.adw\/state\.json/g) ?? []).some((path) => path.includes(adwId)),
  );
});

Then('the failure message reports the recorded workflowStage {string}', function (workflowStage: string) {
  assertFailureMessage(`report the recorded workflowStage "${workflowStage}"`, (message) => message.includes(workflowStage));
});

function assertAllReportedPending(scenarios: readonly ScenarioOutcome[], which: string): void {
  const notPending = scenarios.filter((scenario) => !verdictHolds(scenario, 'is reported pending'));
  assert.deepStrictEqual(
    notPending.slice(0, NOT_PENDING_SHOWN).map(describeScenario),
    [],
    `Expected ${which} to be reported pending, but ${notPending.length} are not (the first ${NOT_PENDING_SHOWN} are shown)`,
  );
}

/** A row names a feature file of the surface or the smoke directory. */
function isScenarioOfRow(scenario: ScenarioOutcome, row: string): boolean {
  return [SURFACE_DIRECTORY, SMOKE_DIRECTORY].some((directory) => scenario.uri.endsWith(`${directory}${row}`));
}

/** A smoke file may hold several scenarios, such as one per case of a threshold: each must pass. */
function assertRowPasses(scenarios: readonly ScenarioOutcome[], row: string): void {
  const rowScenarios = scenarios.filter((scenario) => isScenarioOfRow(scenario, row));
  assert.ok(rowScenarios.length > 0, `Expected the child to run at least one scenario from ${row}, but it ran none`);
  const failing = rowScenarios.filter((scenario) => !verdictHolds(scenario, 'passes'));
  assert.deepStrictEqual(failing.map(describeScenario), [], `Expected every scenario of ${row} to pass, but the child Cucumber run reported otherwise`);
}

Then('every smoke and surface scenario is reported pending', function () {
  const scenarios = ranScenarios();
  [SMOKE_DIRECTORY, SURFACE_DIRECTORY].forEach((directory) => assertRanScenarioFrom(scenarios, directory));
  assertAllReportedPending(scenarios, `all ${scenarios.length} smoke and surface scenarios`);
});

Then('every smoke and surface scenario is reported pending, except these surface rows and smoke files, which pass:', function (table: DataTable) {
  const scenarios = ranScenarios();
  [SMOKE_DIRECTORY, SURFACE_DIRECTORY].forEach((directory) => assertRanScenarioFrom(scenarios, directory));

  const rows = table.hashes().map(({ row }) => row);
  rows.forEach((row) => assertRowPasses(scenarios, row));

  const parked = scenarios.filter((scenario) => !rows.some((row) => isScenarioOfRow(scenario, row)));
  assertAllReportedPending(parked, `every one of the ${parked.length} smoke and surface scenarios other than the ${rows.length} rows and files listed`);
});
