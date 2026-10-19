import { describe, expect, it } from 'vitest';
import { Platform } from '../applicationType';
import {
  DEVICE_BOOT_TIMEOUT_MS,
  DeviceLifecycleError,
  EMULATOR_EXIT_TIMEOUT_MS,
  emulatorConsolePortCandidates,
  withDevices,
  type DeviceLifecycleDeps,
} from '../deviceLifecycle';
import {
  TEST_UDID,
  emulatorPort,
  firstOutOfOrder,
  recordingDeviceHost,
  requestFor,
  rewritingOutput,
  type RecordingDeviceHost,
} from './fixtures/recordingDeviceHost';

const ADW_ID = 'k7m2p9-login-screen';
const NAME = `adw-${ADW_ID}`;

async function failureOf(host: RecordingDeviceHost, deps: DeviceLifecycleDeps = host.deps): Promise<DeviceLifecycleError> {
  try {
    await withDevices(requestFor(ADW_ID, host), async () => host.mark('callback'), deps);
  } catch (error) {
    if (error instanceof DeviceLifecycleError) return error;
    throw error;
  }
  throw new Error('withDevices resolved: it should have failed with a DeviceLifecycleError');
}

const androidRemoval = (host: RecordingDeviceHost): string[] => [`adb -s emulator-${emulatorPort(host)} emu kill`, `avdmanager delete avd --name ${NAME}`];
const iosRemoval = [`xcrun simctl shutdown ${TEST_UDID}`, `xcrun simctl delete ${TEST_UDID}`];

describe('withDevices — a device that does not come up', () => {
  it('fails naming the iOS platform, with the output of the command that failed, when the simulator does not boot', async () => {
    const host = recordingDeviceHost({ failing: { 'xcrun simctl boot': 'Unable to boot device\n' } });

    const error = await failureOf(host);

    expect(error.platform).toBe(Platform.Ios);
    expect(error.output).toBe('Unable to boot device\n');
    expect(error.message).toContain(`"${NAME}"`);
  });

  it('never runs the callback, and still removes the emulator, its AVD and the simulator it created', async () => {
    const host = recordingDeviceHost({ failing: { 'xcrun simctl boot': 'Unable to boot device\n' } });

    await failureOf(host);

    expect(host.events).not.toContain('callback');
    expect(firstOutOfOrder(host.events, androidRemoval(host))).toBeUndefined();
    expect(host.events).toContain(`xcrun simctl delete ${TEST_UDID}`);
  });

  it('deletes a simulator that never booted without shutting it down, which would only draw a warning', async () => {
    const host = recordingDeviceHost({ failing: { 'xcrun simctl boot': 'Unable to boot device\n' } });

    await failureOf(host);

    expect(host.events).not.toContain(`xcrun simctl shutdown ${TEST_UDID}`);
    expect(host.lines.filter(line => line.startsWith('warn'))).toEqual([]);
  });

  it('shuts down and deletes a simulator that was booting when it failed to finish', async () => {
    const host = recordingDeviceHost({ failing: { 'xcrun simctl bootstatus': 'Device failed to boot\n' } });

    const error = await failureOf(host);

    expect(error.platform).toBe(Platform.Ios);
    expect(firstOutOfOrder(host.events, iosRemoval)).toBeUndefined();
  });

  it('starts no emulator and deletes no AVD when the AVD cannot be created, and still removes the simulator', async () => {
    const host = recordingDeviceHost({ failing: { 'avdmanager create avd': 'Error: Package path is not valid.\n' } });

    const error = await failureOf(host);

    expect(error.platform).toBe(Platform.Android);
    expect(error.output).toBe('Error: Package path is not valid.\n');
    expect(host.started).toEqual([]);
    expect(host.events.filter(event => event.startsWith('avdmanager delete') || event.startsWith('adb'))).toEqual([]);
    expect(firstOutOfOrder(host.events, iosRemoval)).toBeUndefined();
  });

  it('starts no emulator, and deletes the AVD, when the adb server cannot be started', async () => {
    const host = recordingDeviceHost({ failing: { 'adb start-server': 'cannot bind to port 5037\n' } });

    const error = await failureOf(host);

    expect(error.platform).toBe(Platform.Android);
    expect(error.output).toBe('cannot bind to port 5037\n');
    expect(host.started).toEqual([]);
    expect(host.events).toContain(`avdmanager delete avd --name ${NAME}`);
  });

  it('fails at once, not at the boot deadline, when the emulator exits before it is ready, and deletes its AVD without asking it to quit', async () => {
    const host = recordingDeviceHost({ emulatorExitsEarly: true });

    const error = await failureOf(host);

    expect(error.platform).toBe(Platform.Android);
    expect(error.message).toContain('/logs/android-emulator.log');
    expect(host.elapsedMs()).toBeLessThan(DEVICE_BOOT_TIMEOUT_MS);
    expect(host.events.some(event => event.endsWith('emu kill'))).toBe(false);
    expect(host.events).toContain(`avdmanager delete avd --name ${NAME}`);
    expect(firstOutOfOrder(host.events, iosRemoval)).toBeUndefined();
  });

  it('fails once the boot deadline has passed on the clock, when the emulator never says it has booted, and removes both devices', async () => {
    const host = recordingDeviceHost({ pollsUntilBootCompleted: Infinity });

    const error = await failureOf(host);

    expect(error.platform).toBe(Platform.Android);
    expect(host.elapsedMs()).toBeGreaterThanOrEqual(DEVICE_BOOT_TIMEOUT_MS);
    expect(host.events).not.toContain('callback');
    expect(firstOutOfOrder(host.events, androidRemoval(host))).toBeUndefined();
    expect(firstOutOfOrder(host.events, iosRemoval)).toBeUndefined();
  });

  it('records the error of each device that failed, and throws the Android one', async () => {
    const host = recordingDeviceHost({
      failing: { 'avdmanager create avd': 'no such package\n', 'xcrun simctl boot': 'no such runtime\n' },
    });

    const error = await failureOf(host);

    expect(error.platform).toBe(Platform.Android);
    const recorded = host.lines.filter(line => line.startsWith('error '));
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toContain('no such package');
    expect(recorded[1]).toContain('no such runtime');
  });

  it('fails before it creates anything when every console port is in use', async () => {
    const host = recordingDeviceHost({ takenPorts: emulatorConsolePortCandidates(ADW_ID) });

    const error = await failureOf(host);

    expect(error.platform).toBe(Platform.Android);
    expect(host.events).toEqual([]);
  });

  it('finds the UDID of a new simulator by its pattern, when a warning comes before it', async () => {
    const host = recordingDeviceHost();
    const warned = rewritingOutput(host.deps, 'xcrun simctl create', output => `warning: CoreSimulator is out of date\n${output}`);

    await withDevices(requestFor(ADW_ID, host), async devices => devices, warned);

    expect(host.events).toContain(`xcrun simctl boot ${TEST_UDID}`);
  });

  it('fails, with nothing of the simulator to delete, when its creation prints no UDID', async () => {
    const host = recordingDeviceHost();
    const silent = rewritingOutput(host.deps, 'xcrun simctl create', () => 'created\n');

    const error = await failureOf(host, silent);

    expect(error.platform).toBe(Platform.Ios);
    expect(host.events.filter(event => event.startsWith('xcrun simctl') && !event.startsWith('xcrun simctl create'))).toEqual([]);
    expect(firstOutOfOrder(host.events, androidRemoval(host))).toBeUndefined();
  });
});

describe('withDevices — what must not leave a device behind', () => {
  it('removes both devices when the run log cannot be written', async () => {
    const host = recordingDeviceHost();
    const unwritable = { ...requestFor(ADW_ID, host), record: () => { throw new Error('ENOSPC: no space left on device'); } };

    await expect(withDevices(unwritable, async () => 'the result', host.deps)).resolves.toBe('the result');

    expect(firstOutOfOrder(host.events, androidRemoval(host))).toBeUndefined();
    expect(firstOutOfOrder(host.events, iosRemoval)).toBeUndefined();
  });

  it('answers an executor that throws as a device that did not come up, and removes what had been created', async () => {
    const host = recordingDeviceHost();
    const { executor } = host.deps;
    const exploding = {
      ...executor,
      run: async (command: Parameters<typeof executor.run>[0]) => {
        if (command.argv.includes('bootstatus')) throw new Error('executor exploded');
        return executor.run(command);
      },
    };

    const error = await failureOf(host, { ...host.deps, executor: exploding });

    expect(error.platform).toBe(Platform.Ios);
    expect(error.message).toContain('executor exploded');
    expect(firstOutOfOrder(host.events, iosRemoval)).toBeUndefined();
    expect(firstOutOfOrder(host.events, androidRemoval(host))).toBeUndefined();
  });
});

describe('withDevices — a removal that goes wrong', () => {
  it('records a warning that names the AVD, the command, its exit code and the last line of its output, and still returns the result of the callback', async () => {
    const host = recordingDeviceHost({ failing: { 'avdmanager delete avd': 'Error: AVD is in use\n' } });

    const result = await withDevices(requestFor(ADW_ID, host), async () => 'the result', host.deps);

    expect(result).toBe('the result');
    const warning = host.lines.find(line => line.startsWith('warn '));
    expect(warning).toContain(`"${NAME}"`);
    expect(warning).toContain(`avdmanager delete avd --name ${NAME}`);
    expect(warning).toContain('exit code 1');
    expect(warning).toContain('Error: AVD is in use');
    expect(host.lines.some(line => line.startsWith('info Removed the Android AVD'))).toBe(false);
  });

  it('still removes the simulator when the AVD cannot be deleted', async () => {
    const host = recordingDeviceHost({ failing: { 'avdmanager delete avd': 'Error: AVD is in use\n' } });

    await withDevices(requestFor(ADW_ID, host), async () => 'the result', host.deps);

    expect(firstOutOfOrder(host.events, iosRemoval)).toBeUndefined();
    expect(host.lines).toContain(`info Removed the iOS simulator "${NAME}" (${TEST_UDID})`);
  });

  it('tries to delete a simulator that would not shut down, and records the failure', async () => {
    const host = recordingDeviceHost({ failing: { 'xcrun simctl shutdown': 'Unable to shutdown device\n' } });

    await withDevices(requestFor(ADW_ID, host), async () => 'the result', host.deps);

    expect(firstOutOfOrder(host.events, iosRemoval)).toBeUndefined();
    expect(host.lines.some(line => line.startsWith('warn ') && line.includes('xcrun simctl shutdown'))).toBe(true);
  });

  it('leaves the error of the callback as it was when a removal fails too', async () => {
    const host = recordingDeviceHost({ failing: { 'avdmanager delete avd': 'Error: AVD is in use\n' } });
    const thrown = new Error('the callback failed');

    await expect(withDevices(requestFor(ADW_ID, host), async () => { throw thrown; }, host.deps)).rejects.toBe(thrown);
  });

  it('kills the emulator\'s process, after the time it is given to exit, when it ignores "adb emu kill", and deletes its AVD only then', async () => {
    const host = recordingDeviceHost({ emulatorIgnoresKill: true });

    await withDevices(requestFor(ADW_ID, host), async () => 'the result', host.deps);

    expect(host.started[0].killed).toBe(true);
    expect(host.elapsedMs()).toBeGreaterThanOrEqual(EMULATOR_EXIT_TIMEOUT_MS);
    expect(firstOutOfOrder(host.events, [...androidRemoval(host).slice(0, 1), 'kill emulator', androidRemoval(host)[1]])).toBeUndefined();
  });

  it('does not kill an emulator that exits when it is asked to', async () => {
    const host = recordingDeviceHost();

    await withDevices(requestFor(ADW_ID, host), async () => 'the result', host.deps);

    expect(host.started[0].killed).toBe(false);
  });
});
