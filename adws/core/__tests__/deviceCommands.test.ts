import { describe, expect, it } from 'vitest';
import {
  DEVICE_COMMAND_TIMEOUT_MS,
  EMULATOR_OUTPUT_LINES,
  HostTool,
  MAX_BOOT_ATTEMPTS,
  POLL_COMMAND_TIMEOUT_MS,
  adwIdOfDeviceName,
  avdNameIn,
  avdNamesIn,
  awaitSimulatorBoot,
  bootSimulator,
  createAvd,
  createSimulator,
  deleteAvd,
  deviceNameFor,
  emulatorArgv,
  emulatorSerialsIn,
  hostToolOf,
  isShutDown,
  killEmulator,
  lastLines,
  listAttachedDevices,
  listAvds,
  listSimulators,
  missingToolOf,
  pollEmulator,
  queryEmulatorAvdName,
  simulatorsIn,
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

describe('adwIdOfDeviceName', () => {
  it.each(['k7m2p9-login-screen', 'o1fnc2-feat-a-device-janito', 'abc123-1760000000000'])('reads %s back from the name the lifecycle gives its devices', (adwId) => {
    expect(adwIdOfDeviceName(deviceNameFor(adwId))).toBe(adwId);
  });

  it.each([
    'Pixel_8_API_35',
    'iPhone 16 Pro',
    'adw-',
    'adw-test',
    'adw-K7M2P9-login',
    'adw-k7m2p9-login (2)',
    'adw-k7m2p9-login-',
    'adw--k7m2p9',
    'xadw-k7m2p9-login',
    'ADW-k7m2p9-login',
  ])('reads no ADW ID from %j, which is not a name the lifecycle gives a device', (name) => {
    expect(adwIdOfDeviceName(name)).toBeNull();
  });
});

describe('the listing commands', () => {
  it.each([
    [listAvds, ['avdmanager', 'list', 'avd', '-c'], DEVICE_COMMAND_TIMEOUT_MS],
    [listSimulators, ['xcrun', 'simctl', 'list', '--json', 'devices'], DEVICE_COMMAND_TIMEOUT_MS],
    [listAttachedDevices, ['adb', 'devices'], POLL_COMMAND_TIMEOUT_MS],
    [queryEmulatorAvdName('emulator-5556'), ['adb', '-s', 'emulator-5556', 'emu', 'avd', 'name'], POLL_COMMAND_TIMEOUT_MS],
  ] as const)('are %j, given the time the command is to take', (command, argv, timeoutMs) => {
    expect(command.argv).toEqual(argv);
    expect(command.timeoutMs).toBe(timeoutMs);
  });

  it('are each run by the host tool a host may lack', () => {
    expect([listAvds, listAttachedDevices, queryEmulatorAvdName('emulator-5556'), listSimulators].map(({ argv }) => hostToolOf(argv))).toEqual([
      HostTool.AvdManager,
      HostTool.Adb,
      HostTool.Adb,
      HostTool.Simctl,
    ]);
  });
});

describe('avdNamesIn', () => {
  it('reads one name from each line, whatever surrounds the list', () => {
    expect(avdNamesIn('Warning: Unable to read the ANDROID_SDK_ROOT\nadw-k7m2p9-login-screen\r\nPixel_8_API_35\n\n')).toEqual([
      'Warning: Unable to read the ANDROID_SDK_ROOT',
      'adw-k7m2p9-login-screen',
      'Pixel_8_API_35',
    ]);
  });

  it('reads no name from an empty list', () => {
    expect(avdNamesIn('')).toEqual([]);
    expect(avdNamesIn('\n  \n')).toEqual([]);
  });
});

describe('emulatorSerialsIn', () => {
  it('reads the serial of each emulator, and only of emulators, from what adb lists', () => {
    const listed = [
      '* daemon not running; starting now at tcp:5037',
      '* daemon started successfully',
      'List of devices attached',
      'emulator-5556\tdevice',
      'emulator-5558\toffline',
      'R5CT1234ABC\tdevice',
      '',
    ].join('\n');

    expect(emulatorSerialsIn(listed)).toEqual(['emulator-5556', 'emulator-5558']);
  });

  it('reads no serial from an output that lists no device', () => {
    expect(emulatorSerialsIn('List of devices attached\n\n')).toEqual([]);
    expect(emulatorSerialsIn('')).toEqual([]);
  });
});

describe('avdNameIn', () => {
  it('reads the name the emulator console prints before its OK', () => {
    expect(avdNameIn('adw-k7m2p9-login-screen\r\nOK\r\n')).toBe('adw-k7m2p9-login-screen');
  });

  it('reads no name from an answer that holds only the OK', () => {
    expect(avdNameIn('OK\n')).toBeNull();
    expect(avdNameIn('')).toBeNull();
  });
});

const BOOTED_ID = '8A1F6C52-3B7E-4D90-9C1A-2E5B7F0D4C13';
const SHUT_DOWN_ID = '2B7C9D14-5E60-4F81-A3D2-6C4E8B1F0A97';
const UNAVAILABLE_ID = 'C41E7A93-0D58-4B26-9F13-7A5D2E8C6B40';

const simctlJson = JSON.stringify(
  {
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [
        { udid: BOOTED_ID, name: 'adw-k7m2p9-login-screen', state: 'Booted', isAvailable: true, deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-16' },
        { udid: SHUT_DOWN_ID, name: 'iPhone 16 Pro', state: 'Shutdown', isAvailable: true },
      ],
      'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [
        { udid: UNAVAILABLE_ID, name: 'iPhone 15', state: 'Shutdown', isAvailable: false, availabilityError: 'runtime profile not found' },
      ],
    },
  },
  null,
  2,
);

const SIMULATORS = [
  { name: 'adw-k7m2p9-login-screen', udid: BOOTED_ID, state: 'Booted' },
  { name: 'iPhone 16 Pro', udid: SHUT_DOWN_ID, state: 'Shutdown' },
  { name: 'iPhone 15', udid: UNAVAILABLE_ID, state: 'Shutdown' },
];

describe('simulatorsIn', () => {
  it('reads every simulator of every runtime, an unavailable one too', () => {
    expect(simulatorsIn(simctlJson)).toEqual(SIMULATORS);
  });

  it('reads the list when xcrun printed a warning before it, and when it printed one after', () => {
    expect(simulatorsIn(`xcrun: warning: CoreSimulator is out of date\n${simctlJson}`)).toEqual(SIMULATORS);
    expect(simulatorsIn(`${simctlJson}\nxcrun: note: done`)).toEqual(SIMULATORS);
  });

  it('reads no list from an output that is not JSON', () => {
    expect(simulatorsIn('not json')).toBeNull();
    expect(simulatorsIn('')).toBeNull();
  });

  it('reads no list from JSON that does not hold devices by runtime', () => {
    expect(simulatorsIn('{}')).toBeNull();
    expect(simulatorsIn('{"devices": []}')).toBeNull();
    expect(simulatorsIn('{"devices": {"com.apple.CoreSimulator.SimRuntime.iOS-18-2": "none"}}')).toBeNull();
  });

  it('reads an empty list from a host that has no simulator', () => {
    expect(simulatorsIn('{"devices": {}}')).toEqual([]);
  });

  it('skips an entry that lacks a name, a UDID or a state', () => {
    const entries = [{ name: 'no udid', state: 'Shutdown' }, { udid: SHUT_DOWN_ID, state: 'Shutdown' }, { name: 'no state', udid: BOOTED_ID }, null, 'text'];

    expect(simulatorsIn(JSON.stringify({ devices: { runtime: [...entries, { name: 'whole', udid: BOOTED_ID, state: 'Booted' }] } }))).toEqual([
      { name: 'whole', udid: BOOTED_ID, state: 'Booted' },
    ]);
  });
});

describe('isShutDown', () => {
  it.each([
    ['Shutdown', true],
    ['Booted', false],
    ['Booting', false],
    ['Shutting Down', false],
  ])('reads a simulator in the state %s as %s', (state, shutDown) => {
    expect(isShutDown({ name: 'adw-x-y', udid: BOOTED_ID, state })).toBe(shutDown);
  });
});
