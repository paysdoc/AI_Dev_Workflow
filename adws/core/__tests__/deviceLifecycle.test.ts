import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOOT_POLL_INTERVAL_MS,
  CONSOLE_PORT_COUNT,
  DEVICE_BOOT_TIMEOUT_MS,
  DEVICE_COMMAND_TIMEOUT_MS,
  FIRST_CONSOLE_PORT,
  POLL_COMMAND_TIMEOUT_MS,
  deviceNameFor,
  emulatorConsolePortCandidates,
  withDevices,
  type DeviceEnvironment,
} from '../deviceLifecycle';
import {
  TEST_DEVICE_SOURCE,
  TEST_UDID,
  emulatorPort,
  firstOutOfOrder,
  recordingDeviceHost,
  requestFor,
  rewritingOutput,
  type DeviceHostScript,
  type RecordingDeviceHost,
} from './fixtures/recordingDeviceHost';

const LOGIN = 'k7m2p9-login-screen';
const SETTINGS = 'q4w8z1-settings-page';

const name = (adwId: string): string => `adw-${adwId}`;

async function runWith(script: Partial<DeviceHostScript> = {}, adwId = LOGIN): Promise<{ host: RecordingDeviceHost; devices: DeviceEnvironment }> {
  const host = recordingDeviceHost(script);
  const devices = await withDevices(
    requestFor(adwId, host),
    async (given) => {
      host.mark('callback');
      return given;
    },
    host.deps,
  );
  return { host, devices };
}

const androidSteps = (adwId: string, port: number): string[] => [
  `avdmanager create avd --name ${name(adwId)} --package ${TEST_DEVICE_SOURCE.androidSystemImage} --device ${TEST_DEVICE_SOURCE.androidDeviceProfile} --force`,
  'adb start-server',
  `emulator -avd ${name(adwId)} -port ${port} -no-window -no-audio -no-boot-anim -no-snapshot`,
  `adb -s emulator-${port} get-state`,
  `adb -s emulator-${port} shell getprop sys.boot_completed`,
  'callback',
  `adb -s emulator-${port} emu kill`,
  `avdmanager delete avd --name ${name(adwId)}`,
];

const iosSteps = (adwId: string): string[] => [
  `xcrun simctl create ${name(adwId)} ${TEST_DEVICE_SOURCE.iosDeviceType} ${TEST_DEVICE_SOURCE.iosRuntime}`,
  `xcrun simctl boot ${TEST_UDID}`,
  `xcrun simctl bootstatus ${TEST_UDID}`,
  'callback',
  `xcrun simctl shutdown ${TEST_UDID}`,
  `xcrun simctl delete ${TEST_UDID}`,
];

describe('deviceNameFor and emulatorConsolePortCandidates', () => {
  it('names a device after the ADW ID, under a prefix of ADW\'s own', () => {
    expect(deviceNameFor('abc123-device-test')).toBe('adw-abc123-device-test');
  });

  it('gives every even console port of the emulator\'s range once, from 5554 to 5680, the same on every call', () => {
    const candidates = emulatorConsolePortCandidates(LOGIN);

    expect(candidates).toHaveLength(CONSOLE_PORT_COUNT);
    expect(new Set(candidates).size).toBe(CONSOLE_PORT_COUNT);
    expect(candidates.every(port => port % 2 === 0 && port >= FIRST_CONSOLE_PORT && port <= 5680)).toBe(true);
    expect(emulatorConsolePortCandidates(LOGIN)).toEqual(candidates);
  });

  it('starts two ADW IDs on different ports, and goes round from the ADW ID\'s own port', () => {
    const login = emulatorConsolePortCandidates(LOGIN);
    const settings = emulatorConsolePortCandidates(SETTINGS);

    expect([login[0], settings[0]]).toEqual([5556, 5660]);
    expect(login.slice(0, 2)).toEqual([5556, 5558]);
    expect(login.slice(-2)).toEqual([5680, 5554]);
  });
});

describe('withDevices — a run in which both devices come up', () => {
  it('creates, boots and waits for the emulator, runs the callback, then shuts the emulator down and deletes its AVD', async () => {
    const { host } = await runWith();

    expect(firstOutOfOrder(host.events, androidSteps(LOGIN, emulatorPort(host)))).toBeUndefined();
  });

  it('creates, boots and waits for the simulator, runs the callback, then shuts it down and deletes it', async () => {
    const { host } = await runWith();

    expect(firstOutOfOrder(host.events, iosSteps(LOGIN))).toBeUndefined();
  });

  it('runs the callback once both devices are ready, and shuts neither down before it has returned', async () => {
    const { host } = await runWith();
    const at = (event: string): number => host.events.indexOf(event);
    const port = emulatorPort(host);

    expect(at('callback')).toBeGreaterThan(Math.max(at(`adb -s emulator-${port} shell getprop sys.boot_completed`), at(`xcrun simctl bootstatus ${TEST_UDID}`)));
    expect(at('callback')).toBeLessThan(Math.min(at(`adb -s emulator-${port} emu kill`), at(`xcrun simctl shutdown ${TEST_UDID}`)));
  });

  it('gives the callback exactly the AVD, the serial of the console port and the UDID, and returns what the callback returns', async () => {
    const host = recordingDeviceHost();
    const callback = vi.fn(async (_devices: DeviceEnvironment) => 'what the callback returned');

    const result = await withDevices(requestFor(LOGIN, host), callback, host.deps);

    expect(result).toBe('what the callback returned');
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith({
      ADW_ANDROID_AVD: name(LOGIN),
      ADW_ANDROID_SERIAL: `emulator-${emulatorPort(host)}`,
      ADW_IOS_UDID: TEST_UDID,
    });
  });

  it('starts the emulator headless, with its output in the file the request names', async () => {
    const { host } = await runWith();

    expect(host.started).toHaveLength(1);
    expect(host.started[0].argv).toEqual(['emulator', '-avd', name(LOGIN), '-port', String(emulatorPort(host)), '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot']);
    expect(host.started[0].outputPath).toBe('/logs/android-emulator.log');
  });

  it('answers the hardware-profile question of avdmanager with "no"', async () => {
    const { host } = await runWith();

    const create = host.runs.find(run => run.argv[0] === 'avdmanager' && run.argv[1] === 'create');
    expect(create?.input).toBe('no\n');
  });

  it('gives each command the time it may take: a boot as long as the boot deadline, a poll a few seconds, any other command a couple of minutes', async () => {
    const { host } = await runWith();
    const timeoutOf = (command: string): number | undefined => host.runs.find(run => run.argv.join(' ').includes(command))?.timeoutMs;

    expect(timeoutOf('bootstatus')).toBe(DEVICE_BOOT_TIMEOUT_MS);
    expect(timeoutOf('get-state')).toBe(POLL_COMMAND_TIMEOUT_MS);
    expect(timeoutOf('getprop')).toBe(POLL_COMMAND_TIMEOUT_MS);
    expect(timeoutOf('avdmanager create')).toBe(DEVICE_COMMAND_TIMEOUT_MS);
    expect(timeoutOf('simctl delete')).toBe(DEVICE_COMMAND_TIMEOUT_MS);
  });
});

describe('withDevices — a callback that throws', () => {
  it('shuts both devices down and deletes them after the callback, and fails with the very error the callback threw', async () => {
    const host = recordingDeviceHost();
    const thrown = new Error('The Appium session could not be created');

    const run = withDevices(requestFor(LOGIN, host), async () => {
      host.mark('callback');
      throw thrown;
    }, host.deps);

    await expect(run).rejects.toBe(thrown);
    expect(firstOutOfOrder(host.events, androidSteps(LOGIN, emulatorPort(host)))).toBeUndefined();
    expect(firstOutOfOrder(host.events, iosSteps(LOGIN))).toBeUndefined();
  });
});

describe('withDevices — the console port of the emulator', () => {
  it('differs between two ADW IDs, and the serial each callback is given follows the port of its own emulator', async () => {
    const login = await runWith({}, LOGIN);
    const settings = await runWith({}, SETTINGS);

    expect(emulatorPort(login.host)).toBe(5556);
    expect(emulatorPort(settings.host)).toBe(5660);
    expect(login.devices.ADW_ANDROID_SERIAL).toBe('emulator-5556');
    expect(settings.devices.ADW_ANDROID_SERIAL).toBe('emulator-5660');
  });

  it('is the next candidate when the first is in use', async () => {
    const [first, second] = emulatorConsolePortCandidates(LOGIN);

    const { host, devices } = await runWith({ takenPorts: [first] });

    expect(emulatorPort(host)).toBe(second);
    expect(devices.ADW_ANDROID_SERIAL).toBe(`emulator-${second}`);
  });

  it('is the next candidate when only the adb port above the first is in use', async () => {
    const [first, second] = emulatorConsolePortCandidates(LOGIN);

    const { host } = await runWith({ takenPorts: [first + 1] });

    expect(emulatorPort(host)).toBe(second);
  });
});

describe('withDevices — waiting for the devices', () => {
  it('asks adb for the device state until it says "device", then for the boot property until it says "1", paced by the clock', async () => {
    const { host } = await runWith({ pollsUntilDevice: 2, pollsUntilBootCompleted: 2 });
    const port = emulatorPort(host);
    const asked = (command: string): number => host.events.filter(event => event === `adb -s emulator-${port} ${command}`).length;

    expect(asked('get-state')).toBe(3);
    expect(asked('shell getprop sys.boot_completed')).toBe(3);
    expect(host.events.lastIndexOf('callback')).toBeGreaterThan(host.events.lastIndexOf(`adb -s emulator-${port} shell getprop sys.boot_completed`));
    expect(host.elapsedMs()).toBe(4 * BOOT_POLL_INTERVAL_MS);
  });

  it('reads only the last line of what adb prints, which a daemon starting up precedes with its own lines', async () => {
    const host = recordingDeviceHost();
    const chatter = (output: string): string => `* daemon not running; starting now at tcp:5037\n* daemon started successfully\n${output}`;

    const devices = await withDevices(requestFor(LOGIN, host), async given => given, rewritingOutput(host.deps, 'adb -s', chatter));

    expect(devices.ADW_ANDROID_AVD).toBe(name(LOGIN));
  });
});

describe('withDevices — the run log', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names both devices when it creates them, with the console port and what they are created from', async () => {
    const { host } = await runWith();
    const port = emulatorPort(host);

    expect(host.lines[0]).toBe(
      `info Creating the devices of this workflow: the Android AVD "${name(LOGIN)}" (${TEST_DEVICE_SOURCE.androidSystemImage}, ${TEST_DEVICE_SOURCE.androidDeviceProfile}) on console port ${port}, and the iOS simulator "${name(LOGIN)}" (${TEST_DEVICE_SOURCE.iosDeviceType}, ${TEST_DEVICE_SOURCE.iosRuntime})`,
    );
  });

  it('gives the time each device took to boot, as the clock measured it', async () => {
    const { host } = await runWith({ androidBootMs: 42_000, iosBootMs: 18_000 });
    const port = emulatorPort(host);

    expect(host.lines).toContain(`info The Android emulator "${name(LOGIN)}" (emulator-${port}) booted in 42.0s`);
    expect(host.lines).toContain(`info The iOS simulator "${name(LOGIN)}" (${TEST_UDID}) booted in 18.0s`);
  });

  it('says after the callback that both devices were removed', async () => {
    const host = recordingDeviceHost();
    await withDevices(requestFor(LOGIN, host), async () => host.record('The callback ran', 'info'), host.deps);
    const port = emulatorPort(host);
    const at = (line: string): number => host.lines.indexOf(line);

    expect(at(`info Removed the Android AVD "${name(LOGIN)}" (emulator-${port})`)).toBeGreaterThan(at('info The callback ran'));
    expect(at(`info Removed the iOS simulator "${name(LOGIN)}" (${TEST_UDID})`)).toBeGreaterThan(at('info The callback ran'));
  });

  it('writes only to the sink the request gives', async () => {
    const consoleCalls = (['log', 'info', 'warn', 'error'] as const).map(method => vi.spyOn(console, method).mockImplementation(() => undefined));

    await runWith({ androidBootMs: 4_000 });

    expect(consoleCalls.flatMap(spy => spy.mock.calls)).toEqual([]);
  });
});
