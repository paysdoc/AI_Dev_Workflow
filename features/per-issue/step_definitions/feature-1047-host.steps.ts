/**
 * The two steps that the scenarios of features 1043, 1045 and 1046 which run the real scenario test phase on a repository with
 * platforms share with feature-1047's: the host's device tools are stand-ins, and none of them has been run. The harnesses that
 * run the phase (feature-992's, feature-994's) hand it the stand-in device tools a scenario installed here.
 */

import { Given, Then } from '@cucumber/cucumber';
import assert from 'assert';

import { lastStandInDeviceHost, standInDeviceHost } from '../../regression/support/standInDevices.ts';

Given("the host's device tools are stand-ins that record each run and answer as a host on which the emulator and the simulator boot", function () {
  standInDeviceHost();
});

Then('no device tool was run', function () {
  const host = lastStandInDeviceHost();
  assert.ok(host, "Expected the scenario to have replaced the host's device tools with stand-ins first");
  assert.deepStrictEqual(host.commands.map(({ argv }) => argv.join(' ')), [], 'Expected no device tool to have been run');
});
