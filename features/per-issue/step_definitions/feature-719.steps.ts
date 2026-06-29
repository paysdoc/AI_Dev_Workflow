/**
 * BDD step definitions for feature-719.feature
 *
 * PR-review hands off to awaiting_merge (gated on reviewPassed)
 *
 * §1   pure gate decision (decidePostReviewOutcome in-process)
 * §2   clean PR-review run records awaiting_merge at completion (completion+gate driver)
 * §3   failed review run stays inert — no awaiting_merge, no error (completion+gate driver)
 * §4   existing cron backlog filter dispatches merge for the handoff (feature-636 harness reused)
 * §5   TypeScript type-check passes → feature-504.steps.ts (T22)
 *
 * Steps NOT defined here (already registered):
 *   - Given 'the ADW codebase is checked out'                                  → ensureCronOnEveryEventSteps.ts (G18)
 *   - Given 'an issue {int} exists in the mock issue tracker'                   → givenSteps.ts (G4)
 *   - Given 'the mock GitHub API is configured to accept issue comments'        → givenSteps.ts (G1)
 *   - Given 'a state file exists for adwId {string} at stage {string}'          → givenSteps.ts (G6)
 *   - Given 'the worktree for adwId {string} is initialised at branch {string}' → givenSteps.ts (G11)
 *   - Then  'the state file for adwId {string} records workflowStage {string}'  → thenSteps.ts (T1)
 *   - Then  'the state file for adwId {string} records no error'                → thenSteps.ts (T9)
 *   - Then  'the ADW TypeScript type-check passes'                              → feature-504.steps.ts (T22)
 *   - When  'the cron backlog filter evaluates the issue'                       → feature-636.steps.ts
 *   - Then  'the cron backlog filter marks the issue eligible to dispatch ...'  → feature-636.steps.ts
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/index.ts';
import { decidePostReviewOutcome, type PostReviewOutcome } from '../../../adws/phases/decidePostReviewOutcome.ts';
import { completePRReviewWorkflow } from '../../../adws/phases/prReviewCompletion.ts';
import type { PRReviewWorkflowConfig } from '../../../adws/phases/prReviewPhase.ts';
import { cronCtx, FIXED_ADW_ID } from './feature-636.steps.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Per-scenario mutable state
// ---------------------------------------------------------------------------

const seededAdwIds = new Set<string>();
const tempDirs = new Set<string>();
let lastOutcome: PostReviewOutcome | null = null;

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-719
// ---------------------------------------------------------------------------

Before({ tags: '@adw-719' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  seededAdwIds.clear();
  tempDirs.clear();
  lastOutcome = null;
});

After({ tags: '@adw-719' }, async function (this: RegressionWorld) {
  for (const adwId of seededAdwIds) {
    const dir = join(AGENTS_STATE_DIR, adwId);
    if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
  seededAdwIds.clear();

  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
  tempDirs.clear();

  for (const [, dir] of this.worktreePaths) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  await teardownMockInfrastructure();
  this.mockContext = null;
  this.worktreePaths.clear();
  this.prsByBranch.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
  lastOutcome = null;
});

// ---------------------------------------------------------------------------
// §1 — Pure gate decision steps
// ---------------------------------------------------------------------------

When('the post-review outcome is decided for a passing review', function () {
  lastOutcome = decidePostReviewOutcome(true);
});

When('the post-review outcome is decided for a failing review', function () {
  lastOutcome = decidePostReviewOutcome(false);
});

Then('the post-review outcome proceeds to awaiting_merge', function () {
  assert.ok(lastOutcome !== null, 'Expected an outcome to be set');
  assert.ok(lastOutcome.writeAwaitingMerge === true, 'Expected outcome to proceed (writeAwaitingMerge should be true)');
  assert.strictEqual(lastOutcome.workflowStage, 'awaiting_merge', 'Expected workflowStage to be awaiting_merge');
});

Then('the post-review outcome stops without awaiting_merge', function () {
  assert.ok(lastOutcome !== null, 'Expected an outcome to be set');
  assert.ok(lastOutcome.writeAwaitingMerge === false, 'Expected outcome to stop (writeAwaitingMerge should be false)');
  assert.notStrictEqual(lastOutcome.workflowStage, 'awaiting_merge', 'Expected workflowStage to NOT be awaiting_merge');
});

// ---------------------------------------------------------------------------
// §2–§3 — PR-review outcome handoff (completion+gate driver)
// ---------------------------------------------------------------------------

async function executeOutcomeHandoff(
  world: RegressionWorld,
  adwId: string,
  prNumber: number,
  reviewPassed: boolean,
): Promise<void> {
  seededAdwIds.add(adwId);

  // Create a temp dir for the orchestrator state path (writeState / appendLog).
  const tempOrchDir = mkdtempSync(join(tmpdir(), `adw-719-orch-${adwId}-`));
  tempDirs.add(tempOrchDir);

  // Minimal PRReviewWorkflowConfig — only the fields completePRReviewWorkflow reads.
  const config = {
    base: {
      orchestratorStatePath: tempOrchDir,
      repoContext: undefined,
      adwId,
    },
    prNumber,
    prDetails: { url: `https://github.com/test/repo/pull/${prNumber}` },
    unaddressedComments: [],
    ctx: {},
  } as unknown as PRReviewWorkflowConfig;

  const outcome = decidePostReviewOutcome(reviewPassed);
  await completePRReviewWorkflow(config, undefined, outcome);
}

When(
  'the PR-review outcome handoff is executed for adwId {string} on PR {int} after a passing review',
  async function (this: RegressionWorld, adwId: string, prNumber: number) {
    await executeOutcomeHandoff(this, adwId, prNumber, true);
  },
);

When(
  'the PR-review outcome handoff is executed for adwId {string} on PR {int} after a failing review',
  async function (this: RegressionWorld, adwId: string, prNumber: number) {
    await executeOutcomeHandoff(this, adwId, prNumber, false);
  },
);

// ---------------------------------------------------------------------------
// §3 — Negative of T1
// ---------------------------------------------------------------------------

Then(
  'the state file for adwId {string} does not record workflowStage {string}',
  function (this: RegressionWorld, adwId: string, unexpectedStage: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    const productionStateFile = resolve(ROOT, `agents/${adwId}/state.json`);
    const worktreeStateFile = worktreePath ? join(worktreePath, '.adw', 'state.json') : null;
    const stateFile = existsSync(productionStateFile)
      ? productionStateFile
      : worktreeStateFile;

    if (!stateFile || !existsSync(stateFile)) {
      // No state file at all → the stage was definitely not written.
      return;
    }

    const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
    assert.notStrictEqual(
      state['workflowStage'],
      unexpectedStage,
      `Expected workflowStage to NOT be "${unexpectedStage}" but it was`,
    );
  },
);

// ---------------------------------------------------------------------------
// §4 — PR-review-sourced handoff feeds the existing cron backlog filter
// ---------------------------------------------------------------------------

Given(
  'a PR-review run for adwId {string} has handed issue {int} off to awaiting_merge',
  function (_adwId: string, issueNumber: number) {
    // Seed the same cron evaluation context that feature-636's Given builds.
    // The When step ('the cron backlog filter evaluates the issue') and
    // Then step ('...eligible to dispatch a merge for the recorded ADW run')
    // are loaded from feature-636.steps.ts and read cronCtx directly.
    cronCtx.issueNumber = issueNumber;
    cronCtx.stage = 'awaiting_merge';
    cronCtx.adwId = FIXED_ADW_ID;
    cronCtx.lastActivityMs = Date.now() - 200_000;
    cronCtx.filterResult = null;
  },
);
