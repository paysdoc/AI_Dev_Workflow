import { describe, expect, it } from 'vitest';
import { BOOTED_UDID, SHUT_DOWN_UDID, type LeftoverDevicesScript } from '../../core/__tests__/fixtures/leftoverDevicesHost';
import { runDeviceJanitorPass } from '../deviceJanitor';
import { OLD, TARGET_REPOS, janitorWorld, stateFor, worktreeOf, type JanitorWorldOptions } from './fixtures/deviceJanitorDeps';

const LOGIN_ID = 'k7m2p9-login-screen';
const LOGIN = `adw-${LOGIN_ID}`;
const SETTINGS_ID = 'q4w8z1-settings-page';
const SETTINGS = `adw-${SETTINGS_ID}`;

const DEAD_AND_OLD: Pick<JanitorWorldOptions, 'states' | 'worktreeAges'> = {
  states: { [LOGIN_ID]: stateFor('acme', 'app', 'feature-issue-7-login-screen'), [SETTINGS_ID]: stateFor('acme', 'app', 'feature-issue-8-settings-page') },
  worktreeAges: { [worktreeOf('feature-issue-7-login-screen')]: OLD, [worktreeOf('feature-issue-8-settings-page')]: OLD },
};

const BOTH_ADW_IDS: Partial<LeftoverDevicesScript> = {
  avds: [LOGIN, SETTINGS],
  emulators: { 'emulator-5556': LOGIN, 'emulator-5558': SETTINGS },
  simulators: [
    { name: LOGIN, udid: BOOTED_UDID, state: 'Booted' },
    { name: SETTINGS, udid: SHUT_DOWN_UDID, state: 'Booted' },
  ],
};

const LISTINGS = ['avdmanager list avd -c', 'xcrun simctl list --json devices'];
const warnings = (lines: readonly string[]): string[] => lines.filter(line => line.startsWith('warn '));
const worldOf = (script: Partial<LeftoverDevicesScript>) => janitorWorld({ script, ...DEAD_AND_OLD });

describe('runDeviceJanitorPass: a host that lacks the device tools', () => {
  it('runs nothing but the two listings, and says nothing, on a host with neither the Android SDK nor Xcode', async () => {
    const world = worldOf({ missingTools: ['avdmanager', 'xcrun'] });

    await expect(runDeviceJanitorPass(world.deps, TARGET_REPOS)).resolves.toBeUndefined();

    expect(world.host.events).toEqual(LISTINGS);
    expect(world.lines).toEqual([]);
  });

  it('sweeps the AVDs of a host that has the Command Line Tools and no Xcode, without a word about simctl', async () => {
    const world = worldOf({ ...BOTH_ADW_IDS, noSimctl: true });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.host.avds()).toEqual([]);
    expect(warnings(world.lines)).toEqual([]);
  });

  it('sweeps the simulators of a host that has no Android SDK, without a word about avdmanager', async () => {
    const world = worldOf({ ...BOTH_ADW_IDS, missingTools: ['avdmanager', 'adb'] });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.host.simulators()).toEqual([]);
    expect(warnings(world.lines)).toEqual([]);
  });
});

describe('runDeviceJanitorPass: a listing that fails', () => {
  it('warns once that the Android devices could not be listed, and still removes the simulators', async () => {
    const world = worldOf({ ...BOTH_ADW_IDS, failing: { 'avdmanager list': 'Error: JAVA_HOME is not set' } });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(warnings(world.lines)).toEqual(['warn Device janitor: could not list the android devices: "avdmanager list avd -c" failed with exit code 1: Error: JAVA_HOME is not set']);
    expect(world.host.simulators()).toEqual([]);
    expect(world.host.avds()).toEqual([LOGIN, SETTINGS]);
  });

  it('warns once that the iOS devices could not be listed when simctl prints no list, and still removes the AVDs', async () => {
    const world = worldOf({ ...BOTH_ADW_IDS, printing: { 'xcrun simctl list': 'CoreSimulator is not running' } });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(warnings(world.lines)).toEqual(['warn Device janitor: could not list the ios devices: "xcrun simctl list --json devices" printed no device list that could be read']);
    expect(world.host.avds()).toEqual([]);
    expect(world.host.simulators()).toHaveLength(2);
  });

  it('cannot delete the AVD of an emulator whose serial adb would not tell, so it warns for each and leaves them for the next pass', async () => {
    const world = worldOf({ ...BOTH_ADW_IDS, failing: { 'adb devices': 'error: cannot connect to daemon' } });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(warnings(world.lines).filter(line => line.includes('could not remove the Android AVD'))).toHaveLength(2);
    expect(world.host.avds()).toEqual([LOGIN, SETTINGS]);
    expect(world.host.simulators()).toEqual([]);
  });
});

describe('runDeviceJanitorPass: a removal that fails', () => {
  const DELETE_FAILS = { 'avdmanager delete': 'Error: An error occurred while deleting the AVD' };

  it('warns with the ADW ID, the AVD and the command, and still removes the simulator of that ADW ID', async () => {
    const world = worldOf({ ...BOTH_ADW_IDS, failing: DELETE_FAILS });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(warnings(world.lines)).toContain(
      `warn Device janitor: could not remove the Android AVD "${SETTINGS}" (emulator-5558) of ADW ID ${SETTINGS_ID}: "avdmanager delete avd --name ${SETTINGS}" failed with exit code 1: Error: An error occurred while deleting the AVD`,
    );
    expect(world.host.simulators().map(({ name }) => name)).toEqual([]);
  });

  it('goes on to the next ADW ID, whose simulator is removed although its AVD could not be', async () => {
    const world = worldOf({ ...BOTH_ADW_IDS, failing: DELETE_FAILS });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(warnings(world.lines).map(line => /ADW ID (\S+):/.exec(line)?.[1])).toEqual([LOGIN_ID, SETTINGS_ID]);
    expect(world.lines.some(line => line.startsWith('info ') && line.includes(`removed the iOS simulator "${SETTINGS}"`))).toBe(true);
  });

  it('warns that the AVD is left for the next pass when its emulator ignores the kill, and issues no deletion', async () => {
    const world = worldOf({ ...BOTH_ADW_IDS, emulatorIgnoresKill: true });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(warnings(world.lines).some(line => line.includes(`ADW ID ${LOGIN_ID}`) && line.includes(`"${LOGIN}"`) && line.includes('still running') && line.includes('next pass'))).toBe(true);
    expect(world.host.events.filter(event => event.startsWith('avdmanager delete'))).toEqual([]);
    expect(world.host.avds()).toEqual([LOGIN, SETTINGS]);
    expect(world.host.simulators()).toEqual([]);
  });
});

describe('runDeviceJanitorPass: an error', () => {
  it('is contained to the ADW ID whose decision threw, and the others are still swept', async () => {
    const world = worldOf(BOTH_ADW_IDS);
    const deps = {
      ...world.deps,
      isAgentProcessRunning: (adwId: string) => {
        if (adwId === SETTINGS_ID) throw new Error('the state is unreadable');
        return false;
      },
    };

    await expect(runDeviceJanitorPass(deps, TARGET_REPOS)).resolves.toBeUndefined();

    expect(warnings(world.lines)).toEqual([`warn Device janitor: error sweeping the devices of ADW ID ${SETTINGS_ID}: Error: the state is unreadable`]);
    expect(world.host.avds()).toEqual([SETTINGS]);
    expect(world.host.simulators().map(({ name }) => name)).toEqual([SETTINGS]);
  });

  it('is contained to the pass when the executor throws, so that the cron tick goes on', async () => {
    const world = worldOf(BOTH_ADW_IDS);
    const executor = { run: () => { throw new Error('the executor broke'); }, start: () => { throw new Error('unused'); } };

    await expect(runDeviceJanitorPass({ ...world.deps, devices: { ...world.host.deps, executor } }, TARGET_REPOS)).resolves.toBeUndefined();

    expect(world.lines).toEqual(['warn Device janitor: pass failed: Error: the executor broke']);
  });
});
