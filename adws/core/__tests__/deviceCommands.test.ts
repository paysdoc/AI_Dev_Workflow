import { describe, expect, it } from 'vitest';
import {
  EMULATOR_OUTPUT_LINES,
  HostTool,
  MAX_BOOT_ATTEMPTS,
  awaitSimulatorBoot,
  bootSimulator,
  createAvd,
  createSimulator,
  deleteAvd,
  emulatorArgv,
  hostToolOf,
  killEmulator,
  lastLines,
  missingToolOf,
  pollEmulator,
  startAdbServer,
} from '../deviceCommands';
import { TEST_DEVICE_SOURCE } from './fixtures/recordingDeviceHost';

const NO_SIMCTL = 'xcrun: error: unable to find utility "simctl", not a developer tool or in PATH\n';

describe('MAX_BOOT_ATTEMPTS', () => {
  it('is the three attempts the dev server is started with', () => {
    expect(MAX_BOOT_ATTEMPTS).toBe(3);
  });
});

describe('hostToolOf', () => {
  it.each([
    [createAvd('adw-x', TEST_DEVICE_SOURCE).argv, HostTool.AvdManager],
    [deleteAvd('adw-x').argv, HostTool.AvdManager],
    [startAdbServer.argv, HostTool.Adb],
    [pollEmulator('emulator-5556', 'get-state').argv, HostTool.Adb],
    [killEmulator('emulator-5556').argv, HostTool.Adb],
    [emulatorArgv('adw-x', 5556), HostTool.Emulator],
    [createSimulator('adw-x', TEST_DEVICE_SOURCE).argv, HostTool.Simctl],
    [bootSimulator('UDID').argv, HostTool.Simctl],
    [awaitSimulatorBoot('UDID').argv, HostTool.Simctl],
  ] as const)('maps the program of %j to %s', (argv, tool) => {
    expect(hostToolOf(argv)).toBe(tool);
  });

  it('knows no tool for a program that is none of the four', () => {
    expect(hostToolOf(['ls', '-l'])).toBeNull();
  });

  it('knows no tool for a program named like a property of Object', () => {
    expect(hostToolOf(['constructor'])).toBeNull();
    expect(hostToolOf(['toString'])).toBeNull();
  });
});

describe('missingToolOf', () => {
  it('names the tool of a command whose program is not on the host', () => {
    const missing = { exitCode: null, output: 'Error: spawn avdmanager ENOENT', programMissing: true } as const;

    expect(missingToolOf(createAvd('adw-x', TEST_DEVICE_SOURCE), missing)).toBe(HostTool.AvdManager);
    expect(missingToolOf(bootSimulator('UDID'), missing)).toBe(HostTool.Simctl);
  });

  it('names xcrun simctl when xcrun cannot find simctl, which is how a host with no Xcode answers', () => {
    expect(missingToolOf(createSimulator('adw-x', TEST_DEVICE_SOURCE), { exitCode: 72, output: NO_SIMCTL })).toBe(HostTool.Simctl);
  });

  it('finds that answer after a line xcrun printed before it', () => {
    expect(missingToolOf(bootSimulator('UDID'), { exitCode: 72, output: `xcode-select: note: no developer tools were found\n${NO_SIMCTL}` })).toBe(HostTool.Simctl);
  });

  it('names no tool for a tool that ran and failed', () => {
    expect(missingToolOf(bootSimulator('UDID'), { exitCode: 1, output: 'Unable to boot device\n' })).toBeNull();
    expect(missingToolOf(createAvd('adw-x', TEST_DEVICE_SOURCE), { exitCode: 1, output: 'Error: Package path is not valid.\n' })).toBeNull();
  });

  it('names no tool for a command that succeeded', () => {
    expect(missingToolOf(startAdbServer, { exitCode: 0, output: '' })).toBeNull();
  });

  it('reads the xcrun answer only from an xcrun command', () => {
    expect(missingToolOf(startAdbServer, { exitCode: 1, output: NO_SIMCTL })).toBeNull();
  });
});

describe('lastLines', () => {
  it('keeps the last lines of an output, without the blank ones at its end', () => {
    expect(lastLines('one\ntwo\nthree\nfour\n\n', 2)).toBe('three\nfour');
  });

  it('keeps all of an output that is shorter than the count', () => {
    expect(lastLines('one\ntwo\n', EMULATOR_OUTPUT_LINES)).toBe('one\ntwo');
  });

  it('keeps nothing of an empty output', () => {
    expect(lastLines('', 5)).toBe('');
    expect(lastLines('  \n\n', 5)).toBe('');
  });

  it('keeps the reason an emulator stopped, which it prints after its start-up lines', () => {
    const start = Array.from({ length: 50 }, (_, index) => `start-up line ${index}`);
    const output = [...start, 'PANIC: Broken AVD system path', ''].join('\n');

    const kept = lastLines(output, EMULATOR_OUTPUT_LINES);

    expect(kept.split('\n')).toHaveLength(EMULATOR_OUTPUT_LINES);
    expect(kept.endsWith('PANIC: Broken AVD system path')).toBe(true);
    expect(kept).not.toContain('start-up line 0\n');
  });
});
