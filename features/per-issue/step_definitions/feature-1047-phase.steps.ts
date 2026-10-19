/**
 * Scenario-test-phase scenarios of feature-1047: what the real `executeScenarioTestPhase` does with the devices of a repository
 * with platforms, and that it does nothing of the sort for a repository without. The workflow, the stand-in scenario command and
 * the phase run with feature-992's steps over the stand-in device tools that feature-1047's shared steps install; here the
 * scenario reads back the commands those tools were given, what the scenario command was given, and the workflow's execution log.
 */

import { Given, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { assertProjectMdFile } from '../../regression/step_definitions/feature-991-project-md.ts';
import { ADW_DIRECTORY, SAMPLE_DEVICE_SOURCE, setRunScenariosByTag } from '../../regression/step_definitions/feature-992-adw-files.ts';
import { commandMatches, describeCalls, runForTag } from '../../regression/step_definitions/feature-992-calls.ts';
import { reportPathFor } from '../../regression/step_definitions/feature-992-junit.ts';
import { requireAdwFiles } from '../../regression/step_definitions/feature-992-phase.steps.ts';
import { recordedCalls, standIns, toolchain, type RecordedCall } from '../../regression/step_definitions/feature-992-standins.ts';
import { requireProof, requireWorkflow } from '../../regression/step_definitions/feature-992-world.ts';
import { lastStandInDeviceHost, type StandInDeviceCommand } from '../../regression/support/standInDevices.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

import { classify, lineOf, onlyCommandOf, stepsTaken, valueAfter, type Step } from './feature-1047-commands.ts';

const SCENARIO_COMMAND = 'scenario-command';

function deviceCommands(): readonly StandInDeviceCommand[] {
  const host = lastStandInDeviceHost();
  assert.ok(host, "Expected the scenario to have replaced the host's device tools with stand-ins first");
  return host.commands;
}

/** The AVD, the emulator's serial and the simulator's UDID of the devices the phase booted, read from the commands that booted them. */
function bootedDevices(): { readonly avd: string; readonly serial: string; readonly udid: string } {
  const commands = deviceCommands();
  const emulator = commands.find(command => command.argv[0] === 'emulator');
  assert.ok(emulator, `Expected the scenario test phase to have started an emulator, but the device commands were:\n${commands.map(lineOf).join('\n')}`);
  const boot = commands.find(command => command.argv.slice(0, 3).join(' ') === 'xcrun simctl boot');
  assert.ok(boot, `Expected the scenario test phase to have booted a simulator, but the device commands were:\n${commands.map(lineOf).join('\n')}`);
  return { avd: valueAfter(emulator, '-avd'), serial: `emulator-${valueAfter(emulator, '-port')}`, udid: boot.argv[3] };
}

function scenarioCommandRuns(): RecordedCall[] {
  return recordedCalls().filter(call => commandMatches(call, SCENARIO_COMMAND));
}

function assertAdwDirectory(directory: string): void {
  assert.strictEqual(directory, ADW_DIRECTORY, `The scenarios describe the repository's "${ADW_DIRECTORY}"`);
}

Given(
  "the worktree's {string} runs scenarios by tag with a stand-in that records each run, exits 1, and writes a JUnit report in which one scenario fails",
  function (directory: string) {
    assertAdwDirectory(directory);
    setRunScenariosByTag(requireAdwFiles(), `"${standIns().scenarioCommand}" {tag}`);
    toolchain.behaviour = { ...toolchain.behaviour, failingTags: [`adw-${requireWorkflow().issueNumber}`], scenarioExitCode: 1 };
  },
);

Then("the scenario test phase was skipped, with no scenario proof", function (this: RegressionWorld) {
  assert.strictEqual(this.scenarioProofResult, undefined, 'Expected the scenario test phase to be skipped, but it left a scenario proof');
  assert.deepStrictEqual(scenarioCommandRuns().map(call => call.tag), [], `Expected no scenario to run, but the stand-ins recorded: ${describeCalls()}`);
});

Then(
  "the run of the scenario command {string} configures for the tag {string} was given {string}, {string} and {string} holding the AVD's name, the emulator's serial and the simulator's UDID of the devices the scenario test phase booted",
  function (directory: string, tag: string, avdVariable: string, serialVariable: string, udidVariable: string) {
    assertAdwDirectory(directory);
    const { avd, serial, udid } = bootedDevices();
    const { env } = runForTag(SCENARIO_COMMAND, tag);
    assert.deepStrictEqual(
      [env[avdVariable], env[serialVariable], env[udidVariable]],
      [avd, serial, udid],
      `Expected the run for "${tag}" to have been given the AVD, the serial and the UDID of the devices the phase booted`,
    );
  },
);

Then(
  "the run of the scenario command {string} configures for the tag {string} was given {string} holding the scenario proof's report path for that tag, {string} holding the scenario proof's artifacts directory, and {string} holding the workflow's application URL",
  function (this: RegressionWorld, directory: string, tag: string, reportVariable: string, proofVariable: string, urlVariable: string) {
    assertAdwDirectory(directory);
    const proof = requireProof(this);
    const { env } = runForTag(SCENARIO_COMMAND, tag);
    assert.strictEqual(env[reportVariable], reportPathFor(proof, tag), `Expected "${reportVariable}" to hold the scenario proof's report path for "${tag}"`);
    assert.strictEqual(env[proofVariable], proof.artifactsDir, `Expected "${proofVariable}" to hold the scenario proof's artifacts directory`);
    assert.strictEqual(env[urlVariable], requireWorkflow().config.applicationUrl, `Expected "${urlVariable}" to hold the workflow's application URL`);
  },
);

function assertGivenNoneOf(run: RecordedCall, variables: readonly string[]): void {
  const given = variables.filter(variable => variable in run.env);
  assert.deepStrictEqual(given, [], `Expected the run to be given none of ${variables.join(', ')}, but it was given: ${given.join(', ')}`);
}

Then(
  'the run of the scenario command {string} configures for the tag {string} was given none of {string}, {string} and {string}',
  function (directory: string, tag: string, first: string, second: string, third: string) {
    assertAdwDirectory(directory);
    assertGivenNoneOf(runForTag(SCENARIO_COMMAND, tag), [first, second, third]);
  },
);

Then('the run of {string} for the tag {string} was given none of {string}, {string} and {string}', function (command: string, tag: string, first: string, second: string, third: string) {
  assertGivenNoneOf(runForTag(command, tag), [first, second, third]);
});

Then("the scenario test phase created one AVD and one simulator, each under a name that carries the workflow's ADW ID", function () {
  const { adwId } = requireWorkflow();
  const avd = valueAfter(onlyCommandOf(deviceCommands(), 'avdmanager create avd'), '--name');
  const [simulator] = onlyCommandOf(deviceCommands(), 'xcrun simctl create').argv.slice(3);
  assert.ok(avd.includes(adwId), `Expected the name of the AVD to carry the ADW ID "${adwId}", but it is "${avd}"`);
  assert.ok(simulator.includes(adwId), `Expected the name of the simulator to carry the ADW ID "${adwId}", but it is "${simulator}"`);
});

Then(
  "the scenario test phase created the AVD from the system image and the device profile, and the simulator from the device type and the runtime, that the worktree's {string} names",
  function (file: string) {
    assertProjectMdFile(file);
    const create = onlyCommandOf(deviceCommands(), 'avdmanager create avd');
    const [, deviceType, runtime] = onlyCommandOf(deviceCommands(), 'xcrun simctl create').argv.slice(3);
    assert.deepStrictEqual(
      [valueAfter(create, '--package'), valueAfter(create, '--device'), deviceType, runtime],
      [SAMPLE_DEVICE_SOURCE.androidSystemImage, SAMPLE_DEVICE_SOURCE.androidDeviceProfile, SAMPLE_DEVICE_SOURCE.iosDeviceType, SAMPLE_DEVICE_SOURCE.iosRuntime],
      `Expected the devices to be created from what "${file}" names`,
    );
  },
);

const BEFORE_THE_RUNS: readonly Step[] = ['create', 'boot', 'wait until ready'];
const AFTER_THE_RUNS: readonly Step[] = ['shut down', 'delete'];

Then(
  "the scenario test phase created, booted and waited for the emulator and the simulator before the scenario command's first run, and shut down and deleted both after its last run",
  function () {
    const commands = deviceCommands();
    (['emulator', 'simulator'] as const).forEach(device => {
      assert.deepStrictEqual(stepsTaken(commands, device), [...BEFORE_THE_RUNS, ...AFTER_THE_RUNS], `Expected the ${device} to be created, booted, waited for, shut down and deleted`);
    });
    const runTimes = scenarioCommandRuns().map(call => call.at);
    assert.ok(runTimes.length > 0 && runTimes.every(at => at !== undefined), `Expected the scenario command to have run, and to have said when: ${describeCalls()}`);
    const firstRun = Math.min(...runTimes.map(Number));
    const lastRun = Math.max(...runTimes.map(Number));
    commands.forEach(command => {
      const { step } = classify(command);
      if (BEFORE_THE_RUNS.includes(step)) assert.ok(command.at <= firstRun, `Expected "${lineOf(command)}" to come before the first run of the scenario command`);
      if (AFTER_THE_RUNS.includes(step)) assert.ok(command.at >= lastRun, `Expected "${lineOf(command)}" to come after the last run of the scenario command`);
    });
  },
);

function executionLog(): string[] {
  const logFile = path.join(requireWorkflow().config.orchestratorStatePath, 'execution.log');
  return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean) : [];
}

function lineIndex(pattern: RegExp, description: string): number {
  const log = executionLog();
  const at = log.findIndex(line => pattern.test(line));
  assert.ok(at !== -1, `Expected the execution log to have ${description}, but it holds:\n${log.join('\n')}`);
  return at;
}

const BOOTED_IN = /booted in \d+(\.\d+)?s/;

function avdName(): string {
  return valueAfter(onlyCommandOf(deviceCommands(), 'avdmanager create avd'), '--name');
}

function simulatorName(): string {
  return onlyCommandOf(deviceCommands(), 'xcrun simctl create').argv[3];
}

const quoted = (name: string): string => `"${name}"`;

Then("the workflow's execution log has a line that gives the name of the AVD the scenario test phase created and the time the emulator took to boot", function () {
  lineIndex(new RegExp(`${quoted(avdName())}.*${BOOTED_IN.source}`), `a line that gives the name of the AVD "${avdName()}" and the time the emulator took to boot`);
});

Then("the workflow's execution log has a line that gives the name of the simulator the scenario test phase created and the time it took to boot", function () {
  lineIndex(new RegExp(`${quoted(simulatorName())}.*${BOOTED_IN.source}`), `a line that gives the name of the simulator "${simulatorName()}" and the time it took to boot`);
});

Then("the workflow's execution log says, after those lines, that the AVD and the simulator were removed, giving the name of each", function () {
  const bootedAt = Math.max(lineIndex(new RegExp(`${quoted(avdName())}.*${BOOTED_IN.source}`), 'the AVD boot line'), lineIndex(new RegExp(`${quoted(simulatorName())}.*${BOOTED_IN.source}`), 'the simulator boot line'));
  const log = executionLog();
  const removed = (pattern: RegExp): number => log.findIndex((line, index) => index > bootedAt && pattern.test(line));
  assert.ok(removed(new RegExp(`Removed .*${quoted(avdName())}`)) !== -1, `Expected the execution log to say, after the boot lines, that the AVD ${avdName()} was removed, but it holds:\n${log.join('\n')}`);
  assert.ok(removed(new RegExp(`Removed .*${quoted(simulatorName())}`)) !== -1, `Expected the execution log to say, after the boot lines, that the simulator ${simulatorName()} was removed, but it holds:\n${log.join('\n')}`);
});

/** A path that a line names says where the checkout is, not what the workflow did: the directory of this very branch is named for its devices. */
const wordsOf = (line: string): string => line.split(/\s+/).filter(token => !token.includes('/')).join(' ');

Then("the workflow's execution log mentions no emulator, AVD or simulator", function () {
  const mentions = executionLog().filter(line => /\b(emulators?|AVDs?|simulators?)\b/i.test(wordsOf(line)));
  assert.deepStrictEqual(mentions, [], 'Expected the execution log to mention no emulator, AVD or simulator');
});
