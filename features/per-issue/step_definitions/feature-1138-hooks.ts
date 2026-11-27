import { After, Before } from '@cucumber/cucumber';

import { setupMockInfrastructure, teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';
import { runCleanup } from '../../regression/support/cleanup.ts';
import { createSubprocessHarness } from '../../regression/support/subprocessHarness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// The suite's own hooks set up the mock server and the subprocess harness only for `@regression`, which a per-issue scenario lacks.
const OWN_SUBPROCESS_SCENARIO = '@adw-1138 and @subprocess and not @regression';

Before({ tags: OWN_SUBPROCESS_SCENARIO }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  this.subprocess = createSubprocessHarness(this);
});

After({ tags: OWN_SUBPROCESS_SCENARIO }, async function (this: RegressionWorld) {
  await runCleanup(this);
  await teardownMockInfrastructure();
});
