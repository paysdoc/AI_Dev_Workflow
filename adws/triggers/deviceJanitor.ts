/**
 * Removes the emulators and simulators that dead workflows left behind. A device named for an ADW ID is removed when that
 * ADW ID's orchestrator is not running and its worktree is outside the dev-server janitor's grace period; a device of a live
 * workflow, of a worktree inside the grace period, or not named for an ADW ID is never touched.
 */

import * as path from 'path';
import { getTargetRepoWorkspacePath } from '@paysdoc/devplatform/git';
import { log, TARGET_REPOS_DIR, type LogLevel } from '../core';
import { AgentStateManager } from '../core/agentState';
import { Platform } from '../core/applicationType';
import {
  listAdwDevices,
  removeAdwDevice,
  type AdwDevice,
  type DeviceInventoryDeps,
  type DeviceListing,
  type DeviceRemoval,
} from '../core/deviceLifecycle';
import { isAgentProcessRunning } from '../core/stateHelpers';
import type { AgentState } from '../types/agentTypes';
import { DEFAULT_DEPS as DEV_SERVER_JANITOR_DEPS, JANITOR_GRACE_PERIOD_MS } from './devServerJanitor';

export interface DeviceJanitorDeps {
  /** The lifecycle's executor and clock, which the listing and the removal of devices go through; empty for the lifecycle's own. */
  devices: Partial<DeviceInventoryDeps>;
  readTopLevelState: (adwId: string) => AgentState | null;
  isAgentProcessRunning: (adwId: string) => boolean;
  getWorktreeAgeMs: (worktreePath: string) => number;
  log: (message: string, level?: LogLevel) => void;
}

type Log = DeviceJanitorDeps['log'];

const MS_PER_MINUTE = 60_000;

/** Devices are kept unless the orchestrator is gone and the worktree is older than the grace period. */
export function shouldReapDevices(orchestratorAlive: boolean, worktreeAgeMs: number, gracePeriodMs: number): boolean {
  if (orchestratorAlive) return false;
  // <= is deliberately conservative, as it is for shouldCleanWorktree.
  return worktreeAgeMs > gracePeriodMs;
}

/** Null when the state records no repository or no branch. */
export function worktreePathOf(state: AgentState | null, targetReposDir: string): string | null {
  if (!state?.repoIdentity || !state.branchName) return null;
  const { owner, repo } = state.repoIdentity;
  // GitContext.worktreePathFor's layout, computed here because a GitContext would need the repository's credentials, which a sweep of local devices must not depend on.
  return path.join(getTargetRepoWorkspacePath(owner, repo, targetReposDir), '.worktrees', state.branchName);
}

export function groupByAdwId(devices: readonly AdwDevice[]): ReadonlyMap<string, readonly AdwDevice[]> {
  const addTo = (groups: ReadonlyMap<string, readonly AdwDevice[]>, device: AdwDevice): ReadonlyMap<string, readonly AdwDevice[]> =>
    new Map(groups).set(device.adwId, [...(groups.get(device.adwId) ?? []), device]);
  return devices.reduce(addTo, new Map<string, readonly AdwDevice[]>());
}

export function describeDevice(device: AdwDevice): string {
  if (device.platform === Platform.Ios) return `the iOS simulator "${device.name}" (${device.udid})`;
  return `the Android AVD "${device.name}"${device.serial === null ? '' : ` (${device.serial})`}`;
}

// A tool the host lacks is no failure: a host without it holds no device of its kind.
function devicesIn(listing: DeviceListing, platform: Platform, logLine: Log): readonly AdwDevice[] {
  if (listing.kind === 'listed') return listing.devices;
  if (listing.kind === 'failed') logLine(`Device janitor: could not list the ${platform} devices: ${listing.message}`, 'warn');
  return [];
}

const minutes = (ms: number): number => Math.round(ms / MS_PER_MINUTE);

function describeWorktree(worktreePath: string | null, ageMs: number): string {
  if (worktreePath === null) return 'no worktree is recorded for it';
  if (ageMs === Infinity) return `its worktree ${worktreePath} is gone`;
  return `its worktree ${worktreePath} is ${minutes(ageMs)} minutes old, past the ${minutes(JANITOR_GRACE_PERIOD_MS)}-minute grace period`;
}

/** Why the devices of an ADW ID are to be removed; null when they are to be left alone. */
function reapReason(adwId: string, deps: DeviceJanitorDeps, targetReposDir: string): string | null {
  const orchestratorAlive = deps.isAgentProcessRunning(adwId);
  const worktreePath = worktreePathOf(deps.readTopLevelState(adwId), targetReposDir);
  // A worktree that cannot be read is very old, as the dev-server janitor reads one.
  const ageMs = worktreePath === null ? Infinity : deps.getWorktreeAgeMs(worktreePath);
  if (!shouldReapDevices(orchestratorAlive, ageMs, JANITOR_GRACE_PERIOD_MS)) return null;
  return `its orchestrator is not running and ${describeWorktree(worktreePath, ageMs)}`;
}

function reportRemoval(adwId: string, { device, failures }: DeviceRemoval, logLine: Log): void {
  const subject = `${describeDevice(device)} of ADW ID ${adwId}`;
  if (failures.length === 0) {
    logLine(`Device janitor: removed ${subject}`, 'info');
    return;
  }
  failures.forEach(failure => logLine(`Device janitor: could not remove ${subject}: ${failure}`, 'warn'));
}

// One at a time: the emulators of one ADW ID are not all shut down at once.
async function removeDevices(adwId: string, devices: readonly AdwDevice[], deps: DeviceJanitorDeps): Promise<void> {
  for (const device of devices) {
    reportRemoval(adwId, await removeAdwDevice(device, deps.devices), deps.log);
  }
}

async function sweepAdwId(adwId: string, devices: readonly AdwDevice[], deps: DeviceJanitorDeps, targetReposDir: string): Promise<void> {
  try {
    const reason = reapReason(adwId, deps, targetReposDir);
    if (reason === null) return;

    deps.log(`Device janitor: removing ${devices.map(describeDevice).join(', ')} of ADW ID ${adwId}: ${reason}`, 'info');
    await removeDevices(adwId, devices, deps);
  } catch (err) {
    deps.log(`Device janitor: error sweeping the devices of ADW ID ${adwId}: ${err}`, 'warn');
  }
}

/**
 * Never rejects: a failure of the listing, of a removal, or of the decision for one ADW ID is logged as a warning, so the
 * cron tick goes on past it. Each ADW ID is decided on right before its devices are removed, so that an orchestrator that
 * came back to life since the listing is not caught out.
 */
export async function runDeviceJanitorPass(deps: DeviceJanitorDeps = DEFAULT_DEPS, targetReposDir: string = TARGET_REPOS_DIR): Promise<void> {
  try {
    const inventory = await listAdwDevices(deps.devices);
    const devices = Object.values(Platform).flatMap(platform => devicesIn(inventory[platform], platform, deps.log));
    if (devices.length === 0) return;

    const groups = groupByAdwId(devices);
    deps.log(`Device janitor: scanning ${devices.length} device(s) named for ${groups.size} ADW ID(s)`, 'info');
    for (const [adwId, grouped] of groups) {
      await sweepAdwId(adwId, grouped, deps, targetReposDir);
    }
  } catch (err) {
    deps.log(`Device janitor: pass failed: ${err}`, 'warn');
  }
}

// The liveness and age checks are the dev-server janitor's own, so that both janitors agree on what a live workflow and a young worktree are.
const defaultDeps: DeviceJanitorDeps = {
  devices: {},
  readTopLevelState: AgentStateManager.readTopLevelState,
  isAgentProcessRunning,
  getWorktreeAgeMs: DEV_SERVER_JANITOR_DEPS.getWorktreeAgeMs,
  log,
};

/** Exported frozen so tests and step definitions can spread it and override only what touches devices, state and processes. */
export const DEFAULT_DEPS: DeviceJanitorDeps = Object.freeze(defaultDeps);
