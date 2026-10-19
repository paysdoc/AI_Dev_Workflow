/**
 * Device lifecycle scenarios of feature-1048: the scenario drives the real `withDevices` with a callback of its own over a
 * recording executor that answers like a host whose devices do not boot (see feature-1048-host.steps.ts), and reads what the
 * lifecycle came back with, and which commands it issued to get there. No scenario reaches a real SDK.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import type { DeviceFailure } from '../../../adws/core/deviceLifecycle.ts';

import {
  assertBootedTimes,
  assertCallbackRanAfterBoot,
  assertDeletedWhatItCreated,
  assertEachEmulatorStoppedBeforeTheNext,
  assertNoEmulatorRunning,
  deviceNamed,
} from './feature-1048-devices.ts';
import { recordedCommands, requireExecutor, requireRun, s } from './feature-1047-world.ts';

const isDeviceFailure = (value: unknown): value is DeviceFailure =>
  typeof value === 'object' && value !== null && 'kind' in value && (value.kind === 'boot_failed' || value.kind === 'tool_missing');

function failedOutcome(): DeviceFailure {
  const { failure } = requireRun();
  assert.ok(isDeviceFailure(failure), `Expected the device lifecycle to come back with a device that did not come up, but it ${failure === undefined ? 'came back ready' : `failed with: ${String(failure)}`}`);
  return failure;
}

function failedBoot(): Extract<DeviceFailure, { kind: 'boot_failed' }> {
  const outcome = failedOutcome();
  assert.strictEqual(outcome.kind, 'boot_failed', `Expected a failed boot, but the device lifecycle came back with the host tool "${outcome.kind === 'tool_missing' ? outcome.tool : ''}" missing`);
  return outcome;
}

Then('the device lifecycle came back with a failed boot of the platform {string} after {int} attempts', function (platform: string, attempts: number) {
  const { kind, platform: failedPlatform, attempts: failedAttempts } = failedBoot();
  assert.deepStrictEqual({ kind, platform: failedPlatform, attempts: failedAttempts }, { kind: 'boot_failed', platform, attempts });
});

Then('the output of that failed boot holds {string}', function (printed: string) {
  const { output } = failedBoot();
  assert.ok(output.includes(printed), `Expected the output of the failed boot to hold "${printed}", but it is:\n${output}`);
});

Then('the output of that failed boot holds what each of the {int} attempts printed, in the order of the attempts', function (attempts: number) {
  const prints = s.executorOptions?.simulatorBootOutputs ?? [];
  assert.strictEqual(prints.length, attempts, `Expected the scenario to say what each of the ${attempts} attempts printed`);
  const { output } = failedBoot();
  const positions = prints.map(printed => output.indexOf(printed));
  assert.ok(positions.every(position => position !== -1), `Expected the output of the failed boot to hold what each attempt printed, but it is:\n${output}`);
  assert.deepStrictEqual(positions, [...positions].sort((first, second) => first - second), `Expected what the attempts printed to come in the order of the attempts, but the output is:\n${output}`);
});

Then('the device lifecycle came back with the host tool {string} missing', function (tool: string) {
  const outcome = failedOutcome();
  assert.deepStrictEqual({ kind: outcome.kind, tool: outcome.kind === 'tool_missing' ? outcome.tool : undefined }, { kind: 'tool_missing', tool });
});

Then('the device lifecycle tried {int} times to boot the {word}', function (times: number, device: string) {
  assertBootedTimes(recordedCommands(), deviceNamed(device), times);
});

Then('the callback ran only after the third boot of the {word}', function (device: string) {
  assertCallbackRanAfterBoot(recordedCommands(), deviceNamed(device), 3);
});

Then('the callback did not run', function () {
  assert.deepStrictEqual(requireRun().given, [], 'Expected the callback not to have been called');
});

Then('the device lifecycle deleted every AVD and every simulator it created', function () {
  assertDeletedWhatItCreated(recordedCommands());
});

Then('no emulator the device lifecycle started is still running', function () {
  assertNoEmulatorRunning(requireExecutor().runningEmulators());
});

Then('the device lifecycle stopped each emulator that had not finished booting before it started the next one', function () {
  assertEachEmulatorStoppedBeforeTheNext(recordedCommands());
});
