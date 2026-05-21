/**
 * BDD step definitions for feature-509.feature
 * promotionCommenter MVP — score, tag, and comment on per-issue PR events
 *
 * Design decisions:
 *  - Reuses the regression mock harness (setupMockInfrastructure / teardownMockInfrastructure)
 *    via a Before/After hook tagged @adw-509. This makes the regression Given steps
 *    (G3, G4, G11) that depend on this.mockContext usable from these per-issue scenarios.
 *  - The W1 step `the "X" orchestrator is invoked with adwId ... and issue ...` is owned
 *    by features/regression/step_definitions/whenSteps.ts and intentionally returns
 *    'pending' until the harness can drive a real subprocess to completion (per the
 *    ISSUE-3-CUTOVER stub in whenSteps.ts and the plan in
 *    specs/issue-509-...-deep-modules.md §11). Consequently the Then steps downstream
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
// Before / After hooks — scoped to @adw-509 so they don't fire on every
// scenario (and don't interfere with the @regression hook ordering).
// ---------------------------------------------------------------------------

Before({ tags: '@adw-509' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@adw-509' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// Given — fixture seeding (pending until subprocess invocation lands; see file header)
// ---------------------------------------------------------------------------

Given(
  'a per-issue feature file at {string} is seeded into the worktree for adwId {string} from fixture {string}',
  function (_targetPath: string, _adwId: string, _fixturePath: string) {
    return 'pending';
  },
);

// ---------------------------------------------------------------------------
// Then — artefact-file tag assertions (pending; see file header)
// ---------------------------------------------------------------------------

Then(
  'the artefact file at {string} in the worktree for adwId {string} carries a {string} tag dated today on the seeded scenario',
  function (_targetPath: string, _adwId: string, _tagPrefix: string) {
    return 'pending';
  },
);

Then(
  'the artefact file at {string} in the worktree for adwId {string} carries no {string} tag on the seeded scenario',
  function (_targetPath: string, _adwId: string, _tagPrefix: string) {
    return 'pending';
  },
);

Then(
  'the artefact file at {string} in the worktree for adwId {string} carries a {string} tag dated today on the targeted scenario',
  function (_targetPath: string, _adwId: string, _tagPrefix: string) {
    return 'pending';
  },
);

Then(
  'the artefact file at {string} in the worktree for adwId {string} carries a {string} tag dated today on every scenario whose score is at least {int}',
  function (_targetPath: string, _adwId: string, _tagPrefix: string, _threshold: number) {
    return 'pending';
  },
);

Then(
  'the artefact file at {string} in the worktree for adwId {string} carries no {string} tag on any scenario whose score is below {int}',
  function (_targetPath: string, _adwId: string, _tagPrefix: string, _threshold: number) {
    return 'pending';
  },
);

Then(
  'every line of the artefact file at {string} in the worktree for adwId {string} that is not the inserted tag line is byte-identical to the pre-invocation contents',
  function (_targetPath: string, _adwId: string) {
    return 'pending';
  },
);

// ---------------------------------------------------------------------------
// Then — mock-harness call-count and comment-body assertions (pending; see file header)
// ---------------------------------------------------------------------------

Then(
  'the mock harness recorded zero comment posts on issue {int}',
  function (_issueNumber: number) {
    return 'pending';
  },
);

Then(
  'the mock GitHub API recorded a comment containing the seeded scenario name from fixture {string}',
  function (_fixturePath: string) {
    return 'pending';
  },
);
