/**
 * BDD step definitions for feature-511.feature
 * promotionMover — @promotion tag opens separate PR moving scenario to regression dir
 *
 * Design decisions:
 *  - Reuses the regression mock harness (setupMockInfrastructure / teardownMockInfrastructure)
 *    via a Before/After hook tagged @adw-511. This makes the regression Given steps
 *    (G3, G4, G11) that depend on this.mockContext usable from these per-issue scenarios.
 *  - The W1 step `the "X" orchestrator is invoked with adwId ... and issue ...` is owned
 *    by features/regression/step_definitions/whenSteps.ts and intentionally returns
 *    'pending' until the harness can drive a real subprocess to completion (per the
 *    ISSUE-3-CUTOVER stub in whenSteps.ts). Consequently the Then steps downstream
 *    of W1 are skipped at runtime; the missing step definitions below are stubs that
 *    return 'pending' so the scenarios are marked PENDING rather than FAILED/UNDEFINED.
 *    They become live assertions in slice #5 when subprocess invocation lands.
 */

import { Given, Then, Before, After } from '@cucumber/cucumber';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-511 so they don't fire on every
// scenario (and don't interfere with the @regression hook ordering).
// ---------------------------------------------------------------------------

Before({ tags: '@adw-511' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@adw-511' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// Given — mock infrastructure configuration (pending; see file header)
// ---------------------------------------------------------------------------

Given(
  'the mock GitHub API is configured to accept PR creation',
  function () {
    return 'pending';
  },
);

Given(
  'the mock GitHub API is configured to accept label application',
  function () {
    return 'pending';
  },
);

// ---------------------------------------------------------------------------
// Then — PR creation and label assertions (pending; see file header)
// ---------------------------------------------------------------------------

Then(
  'the mock GitHub API recorded a PR creation distinct from the per-issue PR for issue {int}',
  function (_issueNumber: number) {
    return 'pending';
  },
);

Then(
  'the mock GitHub API recorded zero PR creation calls modifying the per-issue PR head branch for issue {int}',
  function (_issueNumber: number) {
    return 'pending';
  },
);

Then(
  'the mock GitHub API recorded a label application of {string} on the move PR opened by promotionMover',
  function (_label: string) {
    return 'pending';
  },
);

// ---------------------------------------------------------------------------
// Then — artefact file content assertions (pending; see file header)
// ---------------------------------------------------------------------------

Then(
  'the regression-bound artefact file produced by promotionMover for adwId {string} contains the seeded scenario from fixture {string}',
  function (_adwId: string, _fixturePath: string) {
    return 'pending';
  },
);

Then(
  'the regression-bound artefact file produced by promotionMover for adwId {string} carries no {string} tag on the moved scenario',
  function (_adwId: string, _tagPrefix: string) {
    return 'pending';
  },
);

Then(
  'the per-issue artefact file at {string} on the move branch produced by promotionMover for adwId {string} no longer contains the moved scenario block',
  function (_targetPath: string, _adwId: string) {
    return 'pending';
  },
);

Then(
  'the per-issue artefact file at {string} on the move branch produced by promotionMover for adwId {string} still contains every scenario tagged {string}',
  function (_targetPath: string, _adwId: string, _tagPrefix: string) {
    return 'pending';
  },
);

// ---------------------------------------------------------------------------
// Then — move PR count and label assertions (pending; see file header)
// ---------------------------------------------------------------------------

Then(
  'the mock harness recorded zero move PRs opened by promotionMover for adwId {string}',
  function (_adwId: string) {
    return 'pending';
  },
);

Then(
  'the mock harness recorded {int} move PR(s) opened by promotionMover for adwId {string}',
  function (_count: number, _adwId: string) {
    return 'pending';
  },
);

Then(
  'every move PR opened by promotionMover for adwId {string} carries the {string} label',
  function (_adwId: string, _label: string) {
    return 'pending';
  },
);

