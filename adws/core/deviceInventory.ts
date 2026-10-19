/**
 * The devices on the host that are named for an ADW ID, and the removal of one of them, for a sweep of what workflows left
 * behind. Unlike the lifecycle's teardown it holds no process of the emulator, so it finds the emulator through adb and
 * waits for it to leave. Every effect goes through the injected executor, and the removal of a device never rejects.
 */

import { Platform } from './applicationType';
import { BOOT_POLL_INTERVAL_MS, EMULATOR_EXIT_TIMEOUT_MS } from './deviceBringUp';
import * as tools from './deviceCommands';
import type { DeviceCommand, DeviceCommandResult, DeviceExecutor } from './deviceExecutor';
import type { DeviceLifecycleDeps } from './deviceLifecycle';

export type DeviceInventoryDeps = Pick<DeviceLifecycleDeps, 'executor' | 'clock'>;

export interface AdwAvd {
  readonly platform: Platform.Android;
  readonly adwId: string;
  readonly name: string;
  /** The serial of the emulator running it; `null` when none runs, or when adb cannot say. */
  readonly serial: string | null;
}

export interface AdwSimulator {
  readonly platform: Platform.Ios;
  readonly adwId: string;
  readonly name: string;
  readonly udid: string;
  readonly booted: boolean;
}

export type AdwDevice = AdwAvd | AdwSimulator;

// A tool that is missing is not a failure here: a host without it holds no device of its kind.
export type DeviceListing =
  | { readonly kind: 'listed'; readonly devices: readonly AdwDevice[] }
  | { readonly kind: 'tool_missing'; readonly tool: tools.HostTool }
  | { readonly kind: 'failed'; readonly message: string };

export type DeviceInventory = Readonly<Record<Platform, DeviceListing>>;

export interface DeviceRemoval {
  readonly device: AdwDevice;
  /** Empty when the device was removed. */
  readonly failures: readonly string[];
}

const seconds = (ms: number): string => (ms / 1000).toFixed(1);

function describeFailure(command: DeviceCommand, { exitCode, output }: DeviceCommandResult): string {
  const status = exitCode === null ? 'no exit code' : `exit code ${exitCode}`;
  return `"${command.argv.join(' ')}" failed with ${status}: ${tools.lastLine(output)}`;
}

async function failureOf(executor: DeviceExecutor, command: DeviceCommand): Promise<readonly string[]> {
  const result = await executor.run(command);
  return result.exitCode === 0 ? [] : [describeFailure(command, result)];
}

function listingFailure(command: DeviceCommand, result: DeviceCommandResult): DeviceListing {
  const tool = tools.missingToolOf(command, result);
  return tool === null ? { kind: 'failed', message: describeFailure(command, result) } : { kind: 'tool_missing', tool };
}

interface NamedForAdwId {
  readonly adwId: string;
  readonly name: string;
}

function namedForAdwId(name: string): readonly NamedForAdwId[] {
  const adwId = tools.adwIdOfDeviceName(name);
  return adwId === null ? [] : [{ adwId, name }];
}

async function avdRunningAs(executor: DeviceExecutor, serial: string): Promise<ReadonlyArray<readonly [string, string]>> {
  const answered = await executor.run(tools.queryEmulatorAvdName(serial));
  const name = answered.exitCode === 0 ? tools.avdNameIn(answered.output) : null;
  return name === null ? [] : [[name, serial]];
}

/** The serial of the emulator each running AVD is run by, keyed by the AVD's name. */
async function runningEmulators(executor: DeviceExecutor): Promise<ReadonlyMap<string, string>> {
  const attached = await executor.run(tools.listAttachedDevices);
  if (attached.exitCode !== 0) return new Map();

  const running = await Promise.all(tools.emulatorSerialsIn(attached.output).map(serial => avdRunningAs(executor, serial)));
  return new Map(running.flat());
}

async function listAndroid(executor: DeviceExecutor): Promise<DeviceListing> {
  const listed = await executor.run(tools.listAvds);
  if (listed.exitCode !== 0) return listingFailure(tools.listAvds, listed);

  const named = tools.avdNamesIn(listed.output).flatMap(namedForAdwId);
  if (named.length === 0) return { kind: 'listed', devices: [] };

  const running = await runningEmulators(executor);
  const avd = ({ adwId, name }: NamedForAdwId): AdwAvd => ({ platform: Platform.Android, adwId, name, serial: running.get(name) ?? null });
  return { kind: 'listed', devices: named.map(avd) };
}

function adwSimulator(simulator: tools.ListedSimulator): readonly AdwSimulator[] {
  const adwId = tools.adwIdOfDeviceName(simulator.name);
  if (adwId === null) return [];
  return [{ platform: Platform.Ios, adwId, name: simulator.name, udid: simulator.udid, booted: !tools.isShutDown(simulator) }];
}

async function listIos(executor: DeviceExecutor): Promise<DeviceListing> {
  const listed = await executor.run(tools.listSimulators);
  if (listed.exitCode !== 0) return listingFailure(tools.listSimulators, listed);

  const simulators = tools.simulatorsIn(listed.output);
  if (simulators === null) return { kind: 'failed', message: `"${tools.listSimulators.argv.join(' ')}" printed no device list that could be read` };
  return { kind: 'listed', devices: simulators.flatMap(adwSimulator) };
}

/** The two listings run side by side. An executor that rejects is not handled here: it breaks the executor's own contract. */
export async function listAdwDevices({ executor }: DeviceInventoryDeps): Promise<DeviceInventory> {
  const [android, ios] = await Promise.all([listAndroid(executor), listIos(executor)]);
  return { [Platform.Android]: android, [Platform.Ios]: ios };
}

// An answer that adb cannot give does not say that the emulator has gone.
async function hasLeftAdb(executor: DeviceExecutor, serial: string): Promise<boolean> {
  const attached = await executor.run(tools.listAttachedDevices);
  return attached.exitCode === 0 && !tools.emulatorSerialsIn(attached.output).includes(serial);
}

async function awaitEmulatorGone(serial: string, { executor, clock }: DeviceInventoryDeps): Promise<boolean> {
  const deadline = clock.now().getTime() + EMULATOR_EXIT_TIMEOUT_MS;
  let gone = await hasLeftAdb(executor, serial);
  while (!gone && clock.now().getTime() < deadline) {
    await clock.sleep(BOOT_POLL_INTERVAL_MS);
    gone = await hasLeftAdb(executor, serial);
  }
  return gone;
}

async function removeAvd({ name, serial }: AdwAvd, deps: DeviceInventoryDeps): Promise<readonly string[]> {
  if (serial === null) return failureOf(deps.executor, tools.deleteAvd(name));

  const killed = await failureOf(deps.executor, tools.killEmulator(serial));
  // avdmanager will not delete an AVD whose emulator is still running, so that AVD is left for the next pass.
  if (!(await awaitEmulatorGone(serial, deps))) {
    return [...killed, `The emulator ${serial} was still running ${seconds(EMULATOR_EXIT_TIMEOUT_MS)}s after "adb emu kill", so the AVD is left for the next pass`];
  }
  return [...killed, ...(await failureOf(deps.executor, tools.deleteAvd(name)))];
}

// A failed shutdown does not spare the simulator the deletion, as in the lifecycle's teardown.
async function removeSimulator({ udid, booted }: AdwSimulator, executor: DeviceExecutor): Promise<readonly string[]> {
  const shutDown = booted ? await failureOf(executor, tools.shutDownSimulator(udid)) : [];
  return [...shutDown, ...(await failureOf(executor, tools.deleteSimulator(udid)))];
}

const failuresOfRemoving = (device: AdwDevice, deps: DeviceInventoryDeps): Promise<readonly string[]> =>
  device.platform === Platform.Android ? removeAvd(device, deps) : removeSimulator(device, deps.executor);

/** Shuts the device down and then deletes it, as the lifecycle's teardown does; a device that is not running is only deleted. Never rejects. */
export async function removeAdwDevice(device: AdwDevice, deps: DeviceInventoryDeps): Promise<DeviceRemoval> {
  try {
    return { device, failures: await failuresOfRemoving(device, deps) };
  } catch (error) {
    return { device, failures: [String(error)] };
  }
}
