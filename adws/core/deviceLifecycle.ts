/**
 * Gives a workflow its own Android emulator and iOS simulator for as long as a piece of work needs them, and removes
 * both again whatever happened. Each device is booted in attempts, and a device that does not come up is an outcome,
 * not an error. Every effect goes through the injected executor, so no SDK is needed to test it.
 */

import { Platform } from './applicationType';
import {
  attemptLabel,
  bringUpAndroid,
  bringUpIos,
  tearDownAndroid,
  tearDownIos,
  type AndroidDevice,
  type BringUp,
  type DeviceLifecycleError,
  type IosSimulator,
  type Session,
} from './deviceBringUp';
import * as tools from './deviceCommands';
import { systemDeviceExecutor, type DeviceExecutor } from './deviceExecutor';
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

/** A device that did not come up: the output holds, per attempt, what the attempt reported and what the device printed. */
export type DeviceFailure =
  | { readonly kind: 'boot_failed'; readonly platform: Platform; readonly attempts: number; readonly output: string }
  | { readonly kind: 'tool_missing'; readonly platform: Platform; readonly tool: tools.HostTool; readonly output: string };

export type DeviceOutcome<T> = { readonly kind: 'ready'; readonly result: T } | DeviceFailure;

export { BOOT_POLL_INTERVAL_MS, EMULATOR_EXIT_TIMEOUT_MS } from './deviceBringUp';
export {
  CONSOLE_PORT_COUNT,
  DEVICE_BOOT_TIMEOUT_MS,
  DEVICE_COMMAND_TIMEOUT_MS,
  DEVICE_NAME_PREFIX,
  FIRST_CONSOLE_PORT,
  HostTool,
  MAX_BOOT_ATTEMPTS,
  POLL_COMMAND_TIMEOUT_MS,
  deviceNameFor,
  emulatorConsolePortCandidates,
} from './deviceCommands';

// The emulator listens on the loopback address, and on macOS a bind to the wildcard address can succeed beside it.
const probeLoopback = (port: number): Promise<boolean> => isPortAvailable(port, '127.0.0.1');

const timerClock: WaitClock = { now: () => new Date(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) };

const DEFAULT_DEPS: DeviceLifecycleDeps = { executor: systemDeviceExecutor, clock: timerClock, isPortAvailable: probeLoopback };

type Settled<Device> = { readonly kind: 'ready'; readonly device: Device } | { readonly kind: 'failed'; readonly failure: DeviceFailure };

interface Attempts<Device> {
  readonly platform: Platform;
  readonly bringUp: (attempt: number) => Promise<BringUp<Device>>;
  readonly tearDown: (device: Device | null) => Promise<void>;
}

function combinedOutput(failed: readonly DeviceLifecycleError[]): string {
  const block = ({ message, output }: DeviceLifecycleError, index: number): string => {
    const heading = `Attempt ${index + 1} of ${tools.MAX_BOOT_ATTEMPTS}: ${message}`;
    return output.trimEnd() === '' ? heading : `${heading}\n${output.trimEnd()}`;
  };
  return failed.map(block).join('\n\n');
}

function recordFailure(record: DeviceRequest['record'], attempt: number, { message, missingTool }: DeviceLifecycleError): void {
  const position = attemptLabel(attempt);
  if (missingTool !== null) {
    record(`${message} (${position}); ${missingTool} is not on the host's PATH, so the boot is not tried again`, 'error');
    return;
  }
  if (attempt < tools.MAX_BOOT_ATTEMPTS) {
    record(`${message} (${position}); trying again`, 'warn');
    return;
  }
  record(`${message} (${position}); giving up`, 'error');
}

/**
 * Never rejects. What a failed attempt created is removed before the next attempt reuses its names and its port, and
 * before the outcome is read. A missing tool ends the attempts at once: it is the host's, and the host does not change.
 */
async function bringUpInAttempts<Device>({ platform, bringUp, tearDown }: Attempts<Device>, record: DeviceRequest['record']): Promise<Settled<Device>> {
  const failed: DeviceLifecycleError[] = [];
  for (let attempt = 1; attempt <= tools.MAX_BOOT_ATTEMPTS; attempt++) {
    const result = await bringUp(attempt);
    if (result.kind === 'ready') return result;

    failed.push(result.error);
    recordFailure(record, attempt, result.error);
    await tearDown(result.device);
    const tool = result.error.missingTool;
    if (tool !== null) return { kind: 'failed', failure: { kind: 'tool_missing', platform, tool, output: combinedOutput(failed) } };
  }
  return { kind: 'failed', failure: { kind: 'boot_failed', platform, attempts: failed.length, output: combinedOutput(failed) } };
}

// A tool that is missing first, because it is what the operator can act on; then Android's failure, then iOS's.
function reportedFailure(...settled: ReadonlyArray<Settled<unknown>>): DeviceFailure {
  const failures = settled.flatMap(result => (result.kind === 'failed' ? [result.failure] : []));
  return failures.find(failure => failure.kind === 'tool_missing') ?? failures[0];
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
 * Each device is booted in up to `MAX_BOOT_ATTEMPTS` attempts. A device that does not come up in them, or a host tool
 * that is missing, is not thrown but returned, as `boot_failed` or `tool_missing`, after everything created has been
 * removed: the callback does not run. A callback that throws rejects with its own error, after the same teardown.
 * A teardown command that fails is recorded as a warning and never thrown, so the callback's error, or its result,
 * comes out unchanged.
 */
export async function withDevices<T>(
  request: DeviceRequest,
  work: (devices: DeviceEnvironment) => Promise<T>,
  deps: Partial<DeviceLifecycleDeps> = {},
): Promise<DeviceOutcome<T>> {
  const session: Session = { name: tools.deviceNameFor(request.adwId), request: { ...request, record: quietly(request.record) }, deps: { ...DEFAULT_DEPS, ...deps } };
  const { record } = session.request;

  // Neither loop rejects, so both have settled, and left nothing running unseen, by the time either is read.
  const [android, ios] = await Promise.all([
    bringUpInAttempts<AndroidDevice>(
      { platform: Platform.Android, bringUp: attempt => bringUpAndroid(session, attempt), tearDown: device => tearDownAndroid(device, session) },
      record,
    ),
    bringUpInAttempts<IosSimulator>(
      { platform: Platform.Ios, bringUp: attempt => bringUpIos(session, attempt), tearDown: device => tearDownIos(device, session) },
      record,
    ),
  ]);
  try {
    if (android.kind === 'failed' || ios.kind === 'failed') return reportedFailure(android, ios);
    return { kind: 'ready', result: await work({ ADW_ANDROID_AVD: android.device.avd, ADW_ANDROID_SERIAL: android.device.serial, ADW_IOS_UDID: ios.device.udid }) };
  } finally {
    // A device that failed has been removed by its attempts already.
    await Promise.all([
      tearDownAndroid(android.kind === 'ready' ? android.device : null, session),
      tearDownIos(ios.kind === 'ready' ? ios.device : null, session),
    ]);
  }
}
