/**
 * What the feature-1049 scenarios share, and the hooks that bring up the worlds of the earlier features whose steps they
 * reuse: the project configuration (feature-991), the workflow and its ".adw/" (feature-992), the attempts at the scenario
 * test phase (feature-1045), the stand-in device host (feature-1047), the park comment (feature-989) and the scenario
 * runner of feature-990, whose log the scenarios read back. The scenarios run the real gate in process, over a real git
 * repository whose `dev` branch is the base branch, so no orchestrator process and no mock forge is needed.
 */

import { After, Before } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { sharedBaseWorktree } from '../../../adws/phases/baseWorktree.ts';

import { beginScenario, endScenario, s as workflowWorld } from '../../regression/step_definitions/feature-988-world.ts';
import { disposeToolchain } from '../../regression/step_definitions/feature-992-standins.ts';
import { registerDirectory, resetState as resetState992 } from '../../regression/step_definitions/feature-992-world.ts';
import { resetStandInDeviceHost, type StandInDeviceCommand } from '../../regression/support/standInDevices.ts';
import { resetParkScenario } from './feature-989-park.steps.ts';
import { scratchPaths } from '../../regression/step_definitions/feature-990-scripts.ts';
import { resetState as resetState990, s as state990 } from '../../regression/step_definitions/feature-990-world.ts';
import { resetState as resetState991 } from './feature-991-world.ts';
import { resetState as resetState1045 } from './feature-1045-world.ts';
import { resetState as resetState1047 } from './feature-1047-world.ts';

/** What the stand-in device host held at the moment the workflow was parked: the process would have ended there. */
export interface HostAtPark {
  readonly commands: readonly StandInDeviceCommand[];
  readonly running: readonly string[];
}

/** The program the worktree's ".adw/" names to run the scenarios of a tag. */
export type ScenarioRunner = 'scenario-runner' | 'npx';

export interface State1049 {
  /** The branch the scenario says holds the same ".adw/" as the worktree; it is committed to when the gate first runs, once every step that shapes the files has been heard. */
  baseBranch: string | null;
  runner: ScenarioRunner | null;
  /** Every scenario of the target repository fails when it runs without the device variables. */
  requiresDevices: boolean;
  /** Null until the gate has parked the workflow. */
  atPark: HostAtPark | null;
}

function freshState(): State1049 {
  return { baseBranch: null, runner: null, requiresDevices: false, atPark: null };
}

export const s: State1049 = freshState();

export function resetState(): void {
  Object.assign(s, freshState());
}

export function requireBaseBranch(): string {
  assert.ok(s.baseBranch, 'Expected the scenario to have said which branch holds the same ".adw/" as the worktree first');
  return s.baseBranch;
}

export function requireRunner(): ScenarioRunner {
  assert.ok(s.runner, "Expected the scenario to have said which program runs the worktree's scenarios first");
  return s.runner;
}

export function requireAtPark(): HostAtPark {
  assert.ok(s.atPark, 'Expected the gate to have parked the workflow first');
  return s.atPark;
}

function resetWorlds(): void {
  resetState991();
  resetState992();
  resetState1045();
  resetState1047();
  resetState990();
  resetState();
  resetParkScenario();
  resetStandInDeviceHost();
}

/** The base checkout is a worktree of the workflow's repository, which the temporary directories go with: it is removed first, as the orchestrator removes it. */
function removeBaseCheckout(): void {
  const config = workflowWorld.workflow?.config;
  if (config) sharedBaseWorktree(config).remove();
}

Before({ tags: '@adw-1049' }, function () {
  beginScenario();
  resetWorlds();
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-1049-'));
  registerDirectory(scratchDir);
  state990.scratch = scratchPaths(scratchDir);
});

After({ tags: '@adw-1049' }, async function () {
  removeBaseCheckout();
  await endScenario();
  disposeToolchain();
  resetWorlds();
});
