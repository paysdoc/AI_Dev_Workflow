/**
 * How the stand-in host's device tools answer when a device does not boot. Each description is said of the recording executor
 * the scenario drives the device lifecycle over ("the recording executor answers as a host on which ..."), and of the stand-in
 * device tools the scenario test phase runs on ("the host's device tools are stand-ins that record each run and answer as a
 * host on which ..."). A boot of the emulator fails when the emulator exits before it is ready, and then its output file holds
 * what it printed.
 */

import { Given, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';

import { standInDeviceHost, type StandInDeviceOptions } from '../../regression/support/standInDevices.ts';

import { s } from './feature-1047-world.ts';

/** Each description has one parameter, which cucumber counts from the arity of the function it calls. */
type Describe<Arg> = (arg: Arg) => StandInDeviceOptions;

// `xcrun` is the program that `xcrun simctl` runs.
const PROGRAM_OF_TOOL: ReadonlyMap<string, string> = new Map([
  ['avdmanager', 'avdmanager'],
  ['emulator', 'emulator'],
  ['adb', 'adb'],
  ['xcrun simctl', 'xcrun'],
]);

function programOf(tool: string): string {
  const program = PROGRAM_OF_TOOL.get(tool);
  assert.ok(program, `Expected one of ${[...PROGRAM_OF_TOOL.keys()].join(', ')}, but the scenario names "${tool}"`);
  return program;
}

function onTheExecutor<Arg>(description: string, describe: Describe<Arg>): void {
  Given(`the recording executor answers as a host on which ${description}`, function (arg: Arg) {
    s.executorOptions = { ...s.executorOptions, ...describe(arg) };
  });
}

function onTheStandInHost<Arg>(description: string, describe: Describe<Arg>): void {
  Given(`the host's device tools are stand-ins that record each run and answer as a host on which ${description}`, function (arg: Arg) {
    standInDeviceHost(describe(arg));
  });
}

function onBoth<Arg>(description: string, describe: Describe<Arg>): void {
  onTheExecutor(description, describe);
  onTheStandInHost(description, describe);
}

onBoth('the emulator fails its first {int} boots', (boots: number) => ({ emulatorEarlyExits: boots }));
onBoth('the simulator fails its first {int} boots', (boots: number) => ({ simulatorBootFailures: boots, simulatorBootOutputs: ['Unable to boot device'] }));
onBoth('every boot of the emulator fails, printing {string}', (printed: string) => ({ emulatorEarlyExits: Infinity, emulatorOutput: printed }));
onBoth('every boot of the simulator fails, printing {string}', (printed: string) => ({ simulatorBootFailures: Infinity, simulatorBootOutputs: [printed] }));
onBoth('{string} is not installed', (tool: string) => ({ missingPrograms: [programOf(tool)] }));

Given(
  'the recording executor answers as a host on which every boot of the simulator fails, printing on each attempt:',
  function (table: DataTable) {
    const printed = table.hashes().map(({ attempt, prints }, index) => {
      assert.strictEqual(Number(attempt), index + 1, `Expected the attempts to be numbered from 1 in order, but row ${index + 1} is attempt ${attempt}`);
      return prints;
    });
    s.executorOptions = { ...s.executorOptions, simulatorBootFailures: Infinity, simulatorBootOutputs: printed };
  },
);

Given("the recording executor answers the emulator's property {string} with {string} on every read", function (property: string, value: string) {
  assert.deepStrictEqual([property, value], ['sys.boot_completed', ''], 'The recording executor answers "sys.boot_completed" empty while the emulator boots');
  s.executorOptions = { ...s.executorOptions, emptyBootReads: Infinity };
});

Given("the host has since been fixed, so that its device tools answer as a host on which the emulator and the simulator boot", function () {
  standInDeviceHost();
});
