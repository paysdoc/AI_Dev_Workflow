/**
 * What the feature-1046 scenarios share: the platform the scenarios about reading one found, and the hooks. The other scenarios
 * of this feature run what feature-994 sets up (the proof assembler, and the scenario test phase and review phase over a
 * workflow), so their hooks do what feature-994's do. The feature-994 scenarios that also carry `@adw-1046` keep only their own.
 */

import assert from 'assert';
import { After, Before } from '@cucumber/cucumber';

import type { Platform } from '../../../adws/core/applicationType.ts';

import { setUpWorld994, tearDownWorld994 } from './feature-994-world.ts';

export interface State1046 {
  /** What the last read of an image's platform answered: null is unattributed, undefined is that no image was read. */
  platform: Platform | null | undefined;
}

function freshState(): State1046 {
  return { platform: undefined };
}

export const s: State1046 = freshState();

function resetState(): void {
  Object.assign(s, freshState());
}

export function requirePlatformRead(): Platform | null {
  assert.notStrictEqual(s.platform, undefined, "Expected the scenario to have read an image's platform first");
  return s.platform ?? null;
}

const OWN_SCENARIOS = '@adw-1046 and not @adw-994';

Before({ tags: OWN_SCENARIOS }, function () {
  setUpWorld994();
  resetState();
});

After({ tags: OWN_SCENARIOS }, function () {
  tearDownWorld994();
  resetState();
});
