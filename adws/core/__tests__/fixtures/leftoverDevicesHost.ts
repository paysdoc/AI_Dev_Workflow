/**
 * A host that holds devices workflows left behind, for the inventory and the janitor to run against: an executor that
 * answers the listing commands from what the host holds and applies the shutdowns and deletions it is given to that
 * holding, as the tools do, and records each command in the order issued; and a clock that nothing waits on in real time.
 * A script changes the host. No vitest import: any test may use it.
 */

import type { ListedSimulator } from '../../deviceCommands';
import type { DeviceCommandResult, DeviceExecutor } from '../../deviceExecutor';
import type { DeviceInventoryDeps } from '../../deviceInventory';
import type { WaitClock } from '../../rateLimitWaitPolicy';

export const TEST_SIMULATOR_RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-18-2';
export const BOOTED_UDID = '8A1F6C52-3B7E-4D90-9C1A-2E5B7F0D4C13';
export const SHUT_DOWN_UDID = '2B7C9D14-5E60-4F81-A3D2-6C4E8B1F0A97';

export interface LeftoverDevicesScript {
  /** The names `avdmanager` lists. */
  readonly avds: readonly string[];
  /** The serial of each running emulator, and the AVD it runs. */
  readonly emulators: Readonly<Record<string, string>>;
  readonly simulators: readonly ListedSimulator[];
  /** Programs that are not on the host. */
  readonly missingTools: readonly string[];
  /** `xcrun` is on the host and cannot find `simctl`, as on a host with the Command Line Tools and no Xcode. */
  readonly noSimctl: boolean;
  /** The output of each command that exits 1, by the command's leading words. */
  readonly failing: Readonly<Record<string, string>>;
  /** What each command that exits 0 prints in place of its answer, by the command's leading words. */
  readonly printing: Readonly<Record<string, string>>;
  /** The emulator stays up after `adb emu kill`. */
  readonly emulatorIgnoresKill: boolean;
  /** How many more times `adb devices` lists an emulator that was killed, as offline, before it is gone. */
  readonly emulatorLingersPolls: number;
}

const HEALTHY: LeftoverDevicesScript = {
  avds: [],
  emulators: {},
  simulators: [],
  missingTools: [],
  noSimctl: false,
  failing: {},
  printing: {},
  emulatorIgnoresKill: false,
  emulatorLingersPolls: 0,
};

export interface LeftoverDevicesHost {
  readonly deps: DeviceInventoryDeps;
  /** Each command as `argv.join(' ')`, in the order issued. */
  readonly events: string[];
  /** The names of the AVDs the host still holds. */
  avds(): readonly string[];
  simulators(): readonly ListedSimulator[];
  /** The AVD each emulator that is still running runs, by its serial. */
  runningEmulators(): Readonly<Record<string, string>>;
  /** How much fake time has passed. */
  elapsedMs(): number;
}

const NO_SIMCTL = 'xcrun: error: unable to find utility "simctl", not a developer tool or in PATH\n';
const EPOCH_MS = Date.UTC(2026, 0, 1);

// A wait reaches its deadline in no time: `sleep` returns at once and moves `now` forward.
function steppingClock(): WaitClock & { elapsedMs(): number } {
  let current = EPOCH_MS;
  return { now: () => new Date(current), sleep: async (ms) => { current += ms; }, elapsedMs: () => current - EPOCH_MS };
}

interface Holding {
  readonly script: LeftoverDevicesScript;
  avds: string[];
  emulators: Map<string, string>;
  /** The `adb devices` listings that are left to a killed emulator before it is gone. */
  dying: Map<string, number>;
  simulators: ListedSimulator[];
}

type Answer = (holding: Holding, args: readonly string[]) => DeviceCommandResult;

const OK: DeviceCommandResult = { exitCode: 0, output: '' };
const failed = (exitCode: number, output: string): DeviceCommandResult => ({ exitCode, output });
const isCommand = (line: string, words: string): boolean => line === words || line.startsWith(`${words} `);

function listAvds({ avds }: Holding): DeviceCommandResult {
  return { exitCode: 0, output: avds.map(name => `${name}\n`).join('') };
}

// An emulator that was killed is listed as offline a few more times, and is then gone.
function ageKilledEmulators({ emulators, dying }: Holding): void {
  [...dying].forEach(([serial, left]) => {
    if (left > 1) {
      dying.set(serial, left - 1);
      return;
    }
    dying.delete(serial);
    emulators.delete(serial);
  });
}

function listAttached(holding: Holding): DeviceCommandResult {
  const { emulators, dying } = holding;
  const rows = [...emulators.keys()].map(serial => `${serial}\t${dying.has(serial) ? 'offline' : 'device'}\n`);
  ageKilledEmulators(holding);
  return { exitCode: 0, output: `List of devices attached\n${rows.join('')}\n` };
}

function killEmulator({ script, emulators, dying }: Holding, serial: string): DeviceCommandResult {
  if (!script.emulatorIgnoresKill && script.emulatorLingersPolls === 0) emulators.delete(serial);
  if (!script.emulatorIgnoresKill && script.emulatorLingersPolls > 0) dying.set(serial, script.emulatorLingersPolls);
  return { exitCode: 0, output: 'OK: killing emulator, bye bye\r\nOK\r\n' };
}

function answerEmulator(holding: Holding, [serial, ...verb]: readonly string[]): DeviceCommandResult {
  const avd = holding.emulators.get(serial);
  if (avd === undefined) return failed(1, `error: device '${serial}' not found\n`);

  const request = verb.join(' ');
  if (request === 'emu avd name') return { exitCode: 0, output: `${avd}\r\nOK\r\n` };
  if (request === 'emu kill') return killEmulator(holding, serial);
  return failed(1, `Unexpected command: adb -s ${serial} ${request}\n`);
}

// avdmanager will not delete an AVD whose emulator is running.
function deleteAvd(holding: Holding, [name]: readonly string[]): DeviceCommandResult {
  if (!holding.avds.includes(name)) return failed(1, `Error: There is no Android Virtual Device named '${name}'\n`);
  if ([...holding.emulators.values()].includes(name)) return failed(1, 'Error: An error occurred while deleting the AVD\n');
  holding.avds = holding.avds.filter(avd => avd !== name);
  return OK;
}

function listSimulators({ simulators }: Holding): DeviceCommandResult {
  const devices = simulators.map(simulator => ({ ...simulator, isAvailable: true }));
  return { exitCode: 0, output: JSON.stringify({ devices: { [TEST_SIMULATOR_RUNTIME]: devices } }) };
}

function simulatorWith({ simulators }: Holding, udid: string): ListedSimulator | undefined {
  return simulators.find(simulator => simulator.udid === udid);
}

function shutDownSimulator(holding: Holding, [udid]: readonly string[]): DeviceCommandResult {
  const simulator = simulatorWith(holding, udid);
  if (simulator === undefined) return failed(164, `Invalid device: ${udid}\n`);
  if (simulator.state === 'Shutdown') return failed(164, 'Unable to shutdown device in current state: Shutdown\n');
  holding.simulators = holding.simulators.map(each => (each === simulator ? { ...each, state: 'Shutdown' } : each));
  return OK;
}

// simctl will not delete a simulator that is booted.
function deleteSimulator(holding: Holding, [udid]: readonly string[]): DeviceCommandResult {
  const simulator = simulatorWith(holding, udid);
  if (simulator === undefined) return failed(164, `Invalid device: ${udid}\n`);
  if (simulator.state !== 'Shutdown') return failed(164, `Unable to delete device in current state: ${simulator.state}\n`);
  holding.simulators = holding.simulators.filter(each => each !== simulator);
  return OK;
}

const ANSWERS: ReadonlyArray<readonly [string, Answer]> = [
  ['avdmanager list avd -c', listAvds],
  ['avdmanager delete avd --name', deleteAvd],
  ['adb devices', listAttached],
  ['adb -s', answerEmulator],
  ['xcrun simctl list --json devices', listSimulators],
  ['xcrun simctl shutdown', shutDownSimulator],
  ['xcrun simctl delete', deleteSimulator],
];

function scripted(output: Readonly<Record<string, string>>, line: string): string | undefined {
  const words = Object.keys(output).find(candidate => isCommand(line, candidate));
  return words === undefined ? undefined : output[words];
}

function answer(holding: Holding, argv: readonly string[]): DeviceCommandResult {
  const line = argv.join(' ');
  const { script } = holding;
  if (script.missingTools.includes(argv[0])) return { exitCode: null, output: `Error: spawn ${argv[0]} ENOENT`, programMissing: true };
  if (argv[0] === 'xcrun' && script.noSimctl) return failed(72, NO_SIMCTL);

  const failure = scripted(script.failing, line);
  if (failure !== undefined) return failed(1, failure);
  const printed = scripted(script.printing, line);
  if (printed !== undefined) return { exitCode: 0, output: printed };

  const known = ANSWERS.find(([words]) => isCommand(line, words));
  return known === undefined ? failed(1, `Unexpected command: ${line}\n`) : known[1](holding, argv.slice(known[0].split(' ').length));
}

export function leftoverDevicesHost(script: Partial<LeftoverDevicesScript> = {}): LeftoverDevicesHost {
  const full: LeftoverDevicesScript = { ...HEALTHY, ...script };
  const holding: Holding = {
    script: full,
    avds: [...full.avds],
    emulators: new Map(Object.entries(full.emulators)),
    dying: new Map(),
    simulators: full.simulators.map(simulator => ({ ...simulator })),
  };
  const events: string[] = [];
  const clock = steppingClock();

  const executor: DeviceExecutor = {
    run: async ({ argv }) => {
      events.push(argv.join(' '));
      return answer(holding, argv);
    },
    start: () => {
      throw new Error('The devices left behind are removed without starting a process');
    },
  };

  return {
    deps: { executor, clock },
    events,
    avds: () => [...holding.avds],
    simulators: () => holding.simulators.map(simulator => ({ ...simulator })),
    runningEmulators: () => Object.fromEntries(holding.emulators),
    elapsedMs: clock.elapsedMs,
  };
}
