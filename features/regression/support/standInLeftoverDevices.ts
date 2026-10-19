/**
 * The devices a stand-in host holds when a scenario begins, and how its device tools answer about them: what `avdmanager`,
 * `adb` and `xcrun simctl` list, and what a shutdown and a deletion do to them, with the refusals of the real tools. No hooks
 * and no steps: any step file may import it.
 */

import type { DeviceCommandResult } from '../../../adws/core/deviceExecutor.ts';

/** One row of a scenario's table of devices. An AVD is booted when an emulator runs from it. */
export interface StandInLeftoverDevice {
  readonly kind: 'AVD' | 'simulator';
  readonly name: string;
  readonly booted: boolean;
}

export interface StandInHeldSimulator {
  readonly name: string;
  readonly udid: string;
  readonly state: string;
}

export interface StandInHeldDevices {
  readonly avds: readonly string[];
  /** The AVD each running emulator runs from, by its serial. */
  readonly emulators: Readonly<Record<string, string>>;
  readonly simulators: readonly StandInHeldSimulator[];
}

export interface StandInLeftoverHolding {
  /** The answer to a command about the devices held, or `undefined` for a command that is not about them. */
  answer(argv: readonly string[]): DeviceCommandResult | undefined;
  /** What the host holds now. */
  held(): StandInHeldDevices;
}

const SIMULATOR_RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-18-2';
const FIRST_EMULATOR_PORT = 5554;

const OK: DeviceCommandResult = { exitCode: 0, output: '' };
const refused = (exitCode: number, output: string): DeviceCommandResult => ({ exitCode, output });

/** Unique and well-formed, in the order the simulators are listed. */
const udidOf = (position: number): string => `${String(position + 1).padStart(8, '0')}-5D2E-4C7D-9E10-A3B2C4D5E6F7`;

/** The ports of the emulators that run, in the order the AVDs are listed: the console port is even, and adb's is the one above it. */
const serialOf = (position: number): string => `emulator-${FIRST_EMULATOR_PORT + 2 * position}`;

function initialHolding(devices: readonly StandInLeftoverDevice[]): StandInHeldDevices {
  const avds = devices.filter(({ kind }) => kind === 'AVD');
  const simulators = devices.filter(({ kind }) => kind === 'simulator');
  return {
    avds: avds.map(({ name }) => name),
    emulators: Object.fromEntries(avds.filter(({ booted }) => booted).map(({ name }, position) => [serialOf(position), name])),
    simulators: simulators.map(({ name, booted }, position) => ({ name, udid: udidOf(position), state: booted ? 'Booted' : 'Shutdown' })),
  };
}

export function leftoverHolding(devices: readonly StandInLeftoverDevice[]): StandInLeftoverHolding {
  let holding = initialHolding(devices);

  function answerEmulator([serial, ...request]: readonly string[]): DeviceCommandResult | undefined {
    const avd = holding.emulators[serial];
    if (request.join(' ') === 'emu avd name') return avd === undefined ? refused(1, `error: device '${serial}' not found\n`) : { exitCode: 0, output: `${avd}\r\nOK\r\n` };
    if (request.join(' ') !== 'emu kill' || avd === undefined) return undefined;

    holding = { ...holding, emulators: Object.fromEntries(Object.entries(holding.emulators).filter(([each]) => each !== serial)) };
    return { exitCode: 0, output: 'OK: killing emulator, bye bye\r\nOK\r\n' };
  }

  // avdmanager will not delete an AVD whose emulator is running.
  function deleteAvd([name]: readonly string[]): DeviceCommandResult | undefined {
    if (!holding.avds.includes(name)) return undefined;
    if (Object.values(holding.emulators).includes(name)) return refused(1, 'Error: An error occurred while deleting the AVD\n');

    holding = { ...holding, avds: holding.avds.filter(avd => avd !== name) };
    return OK;
  }

  function shutDownSimulator([udid]: readonly string[]): DeviceCommandResult | undefined {
    const simulator = holding.simulators.find(each => each.udid === udid);
    if (simulator === undefined) return undefined;
    if (simulator.state === 'Shutdown') return refused(164, 'Unable to shutdown device in current state: Shutdown\n');

    holding = { ...holding, simulators: holding.simulators.map(each => (each.udid === udid ? { ...each, state: 'Shutdown' } : each)) };
    return OK;
  }

  // simctl will not delete a simulator that is booted.
  function deleteSimulator([udid]: readonly string[]): DeviceCommandResult | undefined {
    const simulator = holding.simulators.find(each => each.udid === udid);
    if (simulator === undefined) return undefined;
    if (simulator.state !== 'Shutdown') return refused(164, `Unable to delete device in current state: ${simulator.state}\n`);

    holding = { ...holding, simulators: holding.simulators.filter(each => each !== simulator) };
    return OK;
  }

  const listAvds = (): DeviceCommandResult => ({ exitCode: 0, output: holding.avds.map(name => `${name}\n`).join('') });

  const listAttached = (): DeviceCommandResult => ({
    exitCode: 0,
    output: `List of devices attached\n${Object.keys(holding.emulators).map(serial => `${serial}\tdevice\n`).join('')}\n`,
  });

  const listSimulators = (): DeviceCommandResult => ({
    exitCode: 0,
    output: JSON.stringify({ devices: { [SIMULATOR_RUNTIME]: holding.simulators.map(simulator => ({ ...simulator, isAvailable: true })) } }),
  });

  const answers: ReadonlyArray<readonly [string, (args: readonly string[]) => DeviceCommandResult | undefined]> = [
    ['avdmanager list avd -c', listAvds],
    ['avdmanager delete avd --name', deleteAvd],
    ['adb devices', listAttached],
    ['adb -s', answerEmulator],
    ['xcrun simctl list --json devices', listSimulators],
    ['xcrun simctl shutdown', shutDownSimulator],
    ['xcrun simctl delete', deleteSimulator],
  ];

  return {
    answer: (argv) => {
      const line = argv.join(' ');
      const found = answers.find(([words]) => line === words || line.startsWith(`${words} `));
      return found?.[1](argv.slice(found[0].split(' ').length));
    },
    held: () => ({ avds: [...holding.avds], emulators: { ...holding.emulators }, simulators: holding.simulators.map(simulator => ({ ...simulator })) }),
  };
}
