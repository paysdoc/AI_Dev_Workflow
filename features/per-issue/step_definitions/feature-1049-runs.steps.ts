/**
 * The Then steps of feature-1049 about the runs of the scenario command on the worktree of the base branch, and about what the
 * gate said in the workflow's execution log. A run is read from the log of the stand-in scenario runner (feature-990), which
 * keeps the device variables, the report path and the proof directory the run was given; the stand-in "npx" of a web
 * repository keeps its own record (feature-992).
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { ADW_DIRECTORY } from '../../regression/step_definitions/feature-992-adw-files.ts';
import { commandMatches, describeCalls } from '../../regression/step_definitions/feature-992-calls.ts';
import { recordedCalls } from '../../regression/step_definitions/feature-992-standins.ts';
import { requireWorkflow } from '../../regression/step_definitions/feature-992-world.ts';
import { baseScenarioRuns, isBaseWorktree, type ScenarioRun } from '../../regression/step_definitions/feature-990-read.ts';
import { BASE_BRANCH } from '../../regression/step_definitions/feature-990-world.ts';
import { bootedDevices } from './feature-1047-phase.steps.ts';
import { assertDevicesAroundRuns } from './feature-1049-devices.steps.ts';

type Variables = readonly [avd: string, serial: string, udid: string];

function assertBaseOfTheScenario(directory: string, baseBranch: string): void {
  assert.strictEqual(directory, ADW_DIRECTORY, `The scenarios describe the repository's "${ADW_DIRECTORY}"`);
  assert.strictEqual(baseBranch, BASE_BRANCH, `The scenarios' base branch is "${BASE_BRANCH}"`);
}

function describeRuns(runs: readonly ScenarioRun[]): string {
  return runs.map(run => `${run.tag} in ${run.cwd}: ${Object.keys(run.env).join(', ') || '(no variable)'}`).join('\n') || '(none)';
}

function onlyBaseRun(): ScenarioRun {
  const runs = baseScenarioRuns();
  assert.strictEqual(runs.length, 1, `Expected the scenario command to have run once on the worktree of the base branch, but these runs were logged there:\n${describeRuns(runs)}`);
  return runs[0];
}

function assertGivenTheBootedDevices(run: ScenarioRun, [avdVariable, serialVariable, udidVariable]: Variables): void {
  const { avd, serial, udid } = bootedDevices();
  assert.deepStrictEqual(
    [run.env[avdVariable], run.env[serialVariable], run.env[udidVariable]],
    [avd, serial, udid],
    `Expected the run in ${run.cwd} to have been given the AVD, the serial and the UDID of the devices the re-run booted`,
  );
}

function assertGivenNoneOf(env: Readonly<Record<string, string>>, variables: readonly string[]): void {
  const given = variables.filter(variable => variable in env);
  assert.deepStrictEqual(given, [], `Expected the run to be given none of ${variables.join(', ')}, but it was given: ${given.join(', ')}`);
}

Then(
  "the run of the scenario command {string} configures on the worktree of the base branch {string} was given {string}, {string} and {string} holding the AVD's name, the emulator's serial and the simulator's UDID of the devices the re-run on the base branch booted",
  function (directory: string, baseBranch: string, avdVariable: string, serialVariable: string, udidVariable: string) {
    assertBaseOfTheScenario(directory, baseBranch);
    assertGivenTheBootedDevices(onlyBaseRun(), [avdVariable, serialVariable, udidVariable]);
  },
);

Then(
  "every run of the scenario command {string} configures on the worktree of the base branch {string} was given {string}, {string} and {string} holding the AVD's name, the emulator's serial and the simulator's UDID of an emulator and a simulator booted before that run and shut down and deleted after it",
  function (directory: string, baseBranch: string, avdVariable: string, serialVariable: string, udidVariable: string) {
    assertBaseOfTheScenario(directory, baseBranch);
    const runs = baseScenarioRuns();
    assert.ok(runs.length > 0, 'Expected the scenario command to have run on the worktree of the base branch');
    runs.forEach(run => assertGivenTheBootedDevices(run, [avdVariable, serialVariable, udidVariable]));
    assertDevicesAroundRuns(runs);
  },
);

Then(
  'the run of the scenario command {string} configures on the worktree of the base branch {string} was given {string} and {string}',
  function (directory: string, baseBranch: string, reportVariable: string, proofVariable: string) {
    assertBaseOfTheScenario(directory, baseBranch);
    const { env } = onlyBaseRun();
    [reportVariable, proofVariable].forEach(variable => assert.ok(env[variable], `Expected the run to have been given "${variable}", but it was given: ${Object.keys(env).join(', ')}`));
  },
);

Then(
  'the run of the scenario command {string} configures on the worktree of the base branch {string} was given none of {string}, {string} and {string}',
  function (directory: string, baseBranch: string, avdVariable: string, serialVariable: string, udidVariable: string) {
    assertBaseOfTheScenario(directory, baseBranch);
    assertGivenNoneOf(onlyBaseRun().env, [avdVariable, serialVariable, udidVariable]);
  },
);

Then(
  'the run of {string} on the worktree of the base branch {string} was given none of {string}, {string} and {string}',
  function (command: string, baseBranch: string, avdVariable: string, serialVariable: string, udidVariable: string) {
    assert.strictEqual(baseBranch, BASE_BRANCH, `The scenarios' base branch is "${BASE_BRANCH}"`);
    const runs = recordedCalls().filter(call => commandMatches(call, command) && isBaseWorktree(call.cwd));
    assert.ok(runs.length > 0, `Expected "${command}" to have run on the worktree of the base branch "${baseBranch}", but the stand-ins recorded: ${describeCalls()}`);
    runs.forEach(run => assertGivenNoneOf(run.env, [avdVariable, serialVariable, udidVariable]));
  },
);

function executionLogLines(): string[] {
  const logFile = path.join(requireWorkflow().config.orchestratorStatePath, 'execution.log');
  return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean) : [];
}

Then("the workflow's execution log says that the regression scenario {string} passes on the base branch", function (scenario: string) {
  const says = executionLogLines().some(line => line.includes(`${scenario}"`) && line.includes('passes on the base branch'));
  assert.ok(says, `Expected the execution log to say that the regression scenario "${scenario}" passes on the base branch, but it holds:\n${executionLogLines().join('\n')}`);
});
