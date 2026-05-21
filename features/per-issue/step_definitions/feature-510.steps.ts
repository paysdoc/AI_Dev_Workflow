/**
 * BDD step definitions for feature-510.feature
 * HITL label + tag lifecycle — refresh date, suppress duplicates, withdraw on score drop
 *
 * Design decisions:
 *  - Reuses the regression mock harness (setupMockInfrastructure / teardownMockInfrastructure)
 *    via a Before/After hook tagged @adw-510. This makes the regression Given steps
 *    (G3, G4, G11, G12) that depend on this.mockContext usable from these per-issue scenarios.
 *  - All step definitions return 'pending' — the BDD harness does not yet drive a real
 *    subprocess to completion under 30s. The unit tests in adws/promotion/__tests__/ carry
 *    the executable proof of the behavioural changes (slice #5 plan §Testing Strategy).
 *    Step definitions become live assertions when subprocess invocation lands in slice #6.
 */

import { Before, After } from '@cucumber/cucumber';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-510 so they don't fire on every
// scenario and don't interfere with the @regression hook ordering.
// ---------------------------------------------------------------------------

Before({ tags: '@adw-510' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@adw-510' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});
