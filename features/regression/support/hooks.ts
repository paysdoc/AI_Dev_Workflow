import { Before, After, setDefaultTimeout } from '@cucumber/cucumber';
import { productionGuardrailsGateDeps, setGuardrailsGateDepsForTesting } from '../../../adws/core/guardrailsGate.ts';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../step_definitions/world.ts';
import { runCleanup } from './cleanup.ts';
import { createSubprocessHarness } from './subprocessHarness.ts';

// Pause-queue scenarios wait out the resume path's readiness window and poll up to 10 s for a relaunch, which outlasts the 5 s Cucumber default.
setDefaultTimeout(60_000);

// Every target-repo agent start reaches the guardrails probe, a paid, network-bound `claude` run whose failure alerts Slack, so no scenario may run the real one.
Before(function () {
  setGuardrailsGateDepsForTesting({
    ...productionGuardrailsGateDeps,
    probeGuardrails: async () => ({ ok: false }),
    notifySlack: async () => undefined,
  });
});

After(function () {
  setGuardrailsGateDepsForTesting(null);
});

Before({ tags: '@regression' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

// Declared right after the hook above, which sets up the mock server, so the order is guaranteed by this file.
// A `@webhook` scenario needs the same workspace and adwId claims, but keys on neither `@smoke` nor `@surface`: those tags would also run the orchestrators of the rows that stay pending.
Before({ tags: '@regression and (@subprocess or @webhook)' }, function (this: RegressionWorld) {
  this.subprocess = createSubprocessHarness(this);
});

After({ tags: '@regression' }, async function (this: RegressionWorld) {
  await runCleanup(this);
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.subprocess = null;
  this.lastExitCode = -1;
  this.lastOutput = '';
  this.seededIssues = new Set();
  this.matchedLaunch = null;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
  this.phaseOutcome = undefined;
  this.lifecycleOutcome = undefined;
  this.depauditOutcome = undefined;
  this.cleanup = [];
});
