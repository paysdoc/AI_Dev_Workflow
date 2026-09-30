import { Before, After, setDefaultTimeout } from '@cucumber/cucumber';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../step_definitions/world.ts';

// Pause-queue scenarios wait out the resume path's readiness window and poll up to 10 s for a relaunch, which outlasts the 5 s Cucumber default.
setDefaultTimeout(60_000);

Before({ tags: '@regression' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@regression' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});
