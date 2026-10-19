/**
 * What the feature-1050 scenarios share: the workflows a scenario describes, alive or dead, with a worktree of some age or none;
 * what the device janitor logged and whether its sweep failed; and the hooks that reset these and the device worlds of feature-1047
 * whose steps they reuse. Scenarios of feature-1047 carry this feature's tag too and run their own hooks as well, so every reset
 * here is safe to run twice.
 */

import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { After, Before, type DataTable } from '@cucumber/cucumber';

import type { LogLevel } from '../../../adws/core/logger.ts';
import type { AgentState } from '../../../adws/types/agentTypes.ts';
import { JANITOR_GRACE_PERIOD_MS } from '../../../adws/triggers/devServerJanitor.ts';
import type { DeviceJanitorDeps } from '../../../adws/triggers/deviceJanitor.ts';

import { resetStandInDeviceHost, steppingClock, type StandInLeftoverDevice } from '../../regression/support/standInDevices.ts';
import { resetState as resetState1047 } from './feature-1047-world.ts';

/** Where the scenarios' target repositories are, for the worktrees they describe; no directory is made there. */
export const TARGET_REPOS = '/adw-1050-target-repos';

/** A workflow as a scenario describes it. */
export interface Workflow {
  readonly alive: boolean;
  /** How old its worktree is; `null` when it left neither state nor worktree behind. */
  readonly worktreeAgeMs: number | null;
}

export interface LoggedLine {
  readonly level: LogLevel;
  readonly message: string;
}

export interface State1050 {
  workflows: Map<string, Workflow>;
  /** Every line the device janitor logged, in the order logged. */
  lines: LoggedLine[];
  /** What the sweep rejected with, when it did; `undefined` once it has completed. */
  failure: unknown;
  /** Whether the sweep has run. */
  swept: boolean;
  /** Directories the scenario made, which its hook removes. */
  directories: string[];
}

function freshState(): State1050 {
  return { workflows: new Map(), lines: [], failure: undefined, swept: false, directories: [] };
}

export const s: State1050 = freshState();

export function resetState(): void {
  s.directories.forEach(directory => fs.rmSync(directory, { recursive: true, force: true }));
  Object.assign(s, freshState());
}

/** Older than the dev-server janitor's grace period, and inside it. */
export const OLDER_THAN_GRACE_PERIOD_MS = JANITOR_GRACE_PERIOD_MS * 2;
export const INSIDE_GRACE_PERIOD_MS = JANITOR_GRACE_PERIOD_MS / 2;

export function describeWorkflow(adwId: string, workflow: Workflow): void {
  s.workflows.set(adwId, workflow);
}

export function devicesOf(table: DataTable): StandInLeftoverDevice[] {
  return table.hashes().map(({ device, name, booted }) => {
    assert.ok(device === 'AVD' || device === 'simulator', `Expected the device to be "AVD" or "simulator", but the table says "${device}"`);
    assert.ok(booted === 'yes' || booted === 'no', `Expected "booted" to be "yes" or "no", but the table says "${booted}" for "${name}"`);
    return { kind: device, name, booted: booted === 'yes' };
  });
}

const branchOf = (adwId: string): string => `feature-issue-1-${adwId}`;

const worktreeOf = (adwId: string): string => path.join(TARGET_REPOS, 'acme', 'app', '.worktrees', branchOf(adwId));

function stateOf(adwId: string): AgentState | null {
  const workflow = s.workflows.get(adwId);
  if (workflow === undefined || workflow.worktreeAgeMs === null) return null;
  return {
    adwId,
    issueNumber: 1,
    agentName: 'orchestrator',
    execution: { status: 'running', startedAt: '2026-01-01T00:00:00Z' },
    repoIdentity: { owner: 'acme', repo: 'app' },
    branchName: branchOf(adwId),
  };
}

function worktreeAgeOf(worktreePath: string): number {
  const found = [...s.workflows].find(([adwId]) => worktreeOf(adwId) === worktreePath);
  return found?.[1].worktreeAgeMs ?? Infinity;
}

/** The janitor's dependencies over the workflows the scenario described, with a clock that no wait takes real time on. */
export function janitorDepsOver(devices: DeviceJanitorDeps['devices']): DeviceJanitorDeps {
  return {
    devices: { clock: steppingClock(), ...devices },
    readTopLevelState: stateOf,
    isAgentProcessRunning: adwId => s.workflows.get(adwId)?.alive ?? false,
    getWorktreeAgeMs: worktreeAgeOf,
    log: (message, level = 'info') => {
      s.lines.push({ level, message });
    },
  };
}

function resetWorlds(): void {
  resetState();
  resetState1047();
  resetStandInDeviceHost();
}

Before({ tags: '@adw-1050' }, resetWorlds);

After({ tags: '@adw-1050' }, resetWorlds);
