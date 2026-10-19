/**
 * Gives a workflow its own Android emulator and iOS simulator for as long as a piece of work needs them, and removes
 * both again whatever happened. Every effect goes through the injected executor, so no SDK is needed to test it.
 */

import { Platform } from './applicationType';
import * as tools from './deviceCommands';
import { systemDeviceExecutor, type DeviceCommand, type DeviceCommandResult, type DeviceExecutor, type DeviceProcess } from './deviceExecutor';
import type { DeviceSource } from './deviceSourceConfig';
import type { LogLevel } from './logger';
import { isPortAvailable } from './portAllocator';
import type { WaitClock } from './rateLimitWaitPolicy';

export interface DeviceEnvironment {
  readonly ADW_ANDROID_AVD: string;
  readonly ADW_ANDROID_SERIAL: string;
  readonly ADW_IOS_UDID: string;
}

export interface DeviceRequest {
  readonly adwId: string;
  readonly deviceSource: DeviceSource;
  readonly emulatorOutputPath: string;
  /** The run log: every event of the devices goes here, and nowhere else. */
  readonly record: (message: string, level: LogLevel) => void;
}

export interface DeviceLifecycleDeps {
  readonly executor: DeviceExecutor;
  readonly clock: WaitClock;
  readonly isPortAvailable: (port: number) => Promise<boolean>;
}

export class DeviceLifecycleError extends Error {
  readonly name = 'DeviceLifecycleError';
  constructor(readonly platform: Platform, message: string, readonly output: string) {
    super(message);
  }
}

export { CONSOLE_PORT_COUNT, DEVICE_BOOT_TIMEOUT_MS, DEVICE_COMMAND_TIMEOUT_MS, DEVICE_NAME_PREFIX, FIRST_CONSOLE_PORT, POLL_COMMAND_TIMEOUT_MS, deviceNameFor, emulatorConsolePortCandidates } from './deviceCommands';
export const BOOT_POLL_INTERVAL_MS = 2_000;
export const EMULATOR_EXIT_TIMEOUT_MS = 30_000;

const seconds = (ms: number): string => (ms / 1000).toFixed(1);

// The emulator listens on the loopback address, and on macOS a bind to the wildcard address can succeed beside it.
const probeLoopback = (port: number): Promise<boolean> => isPortAvailable(port, '127.0.0.1');

const timerClock: WaitClock = { now: () => new Date(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };

const DEFAULT_DEPS: DeviceLifecycleDeps = { executor: systemDeviceExecutor, clock: timerClock, isPortAvailable: probeLoopback };

async function allocateConsolePort(adwId: string, portIsFree: DeviceLifecycleDeps['isPortAvailable']): Promise<number | null> {
  for (const port of tools.emulatorConsolePortCandidates(adwId)) {
    if ((await portIsFree(port)) && (await portIsFree(port + 1))) return port;
  }
  return null;
}

interface Session {
  readonly name: string;
  readonly request: DeviceRequest;
  readonly deps: DeviceLifecycleDeps;
}

interface Ran extends DeviceCommandResult {
  readonly command: string;
  readonly ok: boolean;
}

async function execute(executor: DeviceExecutor, command: DeviceCommand): Promise<Ran> {
  const { exitCode, output } = await executor.run(command);
  return { command: command.argv.join(' '), exitCode, output, ok: exitCode === 0 };
}

async function attempt(executor: DeviceExecutor, command: DeviceCommand): Promise<readonly Ran[]> {
  const ran = await execute(executor, command);
  return ran.ok ? [] : [ran];
}

function because(summary: string, { command, exitCode, output }: Ran): string {
  const status = exitCode === null ? 'no exit code' : `exit code ${exitCode}`;
  return `${summary}: "${command}" failed with ${status}: ${tools.lastLine(output)}`;
}

async function requireSuccess(platform: Platform, summary: string, executor: DeviceExecutor, command: DeviceCommand): Promise<string> {
  const ran = await execute(executor, command);
  if (!ran.ok) throw new DeviceLifecycleError(platform, because(summary, ran), ran.output);
  return ran.output;
}

interface TrackedProcess {
  readonly handle: DeviceProcess;
  hasExited(): boolean;
}

function track(handle: DeviceProcess): TrackedProcess {
  let exited = false;
  void handle.exited.then(() => {
    exited = true;
  });
  return { handle, hasExited: () => exited };
}

interface AndroidDevice {
  readonly avd: string;
  readonly serial: string;
  /** Null until the emulator has been started. */
  readonly emulator: TrackedProcess | null;
}

interface IosSimulator {
  readonly udid: string;
  /** Whether the boot was issued: a simulator that never booted is deleted without being shut down. */
  readonly booted: boolean;
}

// Not a rejection: the bring-up answers with what it had created by then, so that the teardown removes all of it.
type BringUp<Device> =
  | { readonly kind: 'ready'; readonly device: Device }
  | { readonly kind: 'failed'; readonly device: Device | null; readonly error: DeviceLifecycleError };

const lifecycleError = (platform: Platform, error: unknown): DeviceLifecycleError =>
  error instanceof DeviceLifecycleError ? error : new DeviceLifecycleError(platform, String(error), '');

type BootWait = { readonly ready: true } | { readonly ready: false; readonly problem: string; readonly output: string };

async function waitFor(probe: () => Promise<{ ready: boolean; output: string }>, emulator: TrackedProcess, deadline: number, clock: WaitClock): Promise<BootWait> {
  let output = '';
  while (clock.now().getTime() < deadline) {
    if (emulator.hasExited()) return { ready: false, problem: 'exited before it was ready', output };
    const answer = await probe();
    if (answer.ready) return { ready: true };
    output = answer.output;
    await clock.sleep(BOOT_POLL_INTERVAL_MS);
  }
  return { ready: false, problem: `was not ready ${seconds(tools.DEVICE_BOOT_TIMEOUT_MS)}s after it started`, output };
}

async function awaitAndroidBoot(serial: string, emulator: TrackedProcess, bootStart: number, { executor, clock }: DeviceLifecycleDeps): Promise<BootWait> {
  const answers = (args: string[], expected: string) => async () => {
    const { output } = await executor.run(tools.pollEmulator(serial, ...args));
    return { ready: tools.lastLine(output) === expected, output };
  };
  const deadline = bootStart + tools.DEVICE_BOOT_TIMEOUT_MS;
  const state = await waitFor(answers(['get-state'], 'device'), emulator, deadline, clock);
  if (!state.ready) return state;
  return waitFor(answers(['shell', 'getprop', 'sys.boot_completed'], '1'), emulator, deadline, clock);
}

async function bringUpAndroid({ name, request, deps }: Session, port: number): Promise<BringUp<AndroidDevice>> {
  const serial = `emulator-${port}`;
  let device: AndroidDevice | null = null;
  try {
    await requireSuccess(Platform.Android, `The Android AVD "${name}" could not be created`, deps.executor, tools.createAvd(name, request.deviceSource));
    device = { avd: name, serial, emulator: null };
    // A running adb server is told about an emulator as it starts, while a server started later scans only ports 5555–5585.
    await requireSuccess(Platform.Android, 'The adb server could not be started', deps.executor, tools.startAdbServer);

    const bootStart = deps.clock.now().getTime();
    const emulator = track(deps.executor.start(tools.emulatorArgv(name, port), request.emulatorOutputPath));
    device = { avd: name, serial, emulator };

    const wait = await awaitAndroidBoot(serial, emulator, bootStart, deps);
    if (!wait.ready) {
      throw new DeviceLifecycleError(Platform.Android, `The Android emulator "${name}" (${serial}) ${wait.problem}; its output is in ${request.emulatorOutputPath}`, wait.output);
    }
    request.record(`The Android emulator "${name}" (${serial}) booted in ${seconds(deps.clock.now().getTime() - bootStart)}s`, 'info');
    return { kind: 'ready', device };
  } catch (error) {
    return { kind: 'failed', device, error: lifecycleError(Platform.Android, error) };
  }
}

async function bringUpIos({ name, request, deps }: Session): Promise<BringUp<IosSimulator>> {
  let device: IosSimulator | null = null;
  try {
    const created = await requireSuccess(Platform.Ios, `The iOS simulator "${name}" could not be created`, deps.executor, tools.createSimulator(name, request.deviceSource));
    const udid = tools.lastUdid(created);
    if (udid === undefined) throw new DeviceLifecycleError(Platform.Ios, `The iOS simulator "${name}" could not be created: "xcrun simctl create" printed no UDID`, created);

    const bootStart = deps.clock.now().getTime();
    device = { udid, booted: false };
    await requireSuccess(Platform.Ios, `The iOS simulator "${name}" (${udid}) could not be booted`, deps.executor, tools.bootSimulator(udid));
    device = { udid, booted: true };
    await requireSuccess(Platform.Ios, `The iOS simulator "${name}" (${udid}) did not finish booting`, deps.executor, tools.awaitSimulatorBoot(udid));

    request.record(`The iOS simulator "${name}" (${udid}) booted in ${seconds(deps.clock.now().getTime() - bootStart)}s`, 'info');
    return { kind: 'ready', device };
  } catch (error) {
    return { kind: 'failed', device, error: lifecycleError(Platform.Ios, error) };
  }
}

async function awaitExit(emulator: TrackedProcess, clock: WaitClock): Promise<boolean> {
  const deadline = clock.now().getTime() + EMULATOR_EXIT_TIMEOUT_MS;
  while (!emulator.hasExited() && clock.now().getTime() < deadline) {
    await clock.sleep(BOOT_POLL_INTERVAL_MS);
  }
  return emulator.hasExited();
}

// avdmanager will not delete an AVD whose emulator is still running, so the AVD is deleted only once the emulator has gone.
async function shutDownEmulator({ avd, serial, emulator }: AndroidDevice, { request, deps }: Session): Promise<readonly Ran[]> {
  if (emulator === null || emulator.hasExited()) return [];

  const failures = await attempt(deps.executor, tools.killEmulator(serial));
  if (!(await awaitExit(emulator, deps.clock))) {
    request.record(`The Android emulator "${avd}" (${serial}) was still running ${seconds(EMULATOR_EXIT_TIMEOUT_MS)}s after "adb emu kill"; ending its process`, 'warn');
    emulator.handle.kill();
    await awaitExit(emulator, deps.clock);
  }
  return failures;
}

function reportRemoval(record: DeviceRequest['record'], description: string, failures: readonly Ran[]): void {
  if (failures.length === 0) {
    record(`Removed ${description}`, 'info');
    return;
  }
  failures.forEach(failure => record(because(`Could not remove ${description}`, failure), 'warn'));
}

async function tearDownAndroid(device: AndroidDevice | null, session: Session): Promise<void> {
  if (device === null) return;
  const shutDown = await shutDownEmulator(device, session);
  const deleted = await attempt(session.deps.executor, tools.deleteAvd(device.avd));
  reportRemoval(session.request.record, `the Android AVD "${device.avd}" (${device.serial})`, [...shutDown, ...deleted]);
}

async function tearDownIos(device: IosSimulator | null, { name, request, deps }: Session): Promise<void> {
  if (device === null) return;
  const shutDown = device.booted ? await attempt(deps.executor, tools.shutDownSimulator(device.udid)) : [];
  const deleted = await attempt(deps.executor, tools.deleteSimulator(device.udid));
  reportRemoval(request.record, `the iOS simulator "${name}" (${device.udid})`, [...shutDown, ...deleted]);
}

function recordedFailure(results: ReadonlyArray<BringUp<AndroidDevice> | BringUp<IosSimulator>>, record: DeviceRequest['record']): DeviceLifecycleError {
  const errors = results.flatMap(result => (result.kind === 'failed' ? [result.error] : []));
  errors.forEach(error => record(error.message, 'error'));
  return errors[0];
}

// A log that cannot be written must not be the reason a device is left running.
const quietly = (record: DeviceRequest['record']): DeviceRequest['record'] => (message, level) => {
  try {
    record(message, level);
  } catch {
    // nothing else can be done with it
  }
};

/**
 * Teardown runs on every outcome: a callback that throws, and a device that does not come up, included. A command of it
 * that fails is recorded as a warning and never thrown, so the error of the callback, or its result, comes out unchanged.
 * A device that does not come up fails the run with a `DeviceLifecycleError`, after everything created has been removed.
 */
export async function withDevices<T>(
  request: DeviceRequest,
  work: (devices: DeviceEnvironment) => Promise<T>,
  deps: Partial<DeviceLifecycleDeps> = {},
): Promise<T> {
  const session: Session = { name: tools.deviceNameFor(request.adwId), request: { ...request, record: quietly(request.record) }, deps: { ...DEFAULT_DEPS, ...deps } };
  const { name, deps: lifecycle } = session;
  const { record, deviceSource } = session.request;

  const port = await allocateConsolePort(request.adwId, lifecycle.isPortAvailable);
  if (port === null) {
    const lastPort = tools.FIRST_CONSOLE_PORT + 2 * (tools.CONSOLE_PORT_COUNT - 1);
    const error = new DeviceLifecycleError(Platform.Android, `No console port is free for the Android emulator: every even port from ${tools.FIRST_CONSOLE_PORT} to ${lastPort}, or the one above it, is in use`, '');
    record(error.message, 'error');
    throw error;
  }
  record(
    `Creating the devices of this workflow: the Android AVD "${name}" (${deviceSource.androidSystemImage}, ${deviceSource.androidDeviceProfile}) on console port ${port}, and the iOS simulator "${name}" (${deviceSource.iosDeviceType}, ${deviceSource.iosRuntime})`,
    'info',
  );

  // Neither bring-up rejects, so both have settled, and left nothing running unseen, by the time either failure is read.
  const [android, ios] = await Promise.all([bringUpAndroid(session, port), bringUpIos(session)]);
  try {
    if (android.kind === 'failed' || ios.kind === 'failed') throw recordedFailure([android, ios], record);
    return await work({ ADW_ANDROID_AVD: android.device.avd, ADW_ANDROID_SERIAL: android.device.serial, ADW_IOS_UDID: ios.device.udid });
  } finally {
    await Promise.all([tearDownAndroid(android.device, session), tearDownIos(ios.device, session)]);
  }
}
