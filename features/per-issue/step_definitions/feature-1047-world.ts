/**
 * What the feature-1047 scenarios share, and the hooks that bring up the worlds of the earlier features whose steps they
 * reuse: the project configuration (feature-991), the scenario test phase (feature-992) and the review phase (feature-994).
 * Scenarios of features 1043, 1045 and 1046 carry this feature's tag too, and run those features' hooks as well, so every
 * reset here is safe to run twice.
 */

import assert from 'assert';
import { After, Before } from '@cucumber/cucumber';

import type { DeviceEnvironment } from '../../../adws/core/deviceLifecycle.ts';
import type { DeviceSource } from '../../../adws/core/deviceSourceConfig.ts';

import { beginScenario, endScenario } from '../../regression/step_definitions/feature-988-world.ts';
import { disposeToolchain } from '../../regression/step_definitions/feature-992-standins.ts';
import { resetState as resetState992 } from '../../regression/step_definitions/feature-992-world.ts';
import {
  resetStandInDeviceHost,
  standInDeviceExecutor,
  type StandInDeviceCommand,
  type StandInDeviceExecutor,
  type StandInDeviceOptions,
} from '../../regression/support/standInDevices.ts';
import { resetState as resetState991 } from './feature-991-world.ts';
import { setUpWorld994, tearDownWorld994 } from './feature-994-world.ts';

/** One run of the device lifecycle that a scenario drove directly, with a callback of its own. */
export interface LifecycleRun {
  readonly adwId: string;
  /** What each call of the callback was given. */
  readonly given: readonly DeviceEnvironment[];
  /** What the lifecycle came back with; absent when it failed. */
  readonly returned: unknown;
  /** What the lifecycle failed with; absent when it came back. */
  readonly failure: unknown;
  /** What the callback threw, when the scenario told it to. */
  readonly thrown: unknown;
}

export interface State1047 {
  deviceSource: DeviceSource | null;
  /** How the recording executor is to answer; null until a step has described it. */
  executorOptions: StandInDeviceOptions | null;
  /** Made when the lifecycle first runs, so that the steps that describe the executor have all been heard. */
  executor: StandInDeviceExecutor | null;
  runs: LifecycleRun[];
}

function freshState(): State1047 {
  return { deviceSource: null, executorOptions: null, executor: null, runs: [] };
}

export const s: State1047 = freshState();

export function resetState(): void {
  Object.assign(s, freshState());
}

export function requireDeviceSource(): DeviceSource {
  assert.ok(s.deviceSource, 'Expected the scenario to have said what the devices are created from first');
  return s.deviceSource;
}

export function requireExecutor(): StandInDeviceExecutor {
  assert.ok(s.executorOptions, 'Expected the scenario to have described the recording executor first');
  s.executor ??= standInDeviceExecutor(s.executorOptions);
  return s.executor;
}

export function requireRun(): LifecycleRun {
  const run = s.runs[s.runs.length - 1];
  assert.ok(run, 'Expected the device lifecycle to have run first');
  return run;
}

/** Every command the recording executor was given, and the calls of the callback, in the order they came. */
export function recordedCommands(): readonly StandInDeviceCommand[] {
  assert.ok(s.executor, 'Expected the device lifecycle to have run on the recording executor first');
  return s.executor.commands;
}

function resetWorlds(): void {
  resetState991();
  resetState992();
  resetState();
  resetStandInDeviceHost();
}

Before({ tags: '@adw-1047' }, function () {
  beginScenario();
  setUpWorld994();
  resetWorlds();
});

After({ tags: '@adw-1047' }, async function () {
  await endScenario();
  tearDownWorld994();
  disposeToolchain();
  resetWorlds();
});
