/**
 * Steps of the feature-1046 scenarios that read the platform of one image path: the pure function, driven with the platforms of a
 * profile the scenario names. The expected platform is the one the scenario's table says.
 */

import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';

import { Platform } from '../../../adws/core/applicationType.ts';
import { platformOfImage } from '../../../adws/proof/imagePlatform.ts';

import { requirePlatformRead, s } from './feature-1046-world.ts';

function platformNamed(name: string): Platform {
  const platform = Object.values(Platform).find(candidate => candidate === name);
  assert.ok(platform, `Unknown platform "${name}"; the scenarios say one of: ${Object.values(Platform).join(', ')}`);
  return platform;
}

When(
  'the platform of the image at {string} under the harvest root is read, for a profile whose platforms are {string} and {string}',
  function (relPath: string, first: string, second: string) {
    s.platform = platformOfImage(relPath, [platformNamed(first), platformNamed(second)]);
  },
);

When(
  'the platform of the image at {string} under the harvest root is read, for a profile whose only platform is {string}',
  function (relPath: string, only: string) {
    s.platform = platformOfImage(relPath, [platformNamed(only)]);
  },
);

Then("the image's platform is {string}", function (name: string) {
  assert.strictEqual(requirePlatformRead(), platformNamed(name), `Expected the image's platform to be "${name}", but it is ${String(s.platform)}`);
});

Then('the image is unattributed', function () {
  assert.strictEqual(requirePlatformRead(), null, `Expected the image to be unattributed, but its platform is "${String(s.platform)}"`);
});
