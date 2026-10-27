import { describe, expect, it } from 'vitest';
import { BOOTED_UDID, type LeftoverDevicesScript } from '../../core/__tests__/fixtures/leftoverDevicesHost';
import { runDeviceJanitorPass } from '../deviceJanitor';
import { OLD, TARGET_REPOS, janitorWorld, stateFor, worktreeOf, type JanitorWorldOptions } from './fixtures/deviceJanitorDeps';

const LOGIN_ID = 'k7m2p9-login-screen';
const LOGIN = `adw-${LOGIN_ID}`;
const LOGIN_BRANCH = 'feature-issue-7-login-screen';
const LOGIN_WORKTREE = worktreeOf(LOGIN_BRANCH);

const SETTINGS_ID = 'q4w8z1-settings-page';
const SETTINGS = `adw-${SETTINGS_ID}`;
const SETTINGS_BRANCH = 'feature-issue-8-settings-page';
const SETTINGS_WORKTREE = worktreeOf(SETTINGS_BRANCH);
const SETTINGS_UDID = '3C5E7A91-4B2D-4F68-8A0C-1D9E6B2F4A73';

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

const loginState = { ...stateFor('acme', 'app', LOGIN_BRANCH), issueNumber: 7 };
const settingsState = { ...stateFor('acme', 'app', SETTINGS_BRANCH), issueNumber: 8 };

const REMOVAL_COMMAND = /emu kill|avdmanager delete|simctl shutdown|simctl delete/;
const removalCommands = (events: readonly string[]): string[] => events.filter(event => REMOVAL_COMMAND.test(event));

// The state of such a workflow is that of an orchestrator that has exited, while the merge orchestrator runs in its worktree.
const worldOf = (options: Partial<JanitorWorldOptions>) =>
  janitorWorld({ script: LOGIN_DEVICES, states: { [LOGIN_ID]: loginState }, worktreeAges: { [LOGIN_WORKTREE]: OLD }, ...options });

describe('runDeviceJanitorPass: a workflow whose orchestrator the state does not show alive, but whose issue lock a live process holds', () => {
  it('leaves its devices alone however old its worktree, as a merge that re-runs the scenarios on the merged branch needs them', async () => {
    const world = worldOf({ lockedIssues: ['acme/app#7'] });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(removalCommands(world.host.events)).toEqual([]);
    expect(world.host.avds()).toEqual([LOGIN]);
    expect(world.host.runningEmulators()).toEqual({ 'emulator-5556': LOGIN });
    expect(world.host.simulators()).toEqual([{ name: LOGIN, udid: BOOTED_UDID, state: 'Booted' }]);
    expect(world.lines.filter(line => /removing|removed/.test(line))).toEqual([]);
  });

  it('asks about the lock of the issue and the repository that the state records', async () => {
    const world = worldOf({ lockedIssues: ['acme/app#7'] });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.lockChecks).toEqual(['acme/app#7']);
  });

  it('removes its devices as before when no live process holds the lock', async () => {
    const world = worldOf({ lockedIssues: [] });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.host.avds()).toEqual([]);
    expect(world.host.simulators()).toEqual([]);
    expect(world.lines.join('\n')).toContain('its orchestrator is not running and');
  });

  it('removes them when the lock held is that of another issue of the repository, or of the same issue of another repository', async () => {
    const world = worldOf({ lockedIssues: ['acme/app#8', 'acme/other#7', 'other/app#7'] });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.host.avds()).toEqual([]);
    expect(world.lockChecks).toEqual(['acme/app#7']);
  });

  it('keeps the devices of the locked workflow and removes those of a dead one beside them', async () => {
    const world = janitorWorld({
      script: BOTH_DEVICES,
      states: { [LOGIN_ID]: loginState, [SETTINGS_ID]: settingsState },
      lockedIssues: ['acme/app#8'],
      worktreeAges: { [LOGIN_WORKTREE]: OLD, [SETTINGS_WORKTREE]: OLD },
    });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.host.avds()).toEqual([SETTINGS]);
    expect(world.host.runningEmulators()).toEqual({ 'emulator-5558': SETTINGS });
    expect(world.host.simulators()).toEqual([{ name: SETTINGS, udid: SETTINGS_UDID, state: 'Booted' }]);
  });

  it('is not asked about when the state shows the orchestrator alive, since nothing is left to decide', async () => {
    const world = worldOf({ live: [LOGIN_ID], lockedIssues: ['acme/app#7'] });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.host.avds()).toEqual([LOGIN]);
    expect(world.lockChecks).toEqual([]);
  });
});

describe('runDeviceJanitorPass: a workflow whose state names no issue or no repository', () => {
  it('is judged on its orchestrator alone: no lock is asked after, and its devices are removed', async () => {
    const world = worldOf({ states: { [LOGIN_ID]: stateFor('acme', 'app', LOGIN_BRANCH) }, lockedIssues: ['acme/app#7'] });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.lockChecks).toEqual([]);
    expect(world.host.avds()).toEqual([]);
  });

  it('is judged the same way when the state records the issue and no repository', async () => {
    const world = worldOf({ states: { [LOGIN_ID]: { branchName: LOGIN_BRANCH, issueNumber: 7 } }, lockedIssues: ['acme/app#7'] });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.lockChecks).toEqual([]);
    expect(world.host.avds()).toEqual([]);
  });

  it('is judged on its orchestrator alone when it left no state at all', async () => {
    const world = janitorWorld({ script: LOGIN_DEVICES, lockedIssues: ['acme/app#7'] });

    await runDeviceJanitorPass(world.deps, TARGET_REPOS);

    expect(world.lockChecks).toEqual([]);
    expect(world.host.avds()).toEqual([]);
  });
});
