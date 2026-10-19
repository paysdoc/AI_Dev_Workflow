/**
 * What ADW says to the device tools: the names and console ports it gives devices, the commands with the time each is
 * given, and how it reads what the tools print. Pure: when to say it is the lifecycle's.
 */

import { createHash } from 'node:crypto';
import type { DeviceCommand } from './deviceExecutor';
import type { DeviceSource } from './deviceSourceConfig';

export const DEVICE_NAME_PREFIX = 'adw-';
export const FIRST_CONSOLE_PORT = 5554;
// The emulator's documented range, 5554–5682, holds 64 devices; the adb port of each is the console port above it.
export const CONSOLE_PORT_COUNT = 64;
export const DEVICE_COMMAND_TIMEOUT_MS = 120_000;
export const DEVICE_BOOT_TIMEOUT_MS = 300_000;
export const POLL_COMMAND_TIMEOUT_MS = 10_000;

const UDID_PATTERN = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi;

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

/** A tool prints its answer last: a daemon starting up, or a warning, comes before it. */
export const lastLine = (output: string): string => output.trim().split('\n').pop()?.trim() ?? '';

export const lastUdid = (output: string): string | undefined => output.match(UDID_PATTERN)?.pop();
