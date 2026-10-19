/**
 * What the feature-1045 scenarios share, and the hooks that bring up the worlds of the earlier features whose steps they
 * reuse: the project configuration (feature-991), the scenario test phase (feature-992) and the review phase (feature-994).
 * Three scenarios of feature-1043 carry this feature's tag too, and run that feature's hooks as well, so every reset here is
 * safe to run twice.
 */

import assert from 'assert';
import { After, Before } from '@cucumber/cucumber';

import type { DeviceSourceResolution } from '../../../adws/core/deviceSourceConfig.ts';

import { beginScenario, endScenario } from '../../regression/step_definitions/feature-988-world.ts';
import { disposeToolchain } from '../../regression/step_definitions/feature-992-standins.ts';
import { resetState as resetState992 } from '../../regression/step_definitions/feature-992-world.ts';
import { resetState as resetState991 } from './feature-991-world.ts';
import { setUpWorld994, tearDownWorld994 } from './feature-994-world.ts';

/** How an attempt at the scenario test phase ended: it returned, or it threw. */
export interface PhaseAttempt {
  readonly completed: boolean;
  readonly error: unknown;
}

export interface State1045 {
  /** What `resolveDeviceSource` answered for the project configuration the scenario read. */
  resolution: DeviceSourceResolution | null;
  attempt: PhaseAttempt | null;
}

function freshState(): State1045 {
  return { resolution: null, attempt: null };
}

export const s: State1045 = freshState();

function resetState(): void {
  Object.assign(s, freshState());
}

export function requireResolution(): DeviceSourceResolution {
  assert.ok(s.resolution, 'Expected the device sources to have been resolved first');
  return s.resolution;
}

export function requireAttempt(): PhaseAttempt {
  assert.ok(s.attempt, "Expected the workflow's scenario test phase to have been attempted first");
  return s.attempt;
}

function resetWorlds(): void {
  resetState991();
  resetState992();
  resetState();
}

Before({ tags: '@adw-1045' }, function () {
  beginScenario();
  setUpWorld994();
  resetWorlds();
});

After({ tags: '@adw-1045' }, async function () {
  await endScenario();
  tearDownWorld994();
  disposeToolchain();
  resetWorlds();
});
