/**
 * The Then steps of feature-1049 about the devices the re-run on the base branch created, booted and removed: read back from
 * the commands the stand-in device host recorded, from when the scenario command ran on the base branch, and from what the host
 * held when the workflow was parked, since a park ends the process and the devices must be gone before it.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import { assertProjectMdFile } from '../../regression/step_definitions/feature-991-project-md.ts';
import { SAMPLE_DEVICE_SOURCE } from '../../regression/step_definitions/feature-992-adw-files.ts';
import { requireWorkflow } from '../../regression/step_definitions/feature-992-world.ts';
import type { StandInDeviceCommand } from '../../regression/support/standInDevices.ts';
import { classify, lineOf, onlyCommandOf, stepsTaken, valueAfter, type Step } from './feature-1047-commands.ts';
import {
  assertBootedTimes,
  assertDeletedWhatItCreated,
  assertNoEmulatorRunning,
  assertRanOnce,
  deviceNamed,
  requireStandInHost,
} from './feature-1048-devices.ts';
import { baseScenarioRuns, type ScenarioRun } from '../../regression/step_definitions/feature-990-read.ts';
import { requireAtPark } from './feature-1049-world.ts';

const BEFORE_THE_RUNS: readonly Step[] = ['create', 'boot', 'wait until ready'];
const AFTER_THE_RUNS: readonly Step[] = ['shut down', 'delete'];

function assertAroundTheRuns(command: StandInDeviceCommand, firstRun: number, lastRun: number): void {
  const { step } = classify(command);
  if (BEFORE_THE_RUNS.includes(step)) assert.ok(command.at <= firstRun, `Expected "${lineOf(command)}" to come before the first run of the scenario command on the base branch`);
  if (AFTER_THE_RUNS.includes(step)) assert.ok(command.at >= lastRun, `Expected "${lineOf(command)}" to come after the last run of the scenario command on the base branch`);
}

/** Both devices were created, booted and waited for before any of the runs, and shut down and deleted after all of them, once. */
export function assertDevicesAroundRuns(runs: readonly ScenarioRun[]): void {
  assert.ok(runs.length > 0, 'Expected the scenario command to have run on the worktree of the base branch');
  const { commands } = requireStandInHost();
  (['emulator', 'simulator'] as const).forEach(device => {
    assert.deepStrictEqual(stepsTaken(commands, device), [...BEFORE_THE_RUNS, ...AFTER_THE_RUNS], `Expected the ${device} to be created, booted, waited for, shut down and deleted`);
  });
  const firstRun = Math.min(...runs.map(run => run.at));
  const lastRun = Math.max(...runs.map(run => run.at));
  commands.forEach(command => assertAroundTheRuns(command, firstRun, lastRun));
}

Then(
  "the re-run on the base branch created, booted and waited for the emulator and the simulator before the scenario command's run on the worktree of the base branch, and shut down and deleted both after it",
  function () {
    assertDevicesAroundRuns(baseScenarioRuns());
  },
);

Then("the re-run on the base branch created one AVD and one simulator, each under a name that carries the workflow's ADW ID", function () {
  const { adwId } = requireWorkflow();
  const { commands } = requireStandInHost();
  const avd = valueAfter(onlyCommandOf(commands, 'avdmanager create avd'), '--name');
  const [simulator] = onlyCommandOf(commands, 'xcrun simctl create').argv.slice(3);
  assert.ok(avd.includes(adwId), `Expected the name of the AVD to carry the ADW ID "${adwId}", but it is "${avd}"`);
  assert.ok(simulator.includes(adwId), `Expected the name of the simulator to carry the ADW ID "${adwId}", but it is "${simulator}"`);
});

Then(
  "the re-run on the base branch created the AVD from the system image and the device profile, and the simulator from the device type and the runtime, that the worktree's {string} names",
  function (file: string) {
    assertProjectMdFile(file);
    const { commands } = requireStandInHost();
    const create = onlyCommandOf(commands, 'avdmanager create avd');
    const [, deviceType, runtime] = onlyCommandOf(commands, 'xcrun simctl create').argv.slice(3);
    assert.deepStrictEqual(
      [valueAfter(create, '--package'), valueAfter(create, '--device'), deviceType, runtime],
      [SAMPLE_DEVICE_SOURCE.androidSystemImage, SAMPLE_DEVICE_SOURCE.androidDeviceProfile, SAMPLE_DEVICE_SOURCE.iosDeviceType, SAMPLE_DEVICE_SOURCE.iosRuntime],
      `Expected the devices to be created from what "${file}" names`,
    );
  },
);

Then('the re-run on the base branch deleted every AVD and every simulator it created before the workflow was parked', function () {
  assertDeletedWhatItCreated(requireAtPark().commands);
});

Then('no emulator the re-run on the base branch started was still running when the workflow was parked', function () {
  assertNoEmulatorRunning(requireAtPark().running);
});

Then('the re-run on the base branch tried {int} times to boot the {word}', function (times: number, device: string) {
  assertBootedTimes(requireStandInHost().commands, deviceNamed(device), times);
});

Then('the re-run on the base branch ran {string} only once', function (tool: string) {
  assertRanOnce(requireStandInHost().commands, tool);
});
