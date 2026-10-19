/**
 * One attempt to bring up each device, and each device's teardown: the commands and the waits of the device lifecycle,
 * over the injected executor. How many attempts a device gets, and what a failed one means, is the lifecycle's.
 */

import { Platform } from './applicationType';
import * as tools from './deviceCommands';
import type { DeviceCommand, DeviceCommandResult, DeviceExecutor, DeviceProcess } from './deviceExecutor';
import type { DeviceLifecycleDeps, DeviceRequest } from './deviceLifecycle';
import type { WaitClock } from './rateLimitWaitPolicy';

/** What ends one attempt. A missing tool is a fact about the host, which another attempt cannot change. */
export class DeviceLifecycleError extends Error {
  readonly name = 'DeviceLifecycleError';
  constructor(readonly platform: Platform, message: string, readonly output: string, readonly missingTool: tools.HostTool | null = null) {
    super(message);
  }
}

export const BOOT_POLL_INTERVAL_MS = 2_000;
export const EMULATOR_EXIT_TIMEOUT_MS = 30_000;

const seconds = (ms: number): string => (ms / 1000).toFixed(1);

export const attemptLabel = (attempt: number): string => `attempt ${attempt} of ${tools.MAX_BOOT_ATTEMPTS}`;

async function allocateConsolePort(adwId: string, portIsFree: DeviceLifecycleDeps['isPortAvailable']): Promise<number | null> {
  for (const port of tools.emulatorConsolePortCandidates(adwId)) {
    if ((await portIsFree(port)) && (await portIsFree(port + 1))) return port;
  }
  return null;
}

function noFreeConsolePort(): DeviceLifecycleError {
  const lastPort = tools.FIRST_CONSOLE_PORT + 2 * (tools.CONSOLE_PORT_COUNT - 1);
  return new DeviceLifecycleError(
    Platform.Android,
    `No console port is free for the Android emulator: every even port from ${tools.FIRST_CONSOLE_PORT} to ${lastPort}, or the one above it, is in use`,
    '',
  );
}

export interface Session {
  readonly name: string;
  readonly request: DeviceRequest;
  readonly deps: DeviceLifecycleDeps;
}

interface Ran extends DeviceCommandResult {
  readonly command: string;
  readonly ok: boolean;
}

async function execute(executor: DeviceExecutor, command: DeviceCommand): Promise<Ran> {
  const result = await executor.run(command);
  return { ...result, command: command.argv.join(' '), ok: result.exitCode === 0 };
}

async function runTeardownCommand(executor: DeviceExecutor, command: DeviceCommand): Promise<readonly Ran[]> {
  const ran = await execute(executor, command);
  return ran.ok ? [] : [ran];
}

function because(summary: string, { command, exitCode, output }: Ran): string {
  const status = exitCode === null ? 'no exit code' : `exit code ${exitCode}`;
  return `${summary}: "${command}" failed with ${status}: ${tools.lastLine(output)}`;
}

async function requireSuccess(platform: Platform, summary: string, executor: DeviceExecutor, command: DeviceCommand): Promise<string> {
  const ran = await execute(executor, command);
  if (!ran.ok) throw new DeviceLifecycleError(platform, because(summary, ran), ran.output, tools.missingToolOf(command, ran));
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

export interface AndroidDevice {
  readonly avd: string;
  readonly serial: string;
  /** Null until the emulator has been started. */
  readonly emulator: TrackedProcess | null;
}

export interface IosSimulator {
  readonly udid: string;
  /** Whether the boot was issued: a simulator that never booted is deleted without being shut down. */
  readonly booted: boolean;
}

// Not a rejection: the bring-up answers with what it had created by then, so that the teardown removes all of it.
export type BringUp<Device> =
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

/** What the attempt knows by the time the emulator has failed it: adb's last answer, then the last lines the emulator wrote. */
async function emulatorFailure(name: string, serial: string, emulator: TrackedProcess, wait: Extract<BootWait, { ready: false }>, outputPath: string): Promise<DeviceLifecycleError> {
  // Read now: the next attempt starts the emulator again, and the output file is rewritten from its start.
  const printed = tools.lastLines(await emulator.handle.output(), tools.EMULATOR_OUTPUT_LINES);
  const output = [wait.output.trimEnd(), printed].filter(part => part !== '').join('\n');
  const missingTool = emulator.hasExited() && emulator.handle.programMissing() ? tools.HostTool.Emulator : null;
  const message = `The Android emulator "${name}" (${serial}) ${wait.problem}; its output is in ${outputPath}`;
  return new DeviceLifecycleError(Platform.Android, message, output, missingTool);
}

export async function bringUpAndroid({ name, request, deps }: Session, attempt: number): Promise<BringUp<AndroidDevice>> {
  const { deviceSource } = request;
  let device: AndroidDevice | null = null;
  try {
    // Probed on every attempt: a port that another workflow has taken since the last one is skipped.
    const port = await allocateConsolePort(request.adwId, deps.isPortAvailable);
    if (port === null) throw noFreeConsolePort();
    const serial = `emulator-${port}`;

    request.record(
      `Creating the Android AVD "${name}" (${deviceSource.androidSystemImage}, ${deviceSource.androidDeviceProfile}) on console port ${port} (${attemptLabel(attempt)})`,
      'info',
    );
    await requireSuccess(Platform.Android, `The Android AVD "${name}" could not be created`, deps.executor, tools.createAvd(name, deviceSource));
    device = { avd: name, serial, emulator: null };
    // A running adb server is told about an emulator as it starts, while a server started later scans only ports 5555–5585.
    await requireSuccess(Platform.Android, 'The adb server could not be started', deps.executor, tools.startAdbServer);

    const bootStart = deps.clock.now().getTime();
    const emulator = track(deps.executor.start(tools.emulatorArgv(name, port), request.emulatorOutputPath));
    device = { avd: name, serial, emulator };

    const wait = await awaitAndroidBoot(serial, emulator, bootStart, deps);
    if (!wait.ready) throw await emulatorFailure(name, serial, emulator, wait, request.emulatorOutputPath);
    request.record(`The Android emulator "${name}" (${serial}) booted in ${seconds(deps.clock.now().getTime() - bootStart)}s`, 'info');
    return { kind: 'ready', device };
  } catch (error) {
    return { kind: 'failed', device, error: lifecycleError(Platform.Android, error) };
  }
}

export async function bringUpIos({ name, request, deps }: Session, attempt: number): Promise<BringUp<IosSimulator>> {
  const { deviceSource } = request;
  let device: IosSimulator | null = null;
  try {
    request.record(`Creating the iOS simulator "${name}" (${deviceSource.iosDeviceType}, ${deviceSource.iosRuntime}) (${attemptLabel(attempt)})`, 'info');
    const created = await requireSuccess(Platform.Ios, `The iOS simulator "${name}" could not be created`, deps.executor, tools.createSimulator(name, deviceSource));
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

  const failures = await runTeardownCommand(deps.executor, tools.killEmulator(serial));
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

export async function tearDownAndroid(device: AndroidDevice | null, session: Session): Promise<void> {
  if (device === null) return;
  const shutDown = await shutDownEmulator(device, session);
  const deleted = await runTeardownCommand(session.deps.executor, tools.deleteAvd(device.avd));
  reportRemoval(session.request.record, `the Android AVD "${device.avd}" (${device.serial})`, [...shutDown, ...deleted]);
}

export async function tearDownIos(device: IosSimulator | null, { name, request, deps }: Session): Promise<void> {
  if (device === null) return;
  const shutDown = device.booted ? await runTeardownCommand(deps.executor, tools.shutDownSimulator(device.udid)) : [];
  const deleted = await runTeardownCommand(deps.executor, tools.deleteSimulator(device.udid));
  reportRemoval(request.record, `the iOS simulator "${name}" (${device.udid})`, [...shutDown, ...deleted]);
}
