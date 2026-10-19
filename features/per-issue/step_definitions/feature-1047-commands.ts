/**
 * Reads the commands a stand-in device executor recorded, in the words the feature-1047 scenarios use: which of the steps of the
 * device lifecycle a command is, and for which device. No hooks and no steps: any step file may import it.
 */

import assert from 'assert';

import type { StandInDeviceCommand } from '../../regression/support/standInDevices.ts';

/** The callback is recorded among the commands, by the step that runs the lifecycle, to place it among them. */
export const CALLBACK = 'callback';

export type Device = 'emulator' | 'simulator';

export const STEPS = ['create', 'boot', 'wait until ready', 'run the callback', 'shut down', 'delete'] as const;

export type Step = (typeof STEPS)[number];

const SIMULATOR_STEPS: Readonly<Record<string, Step>> = {
  create: 'create',
  boot: 'boot',
  bootstatus: 'wait until ready',
  shutdown: 'shut down',
  delete: 'delete',
};

const ADB_STEPS: Readonly<Record<string, Step>> = {
  'start-server': 'boot',
  'get-state': 'wait until ready',
  'shell getprop sys.boot_completed': 'wait until ready',
  'emu kill': 'shut down',
};

export const lineOf = ({ argv }: StandInDeviceCommand): string => argv.join(' ');

function simulatorStep(argv: readonly string[]): Step | undefined {
  return SIMULATOR_STEPS[argv[2]];
}

function adbStep(argv: readonly string[]): Step | undefined {
  return ADB_STEPS[argv[1] === '-s' ? argv.slice(3).join(' ') : argv.slice(1).join(' ')];
}

/** The device a command is for, and the step of the lifecycle it is; the callback is a step of both. */
export function classify(command: StandInDeviceCommand): { readonly devices: readonly Device[]; readonly step: Step } {
  const { argv } = command;
  const [program, subcommand] = argv;
  const known = (devices: readonly Device[], step: Step | undefined): { readonly devices: readonly Device[]; readonly step: Step } => {
    assert.ok(step, `Expected the lifecycle to run only commands of its own, but it ran: ${lineOf(command)}`);
    return { devices, step };
  };
  if (lineOf(command) === CALLBACK) return known(['emulator', 'simulator'], 'run the callback');
  if (program === 'avdmanager') return known(['emulator'], subcommand === 'create' ? 'create' : 'delete');
  if (program === 'emulator') return known(['emulator'], 'boot');
  if (program === 'adb') return known(['emulator'], adbStep(argv));
  return known(['simulator'], program === 'xcrun' ? simulatorStep(argv) : undefined);
}

/** The steps the lifecycle took for a device, in order, with the repeated polls of a wait counted as one. */
export function stepsTaken(commands: readonly StandInDeviceCommand[], device: Device): Step[] {
  const steps = commands.map(classify).filter(({ devices }) => devices.includes(device)).map(({ step }) => step);
  return steps.filter((step, index) => step !== steps[index - 1]);
}

/** The commands that are `words` followed by nothing or by arguments; `xcrun simctl boot` is not `xcrun simctl bootstatus`. */
export function commandsOf(commands: readonly StandInDeviceCommand[], words: string): StandInDeviceCommand[] {
  return commands.filter(command => lineOf(command) === words || lineOf(command).startsWith(`${words} `));
}

export function onlyCommandOf(commands: readonly StandInDeviceCommand[], words: string): StandInDeviceCommand {
  const found = commandsOf(commands, words);
  assert.strictEqual(found.length, 1, `Expected exactly one "${words}", but the commands were:\n${commands.map(lineOf).join('\n')}`);
  return found[0];
}

/** The argument after a flag: `--name adw-x`. */
export function valueAfter(command: StandInDeviceCommand, flag: string): string {
  const at = command.argv.indexOf(flag);
  assert.ok(at !== -1 && at + 1 < command.argv.length, `Expected "${lineOf(command)}" to give "${flag}" a value`);
  return command.argv[at + 1];
}

/** The emulator started from an AVD that carries the ADW ID, and the console port it was started on. */
export function emulatorStartedFor(commands: readonly StandInDeviceCommand[], adwId: string): { readonly avd: string; readonly port: number } {
  const started = commands.filter(command => command.argv[0] === 'emulator' && valueAfter(command, '-avd').includes(adwId));
  assert.strictEqual(started.length, 1, `Expected one emulator to have been started for the ADW ID "${adwId}", but the commands were:\n${commands.map(lineOf).join('\n')}`);
  return { avd: valueAfter(started[0], '-avd'), port: Number(valueAfter(started[0], '-port')) };
}
