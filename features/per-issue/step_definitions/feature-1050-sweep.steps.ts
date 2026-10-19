/**
 * The device janitor's sweep of the stand-in host, as the feature-1050 scenarios run and read it: the real `runDeviceJanitorPass`
 * over the recording executor, with the liveness and the worktree age of the workflows the scenario described. A scenario reads
 * the commands the executor was given, the devices it holds afterwards, and the lines the janitor logged. No scenario reaches a
 * real SDK.
 */

import { When, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';

import { runDeviceJanitorPass } from '../../../adws/triggers/deviceJanitor.ts';

import type { StandInHeldDevices } from '../../regression/support/standInDevices.ts';
import { commandsOf, lineOf } from './feature-1047-commands.ts';
import { recordedCommands, requireExecutor } from './feature-1047-world.ts';
import { ADW_NAME_PREFIX, assertNoneHeldUnderName, devicesNamed, type DevicesOfAdwId, emulatorCommands, heldUnderName, nameFor, simulatorCommands, stepsFrom } from './feature-1050-devices.ts';
import { TARGET_REPOS, janitorDepsOver, s } from './feature-1050-world.ts';

const describeLines = (): string => s.lines.map(({ level, message }) => `${level} ${message}`).join('\n');
const describeCommands = (): string => recordedCommands().map(lineOf).join('\n');

When('the device janitor sweeps the host', async function () {
  try {
    await runDeviceJanitorPass(janitorDepsOver({ executor: requireExecutor().executor }), TARGET_REPOS);
  } catch (failure) {
    s.failure = failure;
  }
  s.swept = true;
});

Then('the device janitor took these steps for each of the emulator and the simulator of the ADW ID {string}, in this order:', function (adwId: string, table: DataTable) {
  const expected = table.hashes().map(({ step }) => step);
  const devices = devicesNamed(requireExecutor().leftovers, nameFor(adwId));
  const lines = recordedCommands().map(lineOf);
  const taken = { emulator: stepsFrom(lines, emulatorCommands(devices)), simulator: stepsFrom(lines, simulatorCommands(devices)) };

  assert.deepStrictEqual(taken, { emulator: expected, simulator: expected }, `Expected the emulator and the simulator of "${adwId}" each to have these steps taken; the commands were:\n${describeCommands()}`);
});

Then('the host has no emulator, AVD or simulator of the ADW ID {string} any more', function (adwId: string) {
  assertNoneHeldUnderName(requireExecutor().held(), nameFor(adwId), `the ADW ID "${adwId}"`);
});

function exactlyOnce(line: string): void {
  assert.deepStrictEqual(commandsOf(recordedCommands(), line).map(lineOf), [line], `Expected exactly one "${line}"; the commands were:\n${describeCommands()}`);
}

Then(
  'the device janitor shut down the emulator running from the AVD {string} with the {string} command {string}, addressed by its serial',
  function (avd: string, tool: string, command: string) {
    const { serials } = devicesNamed(requireExecutor().leftovers, avd);
    assert.strictEqual(serials.length, 1, `Expected one emulator to have run from the AVD "${avd}"`);
    exactlyOnce(`${tool} -s ${serials[0]} ${command}`);
  },
);

Then('the device janitor deleted the AVD {string} with {string}, by its name', function (avd: string, tool: string) {
  exactlyOnce(`${tool} --name ${avd}`);
});

Then('the device janitor shut down the simulator {string} with {string} and deleted it with {string}, each by its UDID', function (name: string, shutDown: string, deleted: string) {
  const { udids } = devicesNamed(requireExecutor().leftovers, name);
  assert.ok(udids.length > 0, `Expected the host to have held the simulator "${name}"`);
  udids.forEach(udid => [shutDown, deleted].forEach(tool => exactlyOnce(`${tool} ${udid}`)));
});

/** The shut-down and delete commands the janitor gave for these devices. */
function removalCommandsGiven(devices: DevicesOfAdwId): string[] {
  const lines = new Set(recordedCommands().map(lineOf));
  return [...emulatorCommands(devices).keys(), ...simulatorCommands(devices).keys()].filter(command => lines.has(command));
}

function assertUntouched(name: string, leftovers: StandInHeldDevices, held: StandInHeldDevices): void {
  assert.deepStrictEqual(removalCommandsGiven(devicesNamed(leftovers, name)), [], `Expected "${name}" not to be shut down or deleted; the commands were:\n${describeCommands()}`);
  assert.deepStrictEqual(heldUnderName(held, name), heldUnderName(leftovers, name), `Expected the host to hold "${name}" as it held it to begin with`);
}

Then('the device janitor neither shut down nor deleted the emulator or the simulator of the ADW ID {string}', function (adwId: string) {
  const { leftovers, held } = requireExecutor();
  const devices = devicesNamed(leftovers, nameFor(adwId));
  assert.ok(devices.serials.length > 0 && devices.udids.length > 0, `Expected the host to have held an emulator and a simulator of the ADW ID "${adwId}"`);

  const taken = removalCommandsGiven(devices);
  assert.deepStrictEqual(taken, [], `Expected none of the devices of "${adwId}" to be shut down or deleted; the commands were:\n${describeCommands()}`);
  assert.deepStrictEqual(heldUnderName(held(), devices.name), heldUnderName(leftovers, devices.name), `Expected the host to hold the devices of "${adwId}" as it held them to begin with`);
});

Then('the device janitor neither shut down nor deleted any device that is not named for an ADW ID', function () {
  const { leftovers, held } = requireExecutor();
  const names = [...leftovers.avds, ...leftovers.simulators.map(({ name }) => name)].filter(name => !name.startsWith(ADW_NAME_PREFIX));
  assert.ok(names.length > 0, 'Expected the host to hold devices that are not named for an ADW ID');

  names.forEach(name => assertUntouched(name, leftovers, held()));
});

function removalLine(kind: 'AVD' | 'simulator', name: string, adwId: string) {
  // The name of a device holds its ADW ID, so the ADW ID has to be on the line apart from the name.
  const namesTheAdwId = (message: string): boolean => message.split(name).join('').includes(adwId);
  return s.lines.find(({ level, message }) => level === 'info' && message.includes('removed') && message.includes(`${kind} "${name}"`) && namesTheAdwId(message));
}

Then('the device janitor logged the removal of the AVD {string} on a line that also names the ADW ID {string}', function (avd: string, adwId: string) {
  assert.ok(removalLine('AVD', avd, adwId), `Expected a line that logs the removal of the AVD "${avd}" and names the ADW ID "${adwId}"; the janitor logged:\n${describeLines()}`);
});

Then('the device janitor logged the removal of the simulator {string} on a line that also names the ADW ID {string}', function (name: string, adwId: string) {
  assert.ok(removalLine('simulator', name, adwId), `Expected a line that logs the removal of the simulator "${name}" and names the ADW ID "${adwId}"; the janitor logged:\n${describeLines()}`);
});

Then('the device janitor logged a warning that names the AVD {string} and holds {string}', function (avd: string, printed: string) {
  const warned = s.lines.find(({ level, message }) => level === 'warn' && message.includes(`AVD "${avd}"`) && message.includes(printed));
  assert.ok(warned, `Expected a warning that names the AVD "${avd}" and holds "${printed}"; the janitor logged:\n${describeLines()}`);
});

Then("the device janitor's sweep completed without an error", function () {
  assert.ok(s.swept, 'Expected the device janitor to have swept the host first');
  assert.strictEqual(s.failure, undefined, `Expected the sweep to complete without an error, but it rejected with: ${String(s.failure)}`);
});
