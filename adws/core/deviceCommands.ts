/**
 * What ADW says to the device tools: the names and console ports it gives devices, the commands with the time each is
 * given, and how it reads what the tools print. Pure: when to say it is the lifecycle's.
 */

import { createHash } from 'node:crypto';
import type { DeviceCommand, DeviceCommandResult } from './deviceExecutor';
import type { DeviceSource } from './deviceSourceConfig';

export const DEVICE_NAME_PREFIX = 'adw-';
export const FIRST_CONSOLE_PORT = 5554;
// The emulator's documented range, 5554–5682, holds 64 devices; the adb port of each is the console port above it.
export const CONSOLE_PORT_COUNT = 64;
export const DEVICE_COMMAND_TIMEOUT_MS = 120_000;
export const DEVICE_BOOT_TIMEOUT_MS = 300_000;
export const POLL_COMMAND_TIMEOUT_MS = 10_000;
export const MAX_BOOT_ATTEMPTS = 3;
// The emulator prints its start-up lines first and its reason for stopping last, so only its last lines are kept.
export const EMULATOR_OUTPUT_LINES = 20;

/** The host tools a device needs: the ones a host may lack, and that a retry cannot supply. */
export enum HostTool {
  AvdManager = 'avdmanager',
  Emulator = 'emulator',
  Adb = 'adb',
  Simctl = 'xcrun simctl',
}

const UDID_PATTERN = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi;

// `xcrun` is only ever asked for `simctl`.
const TOOL_OF_PROGRAM: ReadonlyMap<string, HostTool> = new Map([
  ['avdmanager', HostTool.AvdManager],
  ['emulator', HostTool.Emulator],
  ['adb', HostTool.Adb],
  ['xcrun', HostTool.Simctl],
]);

// How a host with the Command Line Tools but no Xcode answers: `xcrun` runs, and exits 72.
const NO_SIMCTL_ANSWER = /unable to find utility "simctl"/;

type Argv = DeviceCommand['argv'];

export function deviceNameFor(adwId: string): string {
  return `${DEVICE_NAME_PREFIX}${adwId}`;
}

// The hash spreads workflows that boot at the same moment over the range; the probe then skips what is in use.
export function emulatorConsolePortCandidates(adwId: string): readonly number[] {
  const slot = createHash('sha256').update(adwId).digest().readUInt32BE(0) % CONSOLE_PORT_COUNT;
  return Array.from({ length: CONSOLE_PORT_COUNT }, (_, offset) => FIRST_CONSOLE_PORT + 2 * ((slot + offset) % CONSOLE_PORT_COUNT));
}

const within = (timeoutMs: number, argv: Argv): DeviceCommand => ({ argv, timeoutMs });
const standard = (...argv: Argv): DeviceCommand => within(DEVICE_COMMAND_TIMEOUT_MS, argv);

// avdmanager asks whether to create a custom hardware profile; the answer is always no.
export const createAvd = (name: string, source: DeviceSource): DeviceCommand => ({
  ...standard('avdmanager', 'create', 'avd', '--name', name, '--package', source.androidSystemImage, '--device', source.androidDeviceProfile, '--force'),
  input: 'no\n',
});

export const deleteAvd = (name: string): DeviceCommand => standard('avdmanager', 'delete', 'avd', '--name', name);

export const startAdbServer: DeviceCommand = standard('adb', 'start-server');

/** The emulator is started, not run to completion: this is its argv, not a command. */
export const emulatorArgv = (name: string, port: number): Argv =>
  ['emulator', '-avd', name, '-port', String(port), '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot'];

export const pollEmulator = (serial: string, ...args: string[]): DeviceCommand => within(POLL_COMMAND_TIMEOUT_MS, ['adb', '-s', serial, ...args]);

export const killEmulator = (serial: string): DeviceCommand => standard('adb', '-s', serial, 'emu', 'kill');

export const createSimulator = (name: string, source: DeviceSource): DeviceCommand =>
  standard('xcrun', 'simctl', 'create', name, source.iosDeviceType, source.iosRuntime);

export const bootSimulator = (udid: string): DeviceCommand => standard('xcrun', 'simctl', 'boot', udid);

export const awaitSimulatorBoot = (udid: string): DeviceCommand => within(DEVICE_BOOT_TIMEOUT_MS, ['xcrun', 'simctl', 'bootstatus', udid]);

export const shutDownSimulator = (udid: string): DeviceCommand => standard('xcrun', 'simctl', 'shutdown', udid);

export const deleteSimulator = (udid: string): DeviceCommand => standard('xcrun', 'simctl', 'delete', udid);

export const listAvds: DeviceCommand = standard('avdmanager', 'list', 'avd', '-c');

// The wait for an emulator to leave polls it, so it is given a poll's time, not a command's.
export const listAttachedDevices: DeviceCommand = within(POLL_COMMAND_TIMEOUT_MS, ['adb', 'devices']);

export const queryEmulatorAvdName = (serial: string): DeviceCommand => pollEmulator(serial, 'emu', 'avd', 'name');

export const listSimulators: DeviceCommand = standard('xcrun', 'simctl', 'list', '--json', 'devices');

/** A tool prints its answer last: a daemon starting up, or a warning, comes before it. */
export const lastLine = (output: string): string => output.trim().split('\n').pop()?.trim() ?? '';

export function lastLines(output: string, count: number): string {
  const lines = output.trimEnd().split('\n');
  return lines.slice(Math.max(0, lines.length - count)).join('\n');
}

export const hostToolOf = (argv: Argv): HostTool | null => TOOL_OF_PROGRAM.get(argv[0]) ?? null;

/** A tool that ran and failed is a boot failure, not a missing tool: only a program that is not there, or a `simctl` that `xcrun` cannot find, is. */
export function missingToolOf(command: DeviceCommand, result: DeviceCommandResult): HostTool | null {
  if (result.programMissing) return hostToolOf(command.argv);
  return command.argv[0] === 'xcrun' && NO_SIMCTL_ANSWER.test(result.output) ? HostTool.Simctl : null;
}

export const lastUdid = (output: string): string | undefined => output.match(UDID_PATTERN)?.pop();

// The shape `generateAdwId` makes: lowercase letters and digits in at least two hyphen-joined groups. A device whose name
// is the prefix and anything else is the operator's, not ADW's.
const ADW_ID_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/** The inverse of `deviceNameFor`: the ADW ID a device is named for, or `null` for a name ADW does not give a device. */
export function adwIdOfDeviceName(name: string): string | null {
  if (!name.startsWith(DEVICE_NAME_PREFIX)) return null;
  const adwId = name.slice(DEVICE_NAME_PREFIX.length);
  return ADW_ID_SHAPE.test(adwId) ? adwId : null;
}

const EMULATOR_SERIAL_LINE = /^(emulator-\d+)\s/;

const lines = (output: string): readonly string[] => output.split('\n').map(line => line.trim()).filter(line => line !== '');

/** Every line: a warning avdmanager printed among the names is not one an ADW ID can be read from, so the caller drops it. */
export const avdNamesIn = (output: string): readonly string[] => lines(output);

/** The serial of each emulator `adb devices` lists; its header, its daemon start-up lines and the serials of USB devices are not. */
export const emulatorSerialsIn = (output: string): readonly string[] => lines(output).flatMap(line => line.match(EMULATOR_SERIAL_LINE)?.slice(1) ?? []);

/** The console answers `avd name` with the name, then `OK`. */
export const avdNameIn = (output: string): string | null => lines(output).find(line => line !== 'OK') ?? null;

export interface ListedSimulator {
  readonly name: string;
  readonly udid: string;
  readonly state: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const isListedSimulator = (entry: unknown): entry is ListedSimulator =>
  isRecord(entry) && typeof entry.name === 'string' && typeof entry.udid === 'string' && typeof entry.state === 'string';

// simctl lists more of a simulator than ADW reads.
const listedSimulator = ({ name, udid, state }: ListedSimulator): ListedSimulator => ({ name, udid, state });

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Every simulator of every runtime, or `null` when the output holds no device list that can be read. */
export function simulatorsIn(output: string): readonly ListedSimulator[] | null {
  // xcrun may print a warning before or after the JSON, so only the outermost object is parsed.
  const parsed = parseJson(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
  const byRuntime = isRecord(parsed) ? parsed.devices : undefined;
  if (!isRecord(byRuntime)) return null;

  const runtimes = Object.values(byRuntime);
  if (!runtimes.every(isList)) return null;
  return runtimes.flat().filter(isListedSimulator).map(listedSimulator);
}

export const isShutDown = ({ state }: ListedSimulator): boolean => state === 'Shutdown';
