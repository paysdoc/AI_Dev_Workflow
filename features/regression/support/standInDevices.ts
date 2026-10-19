/**
 * A stand-in for the host's device tools, `avdmanager`, `emulator`, `adb` and `xcrun simctl`: the real device lifecycle runs
 * over an executor that answers like a host on which the emulator and the simulator boot, or like one on which they do not,
 * and records each command it is given with the time it was issued and what it answered, so that no scenario reaches a real
 * SDK or creates a real device. It can also hold devices that workflows left behind, which the device janitor lists, shuts
 * down and deletes over it. No hooks and no steps: any step file may import it.
 */

import type { DeviceCommandResult, DeviceExecutor, DeviceProcess } from '../../../adws/core/deviceExecutor.ts';
import { withDevices } from '../../../adws/core/deviceLifecycle.ts';
import type { WaitClock } from '../../../adws/core/rateLimitWaitPolicy.ts';
import type { ScenarioTestPhaseDeps } from '../../../adws/phases/scenarioTestPhase.ts';
import { leftoverHolding, type StandInHeldDevices, type StandInLeftoverDevice } from './standInLeftoverDevices.ts';

export type { StandInHeldDevices, StandInHeldSimulator, StandInLeftoverDevice } from './standInLeftoverDevices.ts';

export const STAND_IN_UDID = '9B3D5F71-0A2C-4E86-8D14-C7E2A5B90F63';

export interface StandInDeviceCommand {
  readonly argv: readonly string[];
  /** When the command was issued, in milliseconds since the epoch, as each run of a stand-in scenario command records its own. */
  readonly at: number;
  /** What the host answered to a command that was run, `null` for a program that is not on the host; absent for a started process. */
  readonly exitCode?: number | null;
}

export interface StandInDeviceOptions {
  /** What `xcrun simctl create` prints. */
  readonly udid?: string;
  /** How many reads of `sys.boot_completed` come back empty, as a booting emulator's do, before one says `1`; `Infinity` for every read. */
  readonly emptyBootReads?: number;
  /** How many started emulators exit before they are ready; `Infinity` for every one. */
  readonly emulatorEarlyExits?: number;
  /** What each started emulator printed to its output file. */
  readonly emulatorOutput?: string;
  /** How many boots of the simulator fail before one succeeds; `Infinity` for every one. */
  readonly simulatorBootFailures?: number;
  /** What a failing boot of the simulator prints, by attempt; the last text answers the attempts after it. */
  readonly simulatorBootOutputs?: readonly string[];
  /** Programs that are not on the host. */
  readonly missingPrograms?: readonly string[];
  /** The AVDs and simulators the host holds when the scenario begins, which its tools list, shut down and delete. */
  readonly devices?: readonly StandInLeftoverDevice[];
  /** What a command prints when it fails with exit code 1, by the command as issued, `argv` joined by spaces. */
  readonly failing?: Readonly<Record<string, string>>;
}

export interface StandInDeviceExecutor {
  readonly executor: DeviceExecutor;
  /** Each command, a started process included, in the order issued. */
  readonly commands: StandInDeviceCommand[];
  /** The serial of each emulator that was started and has not yet quit. */
  runningEmulators(): readonly string[];
  /** The devices the host held when the scenario began. */
  readonly leftovers: StandInHeldDevices;
  /** The devices it holds now. */
  held(): StandInHeldDevices;
}

export interface StandInDeviceHost {
  readonly withDevices: ScenarioTestPhaseDeps['withDevices'];
  readonly commands: readonly StandInDeviceCommand[];
  /** What the host's device tools run over, for a caller that is not the device lifecycle. */
  readonly executor: DeviceExecutor;
  readonly clock: WaitClock;
  runningEmulators(): readonly string[];
  readonly leftovers: StandInHeldDevices;
  held(): StandInHeldDevices;
}

const OK: DeviceCommandResult = { exitCode: 0, output: '' };

/** The console port an emulator was started on, given with `-port`. */
function serialStartedWith(argv: readonly string[]): string {
  return `emulator-${argv[argv.indexOf('-port') + 1]}`;
}

/** As the real executor answers for a program that is not on the host. */
const notInstalled = (program: string): DeviceCommandResult => ({ exitCode: null, output: `Error: spawn ${program} ENOENT`, programMissing: true });

/** The time a wait runs through is the clock's: `sleep` returns at once and moves `now` forward, so that a wait reaches its deadline in no time. */
export function steppingClock(): WaitClock {
  let current = Date.now();
  return { now: () => new Date(current), sleep: async (ms) => { current += ms; } };
}

export function standInDeviceExecutor(options: StandInDeviceOptions = {}): StandInDeviceExecutor {
  const { udid = STAND_IN_UDID, emptyBootReads = 0, emulatorEarlyExits = 0, emulatorOutput = '', simulatorBootFailures = 0, simulatorBootOutputs = [''], missingPrograms = [], devices = [], failing = {} } = options;
  const holding = leftoverHolding(devices);
  const leftovers = holding.held();
  const commands: StandInDeviceCommand[] = [];
  const quitEmulator = new Map<string, () => void>();
  const running = new Set<string>();
  const bootReads = new Map<string, number>();
  let emulatorStarts = 0;
  let simulatorBoots = 0;

  function answerAdb([, , serial, ...verb]: readonly string[]): DeviceCommandResult {
    const command = verb.join(' ');
    if (command === 'get-state') return { exitCode: 0, output: 'device\n' };
    if (command === 'emu kill') quitEmulator.get(serial)?.();
    if (command !== 'shell getprop sys.boot_completed') return OK;

    const reads = (bootReads.get(serial) ?? 0) + 1;
    bootReads.set(serial, reads);
    return { exitCode: 0, output: reads <= emptyBootReads ? '\n' : '1\n' };
  }

  function answerSimulatorBoot(): DeviceCommandResult {
    simulatorBoots += 1;
    if (simulatorBoots > simulatorBootFailures) return OK;
    const printed = simulatorBootOutputs[Math.min(simulatorBoots, simulatorBootOutputs.length) - 1];
    return { exitCode: 1, output: `${printed}\n` };
  }

  function answer(argv: readonly string[]): DeviceCommandResult {
    if (missingPrograms.includes(argv[0])) return notInstalled(argv[0]);
    const failure = failing[argv.join(' ')];
    if (failure !== undefined) return { exitCode: 1, output: `${failure}\n` };
    // The devices the host held to begin with are answered for first; the commands of the lifecycle's own devices are not about them.
    const aboutLeftovers = holding.answer(argv);
    if (aboutLeftovers !== undefined) return aboutLeftovers;
    if (argv[0] === 'adb' && argv[1] === '-s') return answerAdb(argv);
    const words = argv.slice(0, 3).join(' ');
    if (words === 'xcrun simctl create') return { exitCode: 0, output: `${udid}\n` };
    return words === 'xcrun simctl boot' ? answerSimulatorBoot() : OK;
  }

  function startEmulator(argv: readonly string[]): DeviceProcess {
    if (missingPrograms.includes(argv[0])) return { exited: Promise.resolve(null), kill: () => undefined, programMissing: () => true, output: async () => '' };

    emulatorStarts += 1;
    if (emulatorStarts <= emulatorEarlyExits) return { exited: Promise.resolve(1), kill: () => undefined, programMissing: () => false, output: async () => emulatorOutput };

    const serial = serialStartedWith(argv);
    running.add(serial);
    const exited = new Promise<number | null>(resolve => {
      quitEmulator.set(serial, () => {
        running.delete(serial);
        resolve(0);
      });
    });
    return { exited, kill: () => quitEmulator.get(serial)?.(), programMissing: () => false, output: async () => '' };
  }

  const executor: DeviceExecutor = {
    run: async ({ argv }) => {
      const result = answer(argv);
      commands.push({ argv, at: Date.now(), exitCode: result.exitCode });
      return result;
    },
    start: (argv): DeviceProcess => {
      commands.push({ argv, at: Date.now() });
      return startEmulator(argv);
    },
  };
  return { executor, commands, runningEmulators: () => [...running], leftovers, held: holding.held };
}

let latest: StandInDeviceHost | undefined;

/** The host the scenario most recently installed, or the harness did in its place; `undefined` when there is none. */
export function lastStandInDeviceHost(): StandInDeviceHost | undefined {
  return latest;
}

/** Safe to call twice: a scenario that carries the tags of two features runs the hooks of both. */
export function resetStandInDeviceHost(): void {
  latest = undefined;
}

export function standInDeviceHost(options: StandInDeviceOptions = {}): StandInDeviceHost {
  const { executor, commands, runningEmulators, leftovers, held } = standInDeviceExecutor(options);
  const clock = steppingClock();
  const deps = { executor, clock, isPortAvailable: async () => true };
  latest = { withDevices: (request, work) => withDevices(request, work, deps), commands, executor, clock, runningEmulators, leftovers, held };
  return latest;
}
