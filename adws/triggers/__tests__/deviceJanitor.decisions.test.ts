import { describe, expect, it } from 'vitest';
import { Platform } from '../../core/applicationType';
import type { AdwAvd, AdwSimulator } from '../../core/deviceLifecycle';
import { BOOTED_UDID } from '../../core/__tests__/fixtures/leftoverDevicesHost';
import { JANITOR_GRACE_PERIOD_MS } from '../devServerJanitor';
import { describeDevice, groupByAdwId, shouldReapDevices, worktreePathOf } from '../deviceJanitor';
import { OLD, TARGET_REPOS, YOUNG, agentStateOf, stateFor, worktreeOf } from './fixtures/deviceJanitorDeps';

const LOGIN_ID = 'k7m2p9-login-screen';
const LOGIN = `adw-${LOGIN_ID}`;
const LOGIN_BRANCH = 'feature-issue-7-login-screen';
const SETTINGS_ID = 'q4w8z1-settings-page';
const SETTINGS = `adw-${SETTINGS_ID}`;

const loginAvd: AdwAvd = { platform: Platform.Android, adwId: LOGIN_ID, name: LOGIN, serial: 'emulator-5556' };
const loginSimulator: AdwSimulator = { platform: Platform.Ios, adwId: LOGIN_ID, name: LOGIN, udid: BOOTED_UDID, booted: true };
const settingsAvd: AdwAvd = { platform: Platform.Android, adwId: SETTINGS_ID, name: SETTINGS, serial: null };

describe('shouldReapDevices', () => {
  it.each([
    { when: 'the orchestrator is alive and the worktree is old', alive: true, ageMs: OLD, reaped: false },
    { when: 'the orchestrator is alive and the worktree is young', alive: true, ageMs: YOUNG, reaped: false },
    { when: 'the orchestrator is alive and there is no worktree to read', alive: true, ageMs: Infinity, reaped: false },
    { when: 'the orchestrator is dead and the worktree is young', alive: false, ageMs: YOUNG, reaped: false },
    { when: 'the orchestrator is dead and the worktree is old', alive: false, ageMs: OLD, reaped: true },
    { when: 'the orchestrator is dead and there is no worktree to read', alive: false, ageMs: Infinity, reaped: true },
  ])('reaps the devices: $reaped, when $when', ({ alive, ageMs, reaped }) => {
    expect(shouldReapDevices(alive, ageMs, JANITOR_GRACE_PERIOD_MS)).toBe(reaped);
  });

  it('keeps the devices of a worktree that is exactly as old as the grace period', () => {
    expect(shouldReapDevices(false, JANITOR_GRACE_PERIOD_MS, JANITOR_GRACE_PERIOD_MS)).toBe(false);
  });

  it('removes them one millisecond later', () => {
    expect(shouldReapDevices(false, JANITOR_GRACE_PERIOD_MS + 1, JANITOR_GRACE_PERIOD_MS)).toBe(true);
  });
});

describe('worktreePathOf', () => {
  it('is where the workflow of that repository and branch keeps its worktree', () => {
    expect(worktreePathOf(agentStateOf(LOGIN_ID, stateFor('acme', 'app', LOGIN_BRANCH)), TARGET_REPOS)).toBe(worktreeOf(LOGIN_BRANCH));
  });

  it('is null for a workflow with no state, or one that recorded no repository or no branch', () => {
    expect(worktreePathOf(null, TARGET_REPOS)).toBeNull();
    expect(worktreePathOf(agentStateOf(LOGIN_ID, { branchName: LOGIN_BRANCH }), TARGET_REPOS)).toBeNull();
    expect(worktreePathOf(agentStateOf(LOGIN_ID, { repoIdentity: { owner: 'acme', repo: 'app' } }), TARGET_REPOS)).toBeNull();
  });
});

describe('groupByAdwId', () => {
  it('groups the devices by ADW ID, in the order they were listed', () => {
    const groups = groupByAdwId([settingsAvd, loginAvd, loginSimulator]);

    expect([...groups.keys()]).toEqual([SETTINGS_ID, LOGIN_ID]);
    expect(groups.get(LOGIN_ID)).toEqual([loginAvd, loginSimulator]);
  });

  it('has no group for no device', () => {
    expect(groupByAdwId([]).size).toBe(0);
  });
});

describe('describeDevice', () => {
  it('names an AVD with the serial of its emulator, when one runs', () => {
    expect(describeDevice(loginAvd)).toBe(`the Android AVD "${LOGIN}" (emulator-5556)`);
    expect(describeDevice(settingsAvd)).toBe(`the Android AVD "${SETTINGS}"`);
  });

  it('names a simulator with its UDID', () => {
    expect(describeDevice(loginSimulator)).toBe(`the iOS simulator "${LOGIN}" (${BOOTED_UDID})`);
  });
});
