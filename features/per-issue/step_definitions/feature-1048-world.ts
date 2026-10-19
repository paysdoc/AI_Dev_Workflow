/**
 * The hooks of the feature-1048 scenarios, which bring up the worlds of the earlier features whose steps they reuse: the project
 * configuration (feature-991), the scenario test phase (feature-992), the attempts at it (feature-1045), the device lifecycle
 * (feature-1047) and the park comment (feature-989). Scenarios of those features carry this feature's tag too and run their own
 * hooks as well, so every reset here is safe to run twice.
 */

import { After, Before } from '@cucumber/cucumber';

import { beginScenario, endScenario } from '../../regression/step_definitions/feature-988-world.ts';
import { disposeToolchain } from '../../regression/step_definitions/feature-992-standins.ts';
import { resetState as resetState992 } from '../../regression/step_definitions/feature-992-world.ts';
import { resetStandInDeviceHost } from '../../regression/support/standInDevices.ts';
import { resetParkScenario } from './feature-989-park.steps.ts';
import { resetState as resetState991 } from './feature-991-world.ts';
import { resetState as resetState1045 } from './feature-1045-world.ts';
import { resetState as resetState1047 } from './feature-1047-world.ts';

function resetWorlds(): void {
  resetState991();
  resetState992();
  resetState1045();
  resetState1047();
  resetParkScenario();
  resetStandInDeviceHost();
}

Before({ tags: '@adw-1048' }, function () {
  beginScenario();
  resetWorlds();
});

After({ tags: '@adw-1048' }, async function () {
  await endScenario();
  disposeToolchain();
  resetWorlds();
});
