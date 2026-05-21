/**
 * BDD step definitions for feature-512.feature
 * promotionThreshold — auto-ramping N from 90-day promotion-activity ratio
 *
 * Design decisions:
 *  - Reuses the regression mock harness (setupMockInfrastructure / teardownMockInfrastructure)
 *    via a Before/After hook tagged @adw-512.
 *  - The W1 step `the "X" orchestrator is invoked with adwId ... and issue ...` is owned
 *    by features/regression/step_definitions/whenSteps.ts and intentionally returns
 *    'pending' until the harness can drive a real subprocess (ISSUE-3-CUTOVER stub).
 *    Consequently all Then steps below are pending stubs documenting the acceptance
 *    contract for the next cutover.
 *  - New Git-history seeding steps (Given) are also pending — they require the
 *    commits[] manifest interpreter extension (manifestInterpreter.ts Step 11) to be
 *    wired into the test-harness worktree setup, which is deferred.
 */

import { Given, Then, Before, After } from '@cucumber/cucumber';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-512
// ---------------------------------------------------------------------------

Before({ tags: '@adw-512' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@adw-512' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// Given — git-history seeding (pending; requires commits[] interpreter wiring)
// ---------------------------------------------------------------------------

Given(
  'the worktree git history records {int} per-issue scenarios written in the last 90 days',
  function (_count: number) {
    return 'pending';
  },
);

Given(
  'the worktree git history records {int} regression-promotion PRs merged in the last 90 days',
  function (_count: number) {
    return 'pending';
  },
);

Given(
  'the worktree git history records {int} per-issue scenarios written more than 90 days ago',
  function (_count: number) {
    return 'pending';
  },
);

Given(
  'the worktree git history records {int} regression-promotion PRs merged more than 90 days ago',
  function (_count: number) {
    return 'pending';
  },
);

// ---------------------------------------------------------------------------
// Given — per-issue feature file seeding (pending; requires subprocess wiring)
// ---------------------------------------------------------------------------

Given(
  'a per-issue feature file at {string} is seeded into the worktree for adwId {string} with one scenario scoring exactly {int}',
  function (_filePath: string, _adwId: string, _score: number) {
    return 'pending';
  },
);

Given(
  'a per-issue feature file at {string} is seeded into the worktree for adwId {string} with one scenario scoring exactly the upper bound of N',
  function (_filePath: string, _adwId: string) {
    return 'pending';
  },
);

Given(
  'a per-issue feature file at {string} is seeded into the worktree for adwId {string} with one scenario scoring exactly one above the upper bound of N',
  function (_filePath: string, _adwId: string) {
    return 'pending';
  },
);

Given(
  'no promotion-stats state file exists anywhere under the worktree for adwId {string}',
  function (_adwId: string) {
    return 'pending';
  },
);

// Note: "the artefact file at ... carries a/no ... tag ..." steps are already
// registered in feature-509.steps.ts and are reused here without redefinition.

// ---------------------------------------------------------------------------
// Then — state-file absence assertion (pending)
// ---------------------------------------------------------------------------

Then(
  'no promotion-stats state file is present anywhere under the worktree for adwId {string} after the invocation',
  function (_adwId: string) {
    return 'pending';
  },
);
