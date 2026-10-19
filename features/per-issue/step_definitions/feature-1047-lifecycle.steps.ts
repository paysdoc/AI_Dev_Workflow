/**
 * Device lifecycle scenarios of feature-1047: the scenario drives the real `withDevices` with a callback of its own over a
 * recording executor that answers like a host on which the emulator and the simulator boot, and reads back the commands the
 * lifecycle issued and what the callback was given. The executor is a stand-in: no scenario reaches a real SDK.
 */

import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';

import { withDevices, type DeviceEnvironment } from '../../../adws/core/deviceLifecycle.ts';
import type { DeviceSource } from '../../../adws/core/deviceSourceConfig.ts';

import { CALLBACK, STEPS, commandsOf, emulatorStartedFor, lineOf, onlyCommandOf, stepsTaken, valueAfter, type Device } from './feature-1047-commands.ts';
import { valuesOf } from './feature-1045-sections.ts';
import { recordedCommands, requireDeviceSource, requireExecutor, requireRun, s } from './feature-1047-world.ts';

const RETURNED = { returnedByTheCallback: true };
const EMULATOR_SERIAL_PREFIX = 'emulator-';
const VARIABLES: readonly (keyof DeviceEnvironment)[] = ['ADW_ANDROID_AVD', 'ADW_ANDROID_SERIAL', 'ADW_IOS_UDID'];

function variableNamed(name: string): keyof DeviceEnvironment {
  const variable = VARIABLES.find(candidate => candidate === name);
  assert.ok(variable, `Expected one of ${VARIABLES.join(', ')}, but the scenario names "${name}"`);
  return variable;
}

function completeSource(table: DataTable): DeviceSource {
  const { androidSystemImage, androidDeviceProfile, iosDeviceType, iosRuntime } = valuesOf(table);
  assert.ok(androidSystemImage && androidDeviceProfile && iosDeviceType && iosRuntime, 'Expected the table to name all four device sources');
  return { androidSystemImage, androidDeviceProfile, iosDeviceType, iosRuntime };
}

async function runLifecycle(adwId: string, work: (devices: DeviceEnvironment) => Promise<unknown>, thrown?: Error): Promise<void> {
  const { executor, commands } = requireExecutor();
  const given: DeviceEnvironment[] = [];
  const callback = async (devices: DeviceEnvironment): Promise<unknown> => {
    commands.push({ argv: [CALLBACK], at: Date.now() });
    given.push(devices);
    return work(devices);
  };
  const request = { adwId, deviceSource: requireDeviceSource(), emulatorOutputPath: '/logs/android-emulator.log', record: () => undefined };
  const deps = { executor, clock: { now: () => new Date(), sleep: async () => undefined }, isPortAvailable: async () => true };
  try {
    s.runs.push({ adwId, given, returned: await withDevices(request, callback, deps), failure: undefined, thrown });
  } catch (failure) {
    s.runs.push({ adwId, given, returned: undefined, failure, thrown });
  }
}

Given('these device sources:', function (table: DataTable) {
  s.deviceSource = completeSource(table);
});

Given('a recording executor that answers every device command as a host on which the emulator and the simulator boot', function () {
  s.executorOptions = {};
});

Given('the recording executor answers the creation of the simulator with the UDID {string}', function (udid: string) {
  s.executorOptions = { ...s.executorOptions, udid };
});

Given(
  "the recording executor answers the emulator's property {string} with {string} on the first {int} reads, and with {string} after them",
  function (property: string, empty: string, reads: number, ready: string) {
    assert.deepStrictEqual([property, empty, ready], ['sys.boot_completed', '', '1'], 'The recording executor answers "sys.boot_completed" empty while the emulator boots, and "1" once it has');
    s.executorOptions = { ...s.executorOptions, emptyBootReads: reads };
  },
);

When('the device lifecycle runs a callback with devices for the ADW ID {string}', async function (adwId: string) {
  await runLifecycle(adwId, async () => RETURNED);
});

When('the device lifecycle runs a callback that throws the error {string}, with devices for the ADW ID {string}', async function (message: string, adwId: string) {
  const thrown = new Error(message);
  await runLifecycle(adwId, async () => { throw thrown; }, thrown);
});

Then('the device lifecycle took these steps for each of the emulator and the simulator, in this order:', function (table: DataTable) {
  const expected = table.hashes().map(({ step }) => step);
  assert.deepStrictEqual(expected, [...STEPS], `The lifecycle has the steps ${STEPS.join(', ')}`);
  (['emulator', 'simulator'] as const satisfies readonly Device[]).forEach(device => {
    assert.deepStrictEqual(stepsTaken(recordedCommands(), device), expected, `Expected the steps taken for the ${device} to be these, but the commands were:\n${recordedCommands().map(lineOf).join('\n')}`);
  });
});

Then('the callback ran once', function () {
  assert.strictEqual(requireRun().given.length, 1, 'Expected the callback to have been called once');
});

Then('the callback was given exactly the variables {string}, {string} and {string}', function (first: string, second: string, third: string) {
  const expected = [first, second, third].map(variableNamed).sort();
  assert.deepStrictEqual(Object.keys(requireRun().given[0]).sort(), expected, 'Expected the callback to have been given exactly these variables');
});

Then('the device lifecycle came back with what the callback returned', function () {
  const { failure, returned } = requireRun();
  assert.strictEqual(failure, undefined, `Expected the device lifecycle to come back, but it failed with: ${String(failure)}`);
  assert.strictEqual(returned, RETURNED, 'Expected the device lifecycle to come back with what the callback returned');
});

Then('the device lifecycle failed with the error the callback threw', function () {
  const { failure, thrown } = requireRun();
  assert.ok(thrown, 'Expected the scenario to have told the callback to throw');
  assert.strictEqual(failure, thrown, 'Expected the device lifecycle to fail with the very error the callback threw');
});

Then('the callback was given {string} holding the name of the AVD the device lifecycle created', function (name: string) {
  const created = valueAfter(onlyCommandOf(recordedCommands(), 'avdmanager create avd'), '--name');
  assert.strictEqual(requireRun().given[0][variableNamed(name)], created, 'Expected the callback to have been given the name of the AVD that was created');
});

Then('the callback was given {string} holding {string} followed by the console port the emulator was started on', function (name: string, prefix: string) {
  assert.strictEqual(prefix, EMULATOR_SERIAL_PREFIX, 'The serial adb reports for an emulator is "emulator-" and its console port');
  const { port } = emulatorStartedFor(recordedCommands(), requireRun().adwId);
  assert.strictEqual(requireRun().given[0][variableNamed(name)], `${prefix}${port}`);
});

Then('the callback was given {string} holding {string}', function (name: string, value: string) {
  assert.strictEqual(requireRun().given[0][variableNamed(name)], value);
});

Then(
  'the AVD was created with {string} from the system image {string} and the device profile {string}, under a name that carries the ADW ID {string}',
  function (tool: string, image: string, profile: string, adwId: string) {
    const create = onlyCommandOf(recordedCommands(), tool);
    assert.strictEqual(valueAfter(create, '--package'), image, 'Expected the AVD to be created from the system image');
    assert.strictEqual(valueAfter(create, '--device'), profile, 'Expected the AVD to be created from the device profile');
    assert.ok(valueAfter(create, '--name').includes(adwId), `Expected the name of the AVD to carry the ADW ID "${adwId}", but it is "${valueAfter(create, '--name')}"`);
  },
);

Then(
  'the emulator was started with {string} from that AVD, headless with {string}, on the console port given with {string}',
  function (program: string, headless: string, portFlag: string) {
    const created = valueAfter(onlyCommandOf(recordedCommands(), 'avdmanager create avd'), '--name');
    const started = onlyCommandOf(recordedCommands(), program);
    assert.strictEqual(valueAfter(started, '-avd'), created, 'Expected the emulator to be started from the AVD that was created');
    assert.ok(started.argv.includes(headless), `Expected the emulator to be started with "${headless}": ${lineOf(started)}`);
    assert.ok(Number.isInteger(Number(valueAfter(started, portFlag))), `Expected "${portFlag}" to give a console port: ${lineOf(started)}`);
  },
);

Then(
  'the simulator was created with {string} of the device type {string} and the runtime {string}, under a name that carries the ADW ID {string}',
  function (tool: string, deviceType: string, runtime: string, adwId: string) {
    const [name, createdType, createdRuntime] = onlyCommandOf(recordedCommands(), tool).argv.slice(tool.split(' ').length);
    assert.deepStrictEqual([createdType, createdRuntime], [deviceType, runtime], 'Expected the simulator to be created from the device type and the runtime');
    assert.ok(name.includes(adwId), `Expected the name of the simulator to carry the ADW ID "${adwId}", but it is "${name}"`);
  },
);

Then('the simulator was booted with {string} by the UDID {string}', function (tool: string, udid: string) {
  assert.deepStrictEqual(commandsOf(recordedCommands(), `${tool} ${udid}`).map(lineOf), [`${tool} ${udid}`], 'Expected the simulator to be booted by its UDID');
});

Then(
  'the emulator was waited for with {string}, addressed by the serial of its console port, until its device state was {string} and its property {string} read {string}',
  function (tool: string, state: string, property: string, value: string) {
    assert.deepStrictEqual([tool, state, property, value], ['adb', 'device', 'sys.boot_completed', '1'], 'The emulator is ready when its device state is "device" and "sys.boot_completed" reads "1"');
    const serial = `${EMULATOR_SERIAL_PREFIX}${emulatorStartedFor(recordedCommands(), requireRun().adwId).port}`;
    const commands = recordedCommands().map(lineOf);
    const callbackAt = commands.indexOf(CALLBACK);
    const stateAt = commands.lastIndexOf(`adb -s ${serial} get-state`);
    const propertyAt = commands.lastIndexOf(`adb -s ${serial} shell getprop ${property}`);
    assert.notStrictEqual(stateAt, -1, `Expected adb to have been asked for the device state of "${serial}"`);
    assert.notStrictEqual(propertyAt, -1, `Expected adb to have been asked for "${property}" of "${serial}"`);
    assert.ok(stateAt < callbackAt, `Expected adb to have been asked for the device state of "${serial}" only before the callback ran, but the commands were:\n${commands.join('\n')}`);
    assert.ok(propertyAt < callbackAt, `Expected adb to have been asked for "${property}" of "${serial}" only before the callback ran, but the commands were:\n${commands.join('\n')}`);
  },
);

Then('the simulator was waited for with {string} by the UDID {string}', function (tool: string, udid: string) {
  assert.deepStrictEqual(commandsOf(recordedCommands(), `${tool} ${udid}`).map(lineOf), [`${tool} ${udid}`], 'Expected the simulator to be waited for by its UDID');
});

Then('the emulator was shut down with the {string} command {string}, addressed by its serial', function (tool: string, command: string) {
  const serial = `${EMULATOR_SERIAL_PREFIX}${emulatorStartedFor(recordedCommands(), requireRun().adwId).port}`;
  assert.deepStrictEqual(commandsOf(recordedCommands(), `${tool} -s ${serial} ${command}`).map(lineOf), [`${tool} -s ${serial} ${command}`]);
});

Then('the AVD was deleted with {string}, by its name', function (tool: string) {
  const { avd } = emulatorStartedFor(recordedCommands(), requireRun().adwId);
  assert.deepStrictEqual(commandsOf(recordedCommands(), `${tool} --name ${avd}`).map(lineOf), [`${tool} --name ${avd}`]);
});

Then('the simulator was shut down with {string} and deleted with {string}, each by the UDID {string}', function (shutDown: string, deleted: string, udid: string) {
  [shutDown, deleted].forEach(tool => assert.deepStrictEqual(commandsOf(recordedCommands(), `${tool} ${udid}`).map(lineOf), [`${tool} ${udid}`]));
});

Then(
  "the device lifecycle read the emulator's property {string} {int} times, and ran the callback only after the last read",
  function (property: string, times: number) {
    const serial = `${EMULATOR_SERIAL_PREFIX}${emulatorStartedFor(recordedCommands(), requireRun().adwId).port}`;
    const commands = recordedCommands().map(lineOf);
    const reads = commands.filter(line => line === `adb -s ${serial} shell getprop ${property}`).length;
    assert.strictEqual(reads, times, `Expected "${property}" to be read ${times} times, but it was read ${reads} times`);
    assert.ok(commands.indexOf(CALLBACK) > commands.lastIndexOf(`adb -s ${serial} shell getprop ${property}`), 'Expected the callback to run after the last read');
  },
);

Then('the emulators for the ADW IDs {string} and {string} were started on different console ports', function (first: string, second: string) {
  const ports = [first, second].map(adwId => emulatorStartedFor(recordedCommands(), adwId).port);
  assert.notStrictEqual(ports[0], ports[1], `Expected the emulators to be started on different console ports, but both were started on ${ports[0]}`);
});

Then(
  "the callback for each ADW ID was given {string} holding {string} followed by the console port of that ADW ID's emulator",
  function (name: string, prefix: string) {
    assert.ok(s.runs.length > 1, 'Expected the device lifecycle to have run for more than one ADW ID');
    s.runs.forEach(({ adwId, given }) => {
      assert.strictEqual(given[0][variableNamed(name)], `${prefix}${emulatorStartedFor(recordedCommands(), adwId).port}`, `Expected the callback for "${adwId}" to be given the serial of its own emulator`);
    });
  },
);
