/**
 * What the feature-1048 scenarios read from the commands a stand-in device host recorded, whoever drove the device lifecycle:
 * the scenario itself, with a callback of its own, or the scenario test phase. A boot is one start of the emulator with
 * "emulator", or one "xcrun simctl boot" of the simulator. No hooks and no steps: any step file may import it.
 */

import assert from 'assert';

import { lastStandInDeviceHost, type StandInDeviceCommand, type StandInDeviceHost } from '../../regression/support/standInDevices.ts';

import { CALLBACK, commandsOf, lineOf, type Device } from './feature-1047-commands.ts';

type Commands = readonly StandInDeviceCommand[];

const describeCommands = (commands: Commands): string => commands.map(lineOf).join('\n');

export function deviceNamed(word: string): Device {
  assert.ok(word === 'emulator' || word === 'simulator', `Expected "emulator" or "simulator", but the scenario names "${word}"`);
  return word;
}

export function requireStandInHost(): StandInDeviceHost {
  const host = lastStandInDeviceHost();
  assert.ok(host, "Expected the scenario to have replaced the host's device tools with stand-ins first");
  return host;
}

export function bootsOf(commands: Commands, device: Device): StandInDeviceCommand[] {
  return device === 'emulator' ? commands.filter(({ argv }) => argv[0] === 'emulator') : commandsOf(commands, 'xcrun simctl boot');
}

export function assertBootedTimes(commands: Commands, device: Device, times: number): void {
  const boots = bootsOf(commands, device);
  assert.strictEqual(boots.length, times, `Expected ${times} boots of the ${device}, but there were ${boots.length}; the commands were:\n${describeCommands(commands)}`);
}

export function assertRanOnce(commands: Commands, tool: string): void {
  const ran = commandsOf(commands, tool);
  assert.strictEqual(ran.length, 1, `Expected "${tool}" to have been run once, but it was run ${ran.length} times; the commands were:\n${describeCommands(commands)}`);
}

/** Only what the host answered with success was created: a creation that failed for a tool that is not installed created nothing. */
export function assertDeletedWhatItCreated(commands: Commands): void {
  const succeeded = (words: string): number => commandsOf(commands, words).filter(({ exitCode }) => exitCode === 0).length;
  const created = { avds: succeeded('avdmanager create avd'), simulators: succeeded('xcrun simctl create') };
  assert.ok(created.avds + created.simulators > 0, `Expected a device to have been created, but the commands were:\n${describeCommands(commands)}`);
  assert.deepStrictEqual(
    { avds: succeeded('avdmanager delete avd'), simulators: succeeded('xcrun simctl delete') },
    created,
    `Expected every AVD and every simulator that was created to be deleted, but the commands were:\n${describeCommands(commands)}`,
  );
}

export function assertNoEmulatorRunning(running: readonly string[]): void {
  assert.deepStrictEqual(running, [], `Expected every emulator that was started to have quit, but these are still running: ${running.join(', ')}`);
}

/** An emulator that has not finished booting is asked to quit with "adb emu kill" before the next one is started. */
export function assertEachEmulatorStoppedBeforeTheNext(commands: Commands): void {
  const starts = commands.flatMap(({ argv }, index) => (argv[0] === 'emulator' ? [index] : []));
  assert.ok(starts.length > 1, `Expected the emulator to have been started more than once, but the commands were:\n${describeCommands(commands)}`);
  starts.forEach((start, position) => {
    const until = starts[position + 1] ?? commands.length;
    const stopped = commands.slice(start + 1, until).some(command => lineOf(command).endsWith(' emu kill'));
    assert.ok(stopped, `Expected the emulator started by "${lineOf(commands[start])}" to be stopped before the next one was started, but the commands were:\n${describeCommands(commands)}`);
  });
}

export function assertCallbackRanAfterBoot(commands: Commands, device: Device, boot: number): void {
  const thisBoot = bootsOf(commands, device)[boot - 1];
  assert.ok(thisBoot, `Expected the ${device} to have been booted ${boot} times, but the commands were:\n${describeCommands(commands)}`);
  const callbackAt = commands.findIndex(command => lineOf(command) === CALLBACK);
  assert.ok(callbackAt > commands.indexOf(thisBoot), `Expected the callback to have run after boot ${boot} of the ${device}, but the commands were:\n${describeCommands(commands)}`);
}
