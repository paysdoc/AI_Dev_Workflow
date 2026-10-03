/**
 * The hooks of feature-964.feature. Feature-963's child-run steps put their temporary directories on
 * the World's cleanup list, and no @regression hook runs for this feature. The tag is the feature's
 * own, never `@adw-964`, which feature-960's surface-rows scenario also carries.
 */

import { After } from '@cucumber/cucumber';
import { runCleanup } from '../../regression/support/cleanup.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

After({ tags: '@adw-n5cfq2-bug-move-the-test-re' }, async function (this: RegressionWorld) {
  await runCleanup(this);
});
