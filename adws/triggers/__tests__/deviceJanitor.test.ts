import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BOOTED_UDID, SHUT_DOWN_UDID, type LeftoverDevicesScript } from '../../core/__tests__/fixtures/leftoverDevicesHost';
import { firstOutOfOrder } from '../../core/__tests__/fixtures/recordingDeviceHost';
import { JANITOR_GRACE_PERIOD_MS } from '../devServerJanitor';
import { DEFAULT_DEPS, runDeviceJanitorPass } from '../deviceJanitor';
import { OLD, TARGET_REPOS, YOUNG, janitorWorld, stateFor, worktreeOf, type JanitorWorldOptions } from './fixtures/deviceJanitorDeps';

const LOGIN_ID = 'k7m2p9-login-screen';
const LOGIN = `adw-${LOGIN_ID}`;
const LOGIN_BRANCH = 'feature-issue-7-login-screen';
const LOGIN_WORKTREE = worktreeOf(LOGIN_BRANCH);
const LOGIN_STATE = { [LOGIN_ID]: stateFor('acme', 'app', LOGIN_BRANCH) };

const SETTINGS_ID = 'q4w8z1-settings-page';
const SETTINGS = `adw-${SETTINGS_ID}`;
const SETTINGS_BRANCH = 'feature-issue-8-settings-page';
const SETTINGS_WORKTREE = worktreeOf(SETTINGS_BRANCH);
const SETTINGS_UDID = '3C5E7A91-4B2D-4F68-8A0C-1D9E6B2F4A73';
const IPHONE_UDID = 'D2F4A6B8-1C3E-4579-8A0B-9C1D2E3F4A5B';
const IPAD_UDID = '6A8C0E24-5B7D-4F91-A3C5-7E9F1B3D5A70';
const NAMED_LIKE_ADW_UDID = 'F1E3D5C7-9B2A-4680-8C4E-0A2B4D6F8E13';

const LOGIN_DEVICES: Partial<LeftoverDevicesScript> = {
  avds: [LOGIN],
  emulators: { 'emulator-5556': LOGIN },
  simulators: [{ name: LOGIN, udid: BOOTED_UDID, state: 'Booted' }],
};

const BOTH_DEVICES: Partial<LeftoverDevicesScript> = {
  avds: [SETTINGS, LOGIN],
  emulators: { 'emulator-5558': SETTINGS, 'emulator-5556': LOGIN },
  simulators: [
    { name: SETTINGS, udid: SETTINGS_UDID, state: 'Booted' },
    { name: LOGIN, udid: BOOTED_UDID, state: 'Booted' },
  ],
};

const BOTH_STATES = { ...LOGIN_STATE, [SETTINGS_ID]: stateFor('acme', 'app', SETTINGS_BRANCH) };

const REMOVAL_COMMAND = /emu kill|avdmanager delete|simctl shutdown|simctl delete/;
const removalCommands = (events: readonly string[]): string[] => events.filter(event => REMOVAL_COMMAND.test(event));

const sweptWorld = (options: Partial<JanitorWorldOptions>) => janitorWorld({ script: LOGIN_DEVICES, states: LOGIN_STATE, ...options });

describe('runDeviceJanitorPass: the devices of an ADW ID that has no live orchestrator and a worktree outside the grace period', () => {
  it('shuts down and deletes the AVD and the simulator, in that order, and leaves none on the host', async () => {
    const world = sweptWorld({ worktreeAges: { [LOGIN_WORKTREE]: OLD } });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(firstOutOfOrder(world.host.events, ['adb -s emulator-5556 emu kill', 'adb devices', `avdmanager delete avd --name ${LOGIN}`])).toBeUndefined();
    expect(firstOutOfOrder(world.host.events, [`xcrun simctl shutdown ${BOOTED_UDID}`, `xcrun simctl delete ${BOOTED_UDID}`])).toBeUndefined();
    expect(world.host.avds()).toEqual([]);
    expect(world.host.simulators()).toEqual([]);
    expect(world.host.runningEmulators()).toEqual({});
  });

  it('logs the devices, the ADW ID and the reason once, and then the removal of each device', async () => {
    const world = sweptWorld({ worktreeAges: { [LOGIN_WORKTREE]: OLD } });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.lines).toEqual([
      'info Device janitor: scanning 2 device(s) named for 1 ADW ID(s)',
      `info Device janitor: removing the Android AVD "${LOGIN}" (emulator-5556), the iOS simulator "${LOGIN}" (${BOOTED_UDID}) of ADW ID ${LOGIN_ID}: its orchestrator is not running and its worktree ${LOGIN_WORKTREE} is 60 minutes old, past the 30-minute grace period`,
      `info Device janitor: removed the Android AVD "${LOGIN}" (emulator-5556) of ADW ID ${LOGIN_ID}`,
      `info Device janitor: removed the iOS simulator "${LOGIN}" (${BOOTED_UDID}) of ADW ID ${LOGIN_ID}`,
    ]);
  });

  it('removes the devices of an ADW ID that left no state, as after a cancel', async () => {
    const world = janitorWorld({ script: LOGIN_DEVICES });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.host.avds()).toEqual([]);
    expect(world.host.simulators()).toEqual([]);
    expect(world.lines.join('\n')).toContain('its orchestrator is not running and no worktree is recorded for it');
  });

  it('removes the devices of an ADW ID whose recorded worktree is gone', async () => {
    const world = sweptWorld({});

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.host.avds()).toEqual([]);
    expect(world.lines.join('\n')).toContain(`its orchestrator is not running and its worktree ${LOGIN_WORKTREE} is gone`);
  });

  it('removes both simulators of one name, the booted one and the shut-down one, each by its UDID', async () => {
    const simulators = [
      { name: LOGIN, udid: BOOTED_UDID, state: 'Booted' },
      { name: LOGIN, udid: SHUT_DOWN_UDID, state: 'Shutdown' },
    ];
    const world = janitorWorld({ script: { simulators }, states: LOGIN_STATE, worktreeAges: { [LOGIN_WORKTREE]: OLD } });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(removalCommands(world.host.events)).toEqual([`xcrun simctl shutdown ${BOOTED_UDID}`, `xcrun simctl delete ${BOOTED_UDID}`, `xcrun simctl delete ${SHUT_DOWN_UDID}`]);
    expect(world.host.simulators()).toEqual([]);
  });

  it('only deletes an AVD from which no emulator runs', async () => {
    const world = janitorWorld({ script: { avds: [LOGIN] }, states: LOGIN_STATE });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(removalCommands(world.host.events)).toEqual([`avdmanager delete avd --name ${LOGIN}`]);
  });
});

describe('runDeviceJanitorPass: the devices it leaves alone', () => {
  const untouched = (world: ReturnType<typeof sweptWorld>): void => {
    expect(removalCommands(world.host.events)).toEqual([]);
    expect(world.host.avds()).toEqual([LOGIN]);
    expect(world.host.runningEmulators()).toEqual({ 'emulator-5556': LOGIN });
    expect(world.host.simulators()).toEqual([{ name: LOGIN, udid: BOOTED_UDID, state: 'Booted' }]);
    expect(world.lines.filter(line => /removing|removed/.test(line))).toEqual([]);
  };

  it('leaves the devices of an ADW ID whose orchestrator is alive, however old its worktree', async () => {
    const world = sweptWorld({ live: [LOGIN_ID], worktreeAges: { [LOGIN_WORKTREE]: OLD } });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    untouched(world);
  });

  it('leaves the devices of an ADW ID whose orchestrator is alive and that left no worktree', async () => {
    const world = janitorWorld({ script: LOGIN_DEVICES, live: [LOGIN_ID] });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    untouched(world);
  });

  it('leaves the devices of an ADW ID with no live orchestrator whose worktree is inside the grace period', async () => {
    const world = sweptWorld({ worktreeAges: { [LOGIN_WORKTREE]: YOUNG } });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    untouched(world);
  });

  it('leaves them at exactly the grace period, as the dev-server janitor leaves a worktree, and removes them one millisecond later', async () => {
    const atTheBoundary = sweptWorld({ worktreeAges: { [LOGIN_WORKTREE]: JANITOR_GRACE_PERIOD_MS } });
    const pastIt = sweptWorld({ worktreeAges: { [LOGIN_WORKTREE]: JANITOR_GRACE_PERIOD_MS + 1 } });

    await runDeviceJanitorPass(atTheBoundary.deps, TARGET_REPOS);
    await runDeviceJanitorPass(pastIt.deps, TARGET_REPOS);

    untouched(atTheBoundary);
    expect(pastIt.host.avds()).toEqual([]);
  });

  it('removes the devices of the dead ADW ID beside those of a live one, and the live one keeps its emulator running', async () => {
    const world = janitorWorld({ script: BOTH_DEVICES, states: BOTH_STATES, live: [SETTINGS_ID], worktreeAges: { [LOGIN_WORKTREE]: OLD, [SETTINGS_WORKTREE]: OLD } });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.host.avds()).toEqual([SETTINGS]);
    expect(world.host.runningEmulators()).toEqual({ 'emulator-5558': SETTINGS });
    expect(world.host.simulators()).toEqual([{ name: SETTINGS, udid: SETTINGS_UDID, state: 'Booted' }]);
    expect(removalCommands(world.host.events).join('\n')).not.toContain(SETTINGS);
  });

  it('decides on each ADW ID right before it removes the devices of that ADW ID, not all of them up front', async () => {
    const world = janitorWorld({ script: BOTH_DEVICES, states: BOTH_STATES, worktreeAges: { [LOGIN_WORKTREE]: OLD, [SETTINGS_WORKTREE]: OLD } });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.asked).toEqual([SETTINGS_ID, LOGIN_ID]);
    expect(
      firstOutOfOrder(world.host.events, [
        `orchestrator of ${SETTINGS_ID}?`,
        `avdmanager delete avd --name ${SETTINGS}`,
        `xcrun simctl delete ${SETTINGS_UDID}`,
        `orchestrator of ${LOGIN_ID}?`,
        `avdmanager delete avd --name ${LOGIN}`,
        `xcrun simctl delete ${BOOTED_UDID}`,
      ]),
    ).toBeUndefined();
  });
});

describe('runDeviceJanitorPass: the devices that are not named for an ADW ID', () => {
  const OPERATORS: Partial<LeftoverDevicesScript> = {
    avds: ['Pixel_8_API_35', 'Medium_Phone_API_35', 'adw-test', 'adw-K7M2P9-login'],
    emulators: { 'emulator-5554': 'Pixel_8_API_35' },
    simulators: [
      { name: 'iPhone 16 Pro', udid: IPHONE_UDID, state: 'Booted' },
      { name: 'iPad Air 11-inch (M2)', udid: IPAD_UDID, state: 'Shutdown' },
      { name: 'adw-test', udid: NAMED_LIKE_ADW_UDID, state: 'Shutdown' },
    ],
  };

  it('never shuts down or deletes one, asks nothing about one, and logs nothing', async () => {
    const world = janitorWorld({ script: OPERATORS });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.host.events).toEqual(['avdmanager list avd -c', 'xcrun simctl list --json devices']);
    expect(world.host.avds()).toEqual(OPERATORS.avds);
    expect(world.host.simulators()).toHaveLength(3);
    expect(world.asked).toEqual([]);
    expect(world.lines).toEqual([]);
  });

  it('removes the devices of a dead ADW ID beside them, and touches none of theirs', async () => {
    const world = janitorWorld({
      script: { avds: [...(OPERATORS.avds ?? []), LOGIN], emulators: { ...OPERATORS.emulators, 'emulator-5556': LOGIN }, simulators: [...(OPERATORS.simulators ?? []), { name: LOGIN, udid: BOOTED_UDID, state: 'Booted' }] },
      states: LOGIN_STATE,
      worktreeAges: { [LOGIN_WORKTREE]: OLD },
    });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.host.avds()).toEqual(OPERATORS.avds);
    expect(world.host.runningEmulators()).toEqual({ 'emulator-5554': 'Pixel_8_API_35' });
    expect(world.host.simulators().map(({ name }) => name)).toEqual(['iPhone 16 Pro', 'iPad Air 11-inch (M2)', 'adw-test']);
    expect(world.asked).toEqual([LOGIN_ID]);
  });
});

describe('runDeviceJanitorPass: the worktree on a real file system', () => {
  it('leaves the devices of a worktree that has just been created, and removes them once the worktree is gone', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-janitor-'));
    try {
      const worktree = path.join(root, 'acme', 'app', '.worktrees', LOGIN_BRANCH);
      fs.mkdirSync(worktree, { recursive: true });
      const world = sweptWorld({});
      const deps = { ...world.deps, getWorktreeAgeMs: DEFAULT_DEPS.getWorktreeAgeMs };

      await runDeviceJanitorPass(deps, root);
      expect(world.host.avds()).toEqual([LOGIN]);

      fs.rmSync(worktree, { recursive: true });
      await runDeviceJanitorPass(deps, root);
      expect(world.host.avds()).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
