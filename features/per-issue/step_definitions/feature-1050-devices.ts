/**
 * What the feature-1050 scenarios read from the stand-in host about the devices it held to begin with and the commands it was given
 * about them: which devices carry the name of an ADW ID, which commands shut one down or delete it, and what the host holds now.
 * No hooks and no steps: any step file may import it.
 */

import assert from 'assert';

import type { StandInHeldDevices } from '../../regression/support/standInDevices.ts';

/** The prefix the device lifecycle gives the names of its devices, as the scenarios say it. */
export const ADW_NAME_PREFIX = 'adw-';

export type Step = 'shut down' | 'delete';

/** The devices of one name: the AVD, the emulators that ran from it and the simulators. */
export interface DevicesOfAdwId {
  readonly name: string;
  /** The serials of the emulators that ran from the AVD. */
  readonly serials: readonly string[];
  /** The UDIDs of the simulators of that name. */
  readonly udids: readonly string[];
}

export const nameFor = (adwId: string): string => `${ADW_NAME_PREFIX}${adwId}`;

/** The devices of one name, as the host held them to begin with. */
export function devicesNamed(leftovers: StandInHeldDevices, name: string): DevicesOfAdwId {
  return {
    name,
    serials: Object.entries(leftovers.emulators).filter(([, avd]) => avd === name).map(([serial]) => serial),
    udids: leftovers.simulators.filter(simulator => simulator.name === name).map(({ udid }) => udid),
  };
}

/** The commands that shut the emulator down and delete its AVD, as the step each is. */
export function emulatorCommands({ name, serials }: DevicesOfAdwId): ReadonlyMap<string, Step> {
  return new Map<string, Step>([...serials.map(serial => [`adb -s ${serial} emu kill`, 'shut down'] as const), [`avdmanager delete avd --name ${name}`, 'delete']]);
}

/** The commands that shut a simulator down and delete it, as the step each is. */
export function simulatorCommands({ udids }: DevicesOfAdwId): ReadonlyMap<string, Step> {
  return new Map<string, Step>(udids.flatMap(udid => [[`xcrun simctl shutdown ${udid}`, 'shut down'], [`xcrun simctl delete ${udid}`, 'delete']] as const));
}

/** The steps the commands took, in the order they came, leaving out the commands that are none of them. */
export function stepsFrom(lines: readonly string[], commands: ReadonlyMap<string, Step>): Step[] {
  return lines.flatMap(line => commands.get(line) ?? []);
}

/** What the host holds of one name, as the scenarios compare it before and after: the AVD, its emulators and its simulators. */
export function heldUnderName(held: StandInHeldDevices, name: string): unknown {
  return {
    avds: held.avds.filter(avd => avd === name),
    emulators: Object.entries(held.emulators).filter(([, avd]) => avd === name),
    simulators: held.simulators.filter(simulator => simulator.name === name),
  };
}

export function assertNoneHeldUnderName(held: StandInHeldDevices, name: string, whose: string): void {
  assert.deepStrictEqual(heldUnderName(held, name), { avds: [], emulators: [], simulators: [] }, `Expected the host to hold no emulator, AVD or simulator of ${whose} any more`);
}
