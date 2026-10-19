/**
 * A host for the device lifecycle to run against: an executor that records each command in the order it was issued and
 * answers like a host on which the emulator and the simulator boot, a clock that nothing waits on in real time, and a
 * probe over a set of taken ports. A script changes the host. No vitest import: any test may use it.
 */

import type { DeviceCommand, DeviceCommandResult, DeviceProcess } from '../../deviceExecutor';
import type { DeviceLifecycleDeps, DeviceRequest } from '../../deviceLifecycle';
import type { DeviceSource } from '../../deviceSourceConfig';
import type { WaitClock } from '../../rateLimitWaitPolicy';

export const TEST_UDID = '5D2E8F3A-6B41-4C7D-9E10-A3B2C4D5E6F7';

export const TEST_DEVICE_SOURCE: DeviceSource = {
  androidSystemImage: 'system-images;android-35;google_apis;arm64-v8a',
  androidDeviceProfile: 'pixel_8',
  iosDeviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16',
  iosRuntime: 'com.apple.CoreSimulator.SimRuntime.iOS-18-2',
};

export interface DeviceHostScript {
  /** How long after the emulator starts `sys.boot_completed` reads `1`; the lifecycle sees it at its next poll. */
  readonly androidBootMs: number;
  /** How long `xcrun simctl bootstatus` takes after the simulator is booted. */
  readonly iosBootMs: number;
  /** How many `get-state` answers say the device is not there yet, before one says `device`. */
  readonly pollsUntilDevice: number;
  /** How many `getprop sys.boot_completed` answers are empty, as a booting emulator's are, before one may say `1`. */
  readonly pollsUntilBootCompleted: number;
  /** The output of each command that exits 1, by the command's leading words. */
  readonly failing: Readonly<Record<string, string>>;
  /** How many issues of a command in `failing` exit 1 before it answers as a healthy host, by the same leading words. Without a count it fails every time. */
  readonly failingTimes: Readonly<Record<string, number>>;
  /** Programs that are not on the host. A command of one answers as the real executor does, and a started one has already exited. */
  readonly missingTools: readonly string[];
  readonly takenPorts: readonly number[];
  /** The emulator stays up after `adb emu kill`, and ends only when its process is killed. */
  readonly emulatorIgnoresKill: boolean;
  /** How many started emulators exit before they are ready; `Infinity` for every one. */
  readonly emulatorEarlyExits: number;
  /** What each started emulator prints to its output file. */
  readonly emulatorOutput: string;
}

const HEALTHY_HOST: DeviceHostScript = {
  androidBootMs: 0,
  iosBootMs: 0,
  pollsUntilDevice: 0,
  pollsUntilBootCompleted: 0,
  failing: {},
  failingTimes: {},
  missingTools: [],
  takenPorts: [],
  emulatorIgnoresKill: false,
  emulatorEarlyExits: 0,
  emulatorOutput: '',
};

export interface StartedEmulator {
  readonly argv: readonly string[];
  readonly outputPath: string;
  killed: boolean;
}

export interface RecordingDeviceHost {
  readonly deps: DeviceLifecycleDeps;
  /** Each command as `argv.join(' ')`, in the order issued; a started process too, and a kill of it as `kill <program>`. */
  readonly events: string[];
  /** Each line recorded for the run log, as `<level> <message>`. */
  readonly lines: string[];
  readonly runs: readonly DeviceCommand[];
  readonly started: readonly StartedEmulator[];
  readonly record: DeviceRequest['record'];
  mark(event: string): void;
  /** How much fake time has passed. */
  elapsedMs(): number;
}

const EPOCH_MS = Date.UTC(2026, 0, 1);

interface FakeClock extends WaitClock {
  until(at: number): Promise<void>;
  elapsedMs(): number;
}

// Time moves only once every chain of work has run as far as it can and waits on the clock. So two devices that boot
// at the same moment share one timeline, and each boot is as long as the script says, whichever is measured first.
function fakeClock(): FakeClock {
  let current = EPOCH_MS;
  const waiting: Array<{ readonly at: number; readonly wake: () => void }> = [];
  let pumping = false;

  async function pump(): Promise<void> {
    pumping = true;
    while (waiting.length > 0) {
      await new Promise<void>(resolve => setImmediate(resolve));
      waiting.sort((a, b) => a.at - b.at);
      const next = waiting.shift();
      if (next === undefined) break;
      current = Math.max(current, next.at);
      next.wake();
    }
    pumping = false;
  }

  const until = (at: number): Promise<void> => {
    if (at <= current) return Promise.resolve();
    return new Promise<void>(resolve => {
      waiting.push({ at, wake: resolve });
      if (!pumping) void pump();
    });
  };

  return { now: () => new Date(current), sleep: ms => until(current + ms), until, elapsedMs: () => current - EPOCH_MS };
}

interface HostState {
  readonly script: DeviceHostScript;
  readonly clock: FakeClock;
  readonly events: string[];
  readonly runs: DeviceCommand[];
  readonly started: StartedEmulator[];
  readonly timesIssued: Map<string, number>;
  readonly failuresIssued: Map<string, number>;
  readonly emulatorReadyAt: Map<string, number>;
  readonly onEmulatorKill: Map<string, () => void>;
  simulatorBootedAt: number;
}

const OK: DeviceCommandResult = { exitCode: 0, output: '' };

const isCommand = (line: string, words: string): boolean => line === words || line.startsWith(`${words} `);

function scriptedFailure({ script, failuresIssued }: HostState, line: string): string | undefined {
  const words = Object.keys(script.failing).find(candidate => isCommand(line, candidate));
  if (words === undefined) return undefined;
  const issued = (failuresIssued.get(words) ?? 0) + 1;
  failuresIssued.set(words, issued);
  return issued <= (script.failingTimes[words] ?? Infinity) ? script.failing[words] : undefined;
}

const isMissing = (host: HostState, program: string): boolean => host.script.missingTools.includes(program);

function issuedTimes(host: HostState, line: string): number {
  const times = (host.timesIssued.get(line) ?? 0) + 1;
  host.timesIssued.set(line, times);
  return times;
}

function answerAdb(host: HostState, argv: readonly string[], line: string): DeviceCommandResult {
  const [, , serial = '', ...verb] = argv;
  const command = verb.join(' ');
  const times = issuedTimes(host, line);
  if (command === 'get-state') {
    return times <= host.script.pollsUntilDevice
      ? { exitCode: 1, output: `error: device '${serial}' not found\n` }
      : { exitCode: 0, output: 'device\n' };
  }
  if (command === 'shell getprop sys.boot_completed') {
    const booted = times > host.script.pollsUntilBootCompleted && host.clock.now().getTime() >= (host.emulatorReadyAt.get(serial) ?? 0);
    return { exitCode: 0, output: booted ? '1\n' : '\n' };
  }
  if (command === 'emu kill') host.onEmulatorKill.get(serial)?.();
  return OK;
}

async function answer(host: HostState, argv: readonly string[]): Promise<DeviceCommandResult> {
  const line = argv.join(' ');
  if (isMissing(host, argv[0])) return { exitCode: null, output: `Error: spawn ${argv[0]} ENOENT`, programMissing: true };
  const failure = scriptedFailure(host, line);
  if (failure !== undefined) return { exitCode: 1, output: failure };

  if (argv[0] === 'adb' && argv[1] === '-s') return answerAdb(host, argv, line);
  if (isCommand(line, 'xcrun simctl create')) return { exitCode: 0, output: `${TEST_UDID}\n` };
  if (isCommand(line, 'xcrun simctl boot')) host.simulatorBootedAt = host.clock.now().getTime();
  if (isCommand(line, 'xcrun simctl bootstatus')) await host.clock.until(host.simulatorBootedAt + host.script.iosBootMs);
  return OK;
}

function startEmulator(host: HostState, argv: DeviceCommand['argv'], outputPath: string): DeviceProcess {
  host.events.push(argv.join(' '));
  const serial = `emulator-${argv[argv.indexOf('-port') + 1]}`;
  host.emulatorReadyAt.set(serial, host.clock.now().getTime() + host.script.androidBootMs);

  const end = { settle: (_code: number | null): void => undefined };
  const exited = new Promise<number | null>(resolve => {
    end.settle = resolve;
  });
  const missing = isMissing(host, argv[0]);
  if (missing) end.settle(null);
  if (host.started.length < host.script.emulatorEarlyExits) end.settle(1);
  if (!host.script.emulatorIgnoresKill) host.onEmulatorKill.set(serial, () => end.settle(null));

  const emulator: StartedEmulator = { argv, outputPath, killed: false };
  host.started.push(emulator);
  const kill = (): void => {
    emulator.killed = true;
    host.events.push(`kill ${argv[0]}`);
    end.settle(null);
  };
  return { exited, kill, programMissing: () => missing, output: async () => host.script.emulatorOutput };
}

export function recordingDeviceHost(script: Partial<DeviceHostScript> = {}): RecordingDeviceHost {
  const clock = fakeClock();
  const host: HostState = {
    script: { ...HEALTHY_HOST, ...script },
    clock,
    events: [],
    runs: [],
    started: [],
    timesIssued: new Map(),
    failuresIssued: new Map(),
    emulatorReadyAt: new Map(),
    onEmulatorKill: new Map(),
    simulatorBootedAt: EPOCH_MS,
  };
  const lines: string[] = [];

  const deps: DeviceLifecycleDeps = {
    executor: {
      run: (command) => {
        host.events.push(command.argv.join(' '));
        host.runs.push(command);
        return answer(host, command.argv);
      },
      start: (argv, outputPath) => startEmulator(host, argv, outputPath),
    },
    clock,
    isPortAvailable: async (port) => !host.script.takenPorts.includes(port),
  };

  return {
    deps,
    events: host.events,
    lines,
    runs: host.runs,
    started: host.started,
    record: (message, level) => {
      lines.push(`${level} ${message}`);
    },
    mark: (event) => {
      host.events.push(event);
    },
    elapsedMs: clock.elapsedMs,
  };
}

export function requestFor(adwId: string, host: RecordingDeviceHost): DeviceRequest {
  return { adwId, deviceSource: TEST_DEVICE_SOURCE, emulatorOutputPath: '/logs/android-emulator.log', record: host.record };
}

/** The console port the emulator was started on, given with `-port`. */
export function emulatorPort(host: RecordingDeviceHost, index = 0): number {
  const { argv } = host.started[index];
  return Number(argv[argv.indexOf('-port') + 1]);
}

/** The first of `steps` that does not come after the one before it in `events`, or `undefined` when they all follow in order. */
export function firstOutOfOrder(events: readonly string[], steps: readonly string[]): string | undefined {
  let from = 0;
  for (const step of steps) {
    const at = events.indexOf(step, from);
    if (at === -1) return step;
    from = at + 1;
  }
  return undefined;
}

/** The same host, except that the output of each command that starts with `words` is what `rewrite` makes of it. */
export function rewritingOutput(deps: DeviceLifecycleDeps, words: string, rewrite: (output: string) => string): DeviceLifecycleDeps {
  const run: DeviceLifecycleDeps['executor']['run'] = async (command) => {
    const result = await deps.executor.run(command);
    return command.argv.join(' ').startsWith(words) ? { ...result, output: rewrite(result.output) } : result;
  };
  return { ...deps, executor: { ...deps.executor, run } };
}
