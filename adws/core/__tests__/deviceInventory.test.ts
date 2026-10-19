import { describe, expect, it } from 'vitest';
import { Platform } from '../applicationType';
import {
  BOOT_POLL_INTERVAL_MS,
  EMULATOR_EXIT_TIMEOUT_MS,
  HostTool,
  listAdwDevices,
  removeAdwDevice,
  type AdwAvd,
  type AdwSimulator,
} from '../deviceLifecycle';
import { BOOTED_UDID, SHUT_DOWN_UDID, leftoverDevicesHost, type LeftoverDevicesScript } from './fixtures/leftoverDevicesHost';
import { firstOutOfOrder } from './fixtures/recordingDeviceHost';

const LOGIN = 'adw-k7m2p9-login-screen';
const SETTINGS = 'adw-q4w8z1-settings-page';
const SERIAL = 'emulator-5556';
const OPERATOR_UDID = 'D2F4A6B8-1C3E-4579-8A0B-9C1D2E3F4A5B';

const loginAvd: AdwAvd = { platform: Platform.Android, adwId: 'k7m2p9-login-screen', name: LOGIN, serial: SERIAL };
const settingsAvd: AdwAvd = { platform: Platform.Android, adwId: 'q4w8z1-settings-page', name: SETTINGS, serial: null };
const loginSimulator: AdwSimulator = { platform: Platform.Ios, adwId: 'k7m2p9-login-screen', name: LOGIN, udid: BOOTED_UDID, booted: true };
const settingsSimulator: AdwSimulator = { platform: Platform.Ios, adwId: 'q4w8z1-settings-page', name: SETTINGS, udid: SHUT_DOWN_UDID, booted: false };

const MIXED_HOST: Partial<LeftoverDevicesScript> = {
  avds: [LOGIN, SETTINGS, 'Pixel_8_API_35'],
  emulators: { [SERIAL]: LOGIN, 'emulator-5554': 'Pixel_8_API_35' },
  simulators: [
    { name: LOGIN, udid: BOOTED_UDID, state: 'Booted' },
    { name: SETTINGS, udid: SHUT_DOWN_UDID, state: 'Shutdown' },
    { name: 'iPhone 16 Pro', udid: OPERATOR_UDID, state: 'Booted' },
  ],
};

const SIMCTL_LIST = 'xcrun simctl list --json devices';
const adbCommands = (events: readonly string[]): string[] => events.filter(event => event.startsWith('adb '));

describe('listAdwDevices', () => {
  it('lists the AVDs and the simulators named for an ADW ID, with the serial of each running emulator and the UDID and state of each simulator', async () => {
    const host = leftoverDevicesHost(MIXED_HOST);

    const inventory = await listAdwDevices(host.deps);

    expect(inventory[Platform.Android]).toEqual({ kind: 'listed', devices: [loginAvd, settingsAvd] });
    expect(inventory[Platform.Ios]).toEqual({ kind: 'listed', devices: [loginSimulator, settingsSimulator] });
  });

  it('leaves out the devices the operator named, and issues no command that names one', async () => {
    const host = leftoverDevicesHost(MIXED_HOST);

    await listAdwDevices(host.deps);

    expect(host.events.filter(event => event.includes('Pixel_8_API_35') || event.includes('iPhone 16 Pro'))).toEqual([]);
  });

  it('asks adb which AVD each running emulator runs, and nothing else', async () => {
    const host = leftoverDevicesHost(MIXED_HOST);

    await listAdwDevices(host.deps);

    expect(adbCommands(host.events).sort()).toEqual(['adb -s emulator-5554 emu avd name', 'adb -s emulator-5556 emu avd name', 'adb devices']);
  });

  it('does not touch adb when no AVD is named for an ADW ID', async () => {
    const host = leftoverDevicesHost({ avds: ['Pixel_8_API_35', 'adw-test'], emulators: { 'emulator-5554': 'Pixel_8_API_35' } });

    const inventory = await listAdwDevices(host.deps);

    expect(inventory[Platform.Android]).toEqual({ kind: 'listed', devices: [] });
    expect(host.events).toEqual(['avdmanager list avd -c', SIMCTL_LIST]);
  });

  it('lists the ADW AVDs without a serial when adb cannot say which emulators run', async () => {
    const host = leftoverDevicesHost({ ...MIXED_HOST, failing: { 'adb devices': 'error: cannot connect to daemon' } });

    const inventory = await listAdwDevices(host.deps);

    expect(inventory[Platform.Android]).toEqual({ kind: 'listed', devices: [{ ...loginAvd, serial: null }, settingsAvd] });
  });

  it('lists the AVDs without a serial when adb is not on the host', async () => {
    const host = leftoverDevicesHost({ ...MIXED_HOST, missingTools: ['adb'] });

    const inventory = await listAdwDevices(host.deps);

    expect(inventory[Platform.Android]).toEqual({ kind: 'listed', devices: [{ ...loginAvd, serial: null }, settingsAvd] });
  });

  it('reports avdmanager as missing, and still lists the simulators', async () => {
    const host = leftoverDevicesHost({ ...MIXED_HOST, missingTools: ['avdmanager'] });

    const inventory = await listAdwDevices(host.deps);

    expect(inventory[Platform.Android]).toEqual({ kind: 'tool_missing', tool: HostTool.AvdManager });
    expect(inventory[Platform.Ios]).toEqual({ kind: 'listed', devices: [loginSimulator, settingsSimulator] });
  });

  it.each([
    ['xcrun is not on the host', { missingTools: ['xcrun'] }],
    ['xcrun cannot find simctl', { noSimctl: true }],
  ])('reports simctl as missing when %s, and still lists the AVDs', async (_case, script: Partial<LeftoverDevicesScript>) => {
    const host = leftoverDevicesHost({ ...MIXED_HOST, ...script });

    const inventory = await listAdwDevices(host.deps);

    expect(inventory[Platform.Ios]).toEqual({ kind: 'tool_missing', tool: HostTool.Simctl });
    expect(inventory[Platform.Android]).toEqual({ kind: 'listed', devices: [loginAvd, settingsAvd] });
  });

  it('reports a failed AVD listing with the command, its exit code and the last line it printed', async () => {
    const host = leftoverDevicesHost({ ...MIXED_HOST, failing: { 'avdmanager list': 'Picked up _JAVA_OPTIONS\nError: JAVA_HOME is not set\n' } });

    const inventory = await listAdwDevices(host.deps);

    expect(inventory[Platform.Android]).toEqual({ kind: 'failed', message: '"avdmanager list avd -c" failed with exit code 1: Error: JAVA_HOME is not set' });
    expect(inventory[Platform.Ios].kind).toBe('listed');
  });

  it('reports a simulator listing that cannot be read as failed, and still lists the AVDs', async () => {
    const host = leftoverDevicesHost({ ...MIXED_HOST, printing: { [SIMCTL_LIST]: 'CoreSimulator is not running' } });

    const inventory = await listAdwDevices(host.deps);

    expect(inventory[Platform.Ios]).toEqual({ kind: 'failed', message: '"xcrun simctl list --json devices" printed no device list that could be read' });
    expect(inventory[Platform.Android].kind).toBe('listed');
  });

  it('lists a simulator that is booting as booted', async () => {
    const host = leftoverDevicesHost({ simulators: [{ name: LOGIN, udid: BOOTED_UDID, state: 'Booting' }] });

    const inventory = await listAdwDevices(host.deps);

    expect(inventory[Platform.Ios]).toEqual({ kind: 'listed', devices: [loginSimulator] });
  });
});

describe('removeAdwDevice: an AVD', () => {
  it('kills its emulator by its serial, waits until the emulator has left adb, and only then deletes the AVD', async () => {
    const host = leftoverDevicesHost({ ...MIXED_HOST, emulatorLingersPolls: 2 });

    const removal = await removeAdwDevice(loginAvd, host.deps);

    expect(removal).toEqual({ device: loginAvd, failures: [] });
    expect(firstOutOfOrder(host.events, [`adb -s ${SERIAL} emu kill`, 'adb devices', `avdmanager delete avd --name ${LOGIN}`])).toBeUndefined();
    expect(host.events.filter(event => event === 'adb devices')).toHaveLength(3);
    expect(host.elapsedMs()).toBe(2 * BOOT_POLL_INTERVAL_MS);
    expect(host.avds()).toEqual([SETTINGS, 'Pixel_8_API_35']);
    expect(host.runningEmulators()).toEqual({ 'emulator-5554': 'Pixel_8_API_35' });
  });

  it('only deletes an AVD whose emulator does not run', async () => {
    const host = leftoverDevicesHost(MIXED_HOST);

    const removal = await removeAdwDevice(settingsAvd, host.deps);

    expect(removal).toEqual({ device: settingsAvd, failures: [] });
    expect(host.events).toEqual([`avdmanager delete avd --name ${SETTINGS}`]);
    expect(host.avds()).toEqual([LOGIN, 'Pixel_8_API_35']);
  });

  it('leaves the AVD for the next pass when the emulator ignores the kill, after waiting as long as the lifecycle does', async () => {
    const host = leftoverDevicesHost({ ...MIXED_HOST, emulatorIgnoresKill: true });

    const removal = await removeAdwDevice(loginAvd, host.deps);

    expect(removal.failures).toEqual([`The emulator ${SERIAL} was still running 30.0s after "adb emu kill", so the AVD is left for the next pass`]);
    expect(host.events.some(event => event.startsWith('avdmanager delete'))).toBe(false);
    expect(host.elapsedMs()).toBeGreaterThanOrEqual(EMULATOR_EXIT_TIMEOUT_MS);
    expect(host.elapsedMs()).toBeLessThan(EMULATOR_EXIT_TIMEOUT_MS + BOOT_POLL_INTERVAL_MS + 1);
    expect(host.avds()).toContain(LOGIN);
  });

  it('reports a kill that failed, and deletes nothing while the emulator is still running', async () => {
    const host = leftoverDevicesHost({ ...MIXED_HOST, failing: { [`adb -s ${SERIAL} emu kill`]: 'error: closed' } });

    const removal = await removeAdwDevice(loginAvd, host.deps);

    expect(removal.failures[0]).toBe(`"adb -s ${SERIAL} emu kill" failed with exit code 1: error: closed`);
    expect(removal.failures).toHaveLength(2);
    expect(host.events.some(event => event.startsWith('avdmanager delete'))).toBe(false);
  });

  it('reports the output of a deletion that fails, and not that of the kill that went before it', async () => {
    const host = leftoverDevicesHost({ ...MIXED_HOST, failing: { 'avdmanager delete': "Error: Unable to delete the AVD's files: Permission denied" } });

    const removal = await removeAdwDevice(loginAvd, host.deps);

    expect(removal.failures).toEqual([`"avdmanager delete avd --name ${LOGIN}" failed with exit code 1: Error: Unable to delete the AVD's files: Permission denied`]);
  });

  it('reports a program that is not on the host as a command with no exit code', async () => {
    const host = leftoverDevicesHost({ ...MIXED_HOST, missingTools: ['avdmanager'] });

    const removal = await removeAdwDevice(settingsAvd, host.deps);

    expect(removal.failures).toEqual([`"avdmanager delete avd --name ${SETTINGS}" failed with no exit code: Error: spawn avdmanager ENOENT`]);
  });
});

describe('removeAdwDevice: a simulator', () => {
  it('shuts a booted simulator down by its UDID, and then deletes it', async () => {
    const host = leftoverDevicesHost(MIXED_HOST);

    const removal = await removeAdwDevice(loginSimulator, host.deps);

    expect(removal).toEqual({ device: loginSimulator, failures: [] });
    expect(host.events).toEqual([`xcrun simctl shutdown ${BOOTED_UDID}`, `xcrun simctl delete ${BOOTED_UDID}`]);
    expect(host.simulators().map(({ udid }) => udid)).toEqual([SHUT_DOWN_UDID, OPERATOR_UDID]);
  });

  it('only deletes a simulator that is shut down', async () => {
    const host = leftoverDevicesHost(MIXED_HOST);

    const removal = await removeAdwDevice(settingsSimulator, host.deps);

    expect(removal.failures).toEqual([]);
    expect(host.events).toEqual([`xcrun simctl delete ${SHUT_DOWN_UDID}`]);
  });

  it('removes the simulator it was given by UDID, and not the one of the same name that was created after the listing', async () => {
    const later = '7E1D3C5B-9A2F-4860-B4C8-0D6E2F1A3B59';
    const host = leftoverDevicesHost({
      simulators: [
        { name: LOGIN, udid: BOOTED_UDID, state: 'Shutdown' },
        { name: LOGIN, udid: later, state: 'Booted' },
      ],
    });

    await removeAdwDevice({ ...loginSimulator, booted: false }, host.deps);

    expect(host.simulators().map(({ udid }) => udid)).toEqual([later]);
  });

  it('reports a deletion that failed with the command, the exit code and what it printed, and resolves', async () => {
    const host = leftoverDevicesHost({ ...MIXED_HOST, failing: { 'xcrun simctl delete': 'Unable to delete' } });

    const removal = await removeAdwDevice(settingsSimulator, host.deps);

    expect(removal.failures).toEqual([`"xcrun simctl delete ${SHUT_DOWN_UDID}" failed with exit code 1: Unable to delete`]);
  });

  it('deletes the simulator after a shutdown that failed, and reports both', async () => {
    const host = leftoverDevicesHost({ ...MIXED_HOST, failing: { 'xcrun simctl shutdown': 'Unable to shutdown device' } });

    const removal = await removeAdwDevice(loginSimulator, host.deps);

    expect(host.events).toEqual([`xcrun simctl shutdown ${BOOTED_UDID}`, `xcrun simctl delete ${BOOTED_UDID}`]);
    expect(removal.failures[0]).toBe(`"xcrun simctl shutdown ${BOOTED_UDID}" failed with exit code 1: Unable to shutdown device`);
  });
});

describe('removeAdwDevice: whatever happens', () => {
  it('resolves with a failure when the executor throws', async () => {
    const throwing = { executor: { run: () => { throw new Error('the executor broke'); }, start: () => { throw new Error('unused'); } }, clock: leftoverDevicesHost().deps.clock };

    await expect(removeAdwDevice(settingsAvd, throwing)).resolves.toEqual({ device: settingsAvd, failures: ['Error: the executor broke'] });
    await expect(removeAdwDevice(loginSimulator, throwing)).resolves.toEqual({ device: loginSimulator, failures: ['Error: the executor broke'] });
  });
});
