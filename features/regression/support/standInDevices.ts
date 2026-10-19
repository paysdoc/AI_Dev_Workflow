/**
 * A stand-in for the host's device tools, `avdmanager`, `emulator`, `adb` and `xcrun simctl`: the real device lifecycle runs
 * over an executor that answers like a host on which the emulator and the simulator boot, and records each command it is
 * given with the time it was issued, so that no scenario reaches a real SDK or creates a real device. No hooks and no
 * steps: any step file may import it.
 */

import type { DeviceCommandResult, DeviceExecutor, DeviceProcess } from '../../../adws/core/deviceExecutor.ts';
import { withDevices } from '../../../adws/core/deviceLifecycle.ts';
import type { ScenarioTestPhaseDeps } from '../../../adws/phases/scenarioTestPhase.ts';

export const STAND_IN_UDID = '9B3D5F71-0A2C-4E86-8D14-C7E2A5B90F63';

export interface StandInDeviceCommand {
  readonly argv: readonly string[];
  /** When the command was issued, in milliseconds since the epoch, as each run of a stand-in scenario command records its own. */
  readonly at: number;
}

export interface StandInDeviceOptions {
  /** What `xcrun simctl create` prints. */
  readonly udid?: string;
  /** How many reads of `sys.boot_completed` come back empty, as a booting emulator's do, before one says `1`. */
  readonly emptyBootReads?: number;
}

export interface StandInDeviceExecutor {
  readonly executor: DeviceExecutor;
  /** Each command, a started process included, in the order issued. */
  readonly commands: StandInDeviceCommand[];
}

export interface StandInDeviceHost {
  readonly withDevices: ScenarioTestPhaseDeps['withDevices'];
  readonly commands: readonly StandInDeviceCommand[];
}

const OK: DeviceCommandResult = { exitCode: 0, output: '' };

/** The console port an emulator was started on, given with `-port`. */
function serialStartedWith(argv: readonly string[]): string {
  return `emulator-${argv[argv.indexOf('-port') + 1]}`;
}

export function standInDeviceExecutor({ udid = STAND_IN_UDID, emptyBootReads = 0 }: StandInDeviceOptions = {}): StandInDeviceExecutor {
  const commands: StandInDeviceCommand[] = [];
  const quitEmulator = new Map<string, () => void>();
  const bootReads = new Map<string, number>();

  function answerAdb([, , serial, ...verb]: readonly string[]): DeviceCommandResult {
    const command = verb.join(' ');
    if (command === 'get-state') return { exitCode: 0, output: 'device\n' };
    if (command === 'emu kill') quitEmulator.get(serial)?.();
    if (command !== 'shell getprop sys.boot_completed') return OK;

    const reads = (bootReads.get(serial) ?? 0) + 1;
    bootReads.set(serial, reads);
    return { exitCode: 0, output: reads <= emptyBootReads ? '\n' : '1\n' };
  }

  function answer(argv: readonly string[]): DeviceCommandResult {
    if (argv[0] === 'adb' && argv[1] === '-s') return answerAdb(argv);
    return argv.slice(0, 3).join(' ') === 'xcrun simctl create' ? { exitCode: 0, output: `${udid}\n` } : OK;
  }

  const executor: DeviceExecutor = {
    run: async ({ argv }) => {
      commands.push({ argv, at: Date.now() });
      return answer(argv);
    },
    start: (argv): DeviceProcess => {
      commands.push({ argv, at: Date.now() });
      const serial = serialStartedWith(argv);
      const exited = new Promise<number | null>(resolve => quitEmulator.set(serial, () => resolve(0)));
      return { exited, kill: () => quitEmulator.get(serial)?.() };
    },
  };
  return { executor, commands };
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

export function standInDeviceHost(): StandInDeviceHost {
  const { executor, commands } = standInDeviceExecutor();
  const deps = { executor, clock: { now: () => new Date(), sleep: async () => undefined }, isPortAvailable: async () => true };
  latest = { withDevices: (request, work) => withDevices(request, work, deps), commands };
  return latest;
}
