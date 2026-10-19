/**
 * Mapping scenarios of feature-1043: what the application-type mapping declares about the platforms of a type and about
 * the review guidance section it chooses. They read the consultation that feature-991's step made.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import { latestConsultation, profileOf } from './feature-991-mapping.steps.ts';

Then('the mapping declares exactly the platforms {string} and {string}', function (first: string, second: string) {
  const { platforms } = profileOf(latestConsultation());
  assert.deepStrictEqual(
    [...platforms],
    [first, second],
    `Expected the mapping to declare exactly the platforms "${first}" and "${second}", but it declares: ${platforms.join(', ') || 'none'}`,
  );
});

Then('the mapping declares no platform', function () {
  const { platforms } = profileOf(latestConsultation());
  assert.deepStrictEqual([...platforms], [], `Expected the mapping to declare no platform, but it declares: ${platforms.join(', ')}`);
});

Then('the mapping chooses the review guidance section {string}', function (section: string) {
  const { reviewGuidanceSection } = profileOf(latestConsultation());
  assert.strictEqual(reviewGuidanceSection, section, `Expected the mapping to choose the review guidance section "${section}", but it chose "${reviewGuidanceSection}"`);
});
