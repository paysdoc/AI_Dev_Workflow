import { describe, expect, it } from 'vitest';
import { Platform } from '../applicationType';
import {
  DEVICE_BOOT_TIMEOUT_MS,
  HostTool,
  MAX_BOOT_ATTEMPTS,
  emulatorConsolePortCandidates,
  withDevices,
  type DeviceEnvironment,
  type DeviceLifecycleDeps,
  type DeviceOutcome,
} from '../deviceLifecycle';
import { failureOf, resultOf } from './fixtures/deviceOutcome';
import {
  TEST_DEVICE_SOURCE,
  TEST_UDID,
  emulatorPort,
  firstOutOfOrder,
  recordingDeviceHost,
  requestFor,
  type DeviceHostScript,
  type RecordingDeviceHost,
} from './fixtures/recordingDeviceHost';

const ADW_ID = 'k7m2p9-login-screen';
const NAME = `adw-${ADW_ID}`;
const BOOT_FAILS = 'Unable to boot device\n';
const PANIC = 'PANIC: Broken AVD system path. Check your ANDROID_SDK_ROOT value [/opt/android-sdk]!\n';
const NO_XCODE = 'xcrun: error: unable to find utility "simctl", not a developer tool or in PATH\n';

const hostWith = (script: Partial<DeviceHostScript>): RecordingDeviceHost => recordingDeviceHost(script);

async function run(host: RecordingDeviceHost, deps: DeviceLifecycleDeps = host.deps): Promise<DeviceOutcome<DeviceEnvironment>> {
  return withDevices(requestFor(ADW_ID, host), async (devices) => { host.mark('callback'); return devices; }, deps);
}

const issued = (host: RecordingDeviceHost, command: string): number => host.events.filter(event => event === command || event.startsWith(`${command} `)).length;
const verbsOf = (host: RecordingDeviceHost, program: string, verbAt: number): string[] =>
  host.events.filter(event => event.startsWith(`${program} `)).map(event => event.split(' ')[verbAt]);
const blocksOf = (output: string): string[] => output.split('\n\n');

const androidRemoval = (host: RecordingDeviceHost): string[] => [`adb -s emulator-${emulatorPort(host)} emu kill`, `avdmanager delete avd --name ${NAME}`];
const iosRemoval = [`xcrun simctl shutdown ${TEST_UDID}`, `xcrun simctl delete ${TEST_UDID}`];

describe('withDevices — a boot that fails and is tried again', () => {
  it('allows 3 boot attempts per device', () => {
    expect(MAX_BOOT_ATTEMPTS).toBe(3);
  });

  it('boots the simulator on the third attempt, after deleting the simulator of each failed attempt, and runs the callback once', async () => {
    const host = hostWith({ failing: { 'xcrun simctl boot': BOOT_FAILS }, failingTimes: { 'xcrun simctl boot': 2 } });

    const outcome = await run(host);

    expect(resultOf(outcome).ADW_IOS_UDID).toBe(TEST_UDID);
    expect(host.events.filter(event => event === 'callback')).toHaveLength(1);
    expect(verbsOf(host, 'xcrun simctl', 2)).toEqual(['create', 'boot', 'delete', 'create', 'boot', 'delete', 'create', 'boot', 'bootstatus', 'shutdown', 'delete']);
  });

  it('boots the emulator on the third attempt, after deleting the AVD of each failed attempt, and hands over the serial of the emulator that booted', async () => {
    const host = hostWith({ emulatorEarlyExits: 2 });

    const outcome = await run(host);

    expect(host.started).toHaveLength(3);
    expect(verbsOf(host, 'avdmanager', 1)).toEqual(['create', 'delete', 'create', 'delete', 'create', 'delete']);
    expect(resultOf(outcome).ADW_ANDROID_SERIAL).toBe(`emulator-${emulatorPort(host, 2)}`);
    expect(host.events.filter(event => event === 'callback')).toHaveLength(1);
  });

  it('probes for a free console port again on each attempt, so that a port taken since the last probe is skipped', async () => {
    const [first, second] = emulatorConsolePortCandidates(ADW_ID);
    const host = hostWith({ emulatorEarlyExits: 1 });
    const takenOnceStarted = async (port: number): Promise<boolean> => !(host.started.length > 0 && (port === first || port === first + 1));

    const outcome = await run(host, { ...host.deps, isPortAvailable: takenOnceStarted });

    expect([emulatorPort(host, 0), emulatorPort(host, 1)]).toEqual([first, second]);
    expect(resultOf(outcome).ADW_ANDROID_SERIAL).toBe(`emulator-${second}`);
  });
});

describe('withDevices — a device that does not boot in any attempt', () => {
  it('comes back with a failed boot of the simulator after 3 attempts, whose output holds what each attempt printed, and never runs the callback', async () => {
    const host = hostWith({ failing: { 'xcrun simctl boot': BOOT_FAILS } });

    const failure = failureOf(await run(host));

    expect(failure).toMatchObject({ kind: 'boot_failed', platform: Platform.Ios, attempts: 3 });
    const blocks = blocksOf(failure.output);
    expect(blocks).toHaveLength(3);
    blocks.forEach((block, index) => {
      expect(block.startsWith(`Attempt ${index + 1} of 3: `)).toBe(true);
      expect(block.endsWith(`\n${BOOT_FAILS.trim()}`)).toBe(true);
    });
    expect(host.events).not.toContain('callback');
  });

  it('has removed every simulator it created, and the emulator and its AVD, by the time it comes back', async () => {
    const host = hostWith({ failing: { 'xcrun simctl boot': BOOT_FAILS } });

    await run(host);

    expect(issued(host, 'xcrun simctl create')).toBe(3);
    expect(issued(host, 'xcrun simctl delete')).toBe(3);
    expect(firstOutOfOrder(host.events, androidRemoval(host))).toBeUndefined();
  });

  it('comes back with a failed boot of the emulator after 3 boot deadlines, having stopped each emulator and deleted its AVD before the next attempt', async () => {
    const host = hostWith({ pollsUntilBootCompleted: Infinity });

    const failure = failureOf(await run(host));

    expect(failure).toMatchObject({ kind: 'boot_failed', platform: Platform.Android, attempts: 3 });
    expect(host.elapsedMs()).toBeGreaterThanOrEqual(3 * DEVICE_BOOT_TIMEOUT_MS);
    const steps = host.events
      .filter(event => event.startsWith('avdmanager ') || event.endsWith(' emu kill'))
      .map(event => (event.startsWith('avdmanager ') ? `avdmanager ${event.split(' ')[1]}` : 'emu kill'));
    expect(steps).toEqual(Array(3).fill(['avdmanager create', 'emu kill', 'avdmanager delete']).flat());
  });

  it('ends the output of each failed emulator attempt with what the emulator printed', async () => {
    const host = hostWith({ emulatorEarlyExits: Infinity, emulatorOutput: PANIC });

    const failure = failureOf(await run(host));

    expect(failure).toMatchObject({ kind: 'boot_failed', platform: Platform.Android, attempts: 3 });
    const blocks = blocksOf(failure.output);
    expect(blocks).toHaveLength(3);
    blocks.forEach(block => expect(block.endsWith(PANIC.trim())).toBe(true));
  });

  it('reads what an emulator printed before the next attempt starts it again, which rewrites the output file', async () => {
    const host = hostWith({ emulatorEarlyExits: Infinity });
    let file = '';
    let starts = 0;
    const { executor } = host.deps;
    const rewriting: DeviceLifecycleDeps['executor'] = {
      ...executor,
      start: (argv, outputPath) => {
        starts += 1;
        file = `PANIC from emulator ${starts}\n`;
        return { ...executor.start(argv, outputPath), output: async () => file };
      },
    };

    const failure = failureOf(await run(host, { ...host.deps, executor: rewriting }));

    blocksOf(failure.output).forEach((block, index) => expect(block.endsWith(`PANIC from emulator ${index + 1}`)).toBe(true));
  });

  it('comes back with a failed boot of the emulator, after 3 attempts, when every console port is in use, having created no AVD and started no emulator', async () => {
    const host = hostWith({ takenPorts: emulatorConsolePortCandidates(ADW_ID) });

    const failure = failureOf(await run(host));

    expect(failure).toMatchObject({ kind: 'boot_failed', platform: Platform.Android, attempts: 3 });
    expect(failure.output).toContain('No console port is free');
    expect(host.started).toEqual([]);
    expect(host.events.filter(event => event.startsWith('avdmanager') || event.startsWith('adb'))).toEqual([]);
    expect(firstOutOfOrder(host.events, iosRemoval)).toBeUndefined();
  });
});

describe('withDevices — a host tool that is missing is not tried again', () => {
  it('names avdmanager, with the reason in the output, after one attempt, and still removes the simulator', async () => {
    const host = hostWith({ missingTools: ['avdmanager'] });

    const failure = failureOf(await run(host));

    expect(failure).toMatchObject({ kind: 'tool_missing', platform: Platform.Android, tool: HostTool.AvdManager });
    expect(failure.output).toContain('ENOENT');
    expect(issued(host, 'avdmanager create avd')).toBe(1);
    expect(host.started).toEqual([]);
    expect(firstOutOfOrder(host.events, iosRemoval)).toBeUndefined();
  });

  it('names adb after one "adb start-server", and deletes the AVD it had created', async () => {
    const host = hostWith({ missingTools: ['adb'] });

    const failure = failureOf(await run(host));

    expect(failure).toMatchObject({ kind: 'tool_missing', platform: Platform.Android, tool: HostTool.Adb });
    expect(issued(host, 'adb start-server')).toBe(1);
    expect(host.events).toContain(`avdmanager delete avd --name ${NAME}`);
  });

  it('names the emulator after one start of it, at once and not at the boot deadline, and deletes the AVD', async () => {
    const host = hostWith({ missingTools: ['emulator'] });

    const failure = failureOf(await run(host));

    expect(failure).toMatchObject({ kind: 'tool_missing', platform: Platform.Android, tool: HostTool.Emulator });
    expect(host.started).toHaveLength(1);
    expect(host.elapsedMs()).toBeLessThan(DEVICE_BOOT_TIMEOUT_MS);
    expect(host.events).toContain(`avdmanager delete avd --name ${NAME}`);
  });

  it('names xcrun simctl after one "xcrun simctl create", and removes the emulator and its AVD', async () => {
    const host = hostWith({ missingTools: ['xcrun'] });

    const failure = failureOf(await run(host));

    expect(failure).toMatchObject({ kind: 'tool_missing', platform: Platform.Ios, tool: HostTool.Simctl });
    expect(issued(host, 'xcrun simctl create')).toBe(1);
    expect(firstOutOfOrder(host.events, androidRemoval(host))).toBeUndefined();
  });

  it('names xcrun simctl on a host with xcrun but without Xcode, after one "xcrun simctl create"', async () => {
    const host = hostWith({ failing: { 'xcrun simctl create': NO_XCODE } });

    const failure = failureOf(await run(host));

    expect(failure).toMatchObject({ kind: 'tool_missing', platform: Platform.Ios, tool: HostTool.Simctl });
    expect(failure.output).toContain('unable to find utility "simctl"');
    expect(issued(host, 'xcrun simctl create')).toBe(1);
  });

  it('comes back with the missing tool when the other device failed to boot, whichever device it is', async () => {
    const iosMissing = failureOf(await run(hostWith({ missingTools: ['xcrun'], emulatorEarlyExits: Infinity })));
    const androidMissing = failureOf(await run(hostWith({ missingTools: ['avdmanager'], failing: { 'xcrun simctl boot': BOOT_FAILS } })));

    expect(iosMissing).toMatchObject({ kind: 'tool_missing', tool: HostTool.Simctl });
    expect(androidMissing).toMatchObject({ kind: 'tool_missing', tool: HostTool.AvdManager });
  });

  it('keeps a teardown command whose tool is missing a warning, and leaves the outcome as it was', async () => {
    const host = hostWith({});
    const { executor } = host.deps;
    const withoutAdb: DeviceLifecycleDeps['executor'] = {
      ...executor,
      run: async command => (command.argv.includes('kill') ? { exitCode: null, output: 'Error: spawn adb ENOENT', programMissing: true } : executor.run(command)),
    };

    const outcome = await run(host, { ...host.deps, executor: withoutAdb });

    expect(outcome.kind).toBe('ready');
    expect(host.lines.some(line => line.startsWith('warn ') && line.includes('emu kill'))).toBe(true);
  });
});

describe('withDevices — the run log of the attempts', () => {
  it('names each attempt when it creates a device, and the console port of the emulator', async () => {
    const host = hostWith({ failing: { 'xcrun simctl boot': BOOT_FAILS } });

    await run(host);

    const source = TEST_DEVICE_SOURCE;
    const port = emulatorPort(host);
    expect(host.lines.filter(line => line.startsWith('info Creating the Android'))).toEqual([
      `info Creating the Android AVD "${NAME}" (${source.androidSystemImage}, ${source.androidDeviceProfile}) on console port ${port} (attempt 1 of 3)`,
    ]);
    expect(host.lines.filter(line => line.startsWith('info Creating the iOS'))).toEqual(
      [1, 2, 3].map(attempt => `info Creating the iOS simulator "${NAME}" (${source.iosDeviceType}, ${source.iosRuntime}) (attempt ${attempt} of 3)`),
    );
  });

  it('warns of each failed attempt that is followed by another, and records an error for the last', async () => {
    const host = hostWith({ failing: { 'xcrun simctl boot': BOOT_FAILS } });

    await run(host);

    const warnings = host.lines.filter(line => line.startsWith('warn '));
    const errors = host.lines.filter(line => line.startsWith('error '));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('attempt 1 of 3');
    expect(warnings[1]).toContain('attempt 2 of 3');
    [...warnings, ...errors].forEach(line => expect(line).toContain('Unable to boot device'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('attempt 3 of 3');
  });

  it('records one error for a missing tool, naming the tool and saying that the boot is not tried again', async () => {
    const host = hostWith({ missingTools: ['avdmanager'] });

    await run(host);

    const errors = host.lines.filter(line => line.startsWith('error '));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('avdmanager');
    expect(errors[0]).toContain('not tried again');
    expect(host.lines.filter(line => line.startsWith('warn '))).toEqual([]);
  });
});
