/**
 * BDD step definitions for feature-721.feature
 *
 * PR-review `review_failed` + per-adwId resume routing (orchestratorScript)
 *
 * §1  resolveResumeSpawn routes by orchestratorScript (pure resolver)
 * §2  PR-review adopts the fail-path: review_failed + orchestratorScript
 * §3  ## Retry re-runs PR-review under the same adwId, never SDLC
 * §4  TypeScript type-check backstop (handled by feature-504.steps.ts T22)
 *
 * Novel steps defined here:
 *   Given 'a resume state for adwId {string} on issue {int} whose orchestratorScript is {string}'
 *   Given 'a resume state for adwId {string} on issue {int} with no recorded orchestratorScript'
 *   Given 'the state file for adwId {string} is seeded with orchestratorScript {string}'
 *   When  'the resume spawn is resolved for that state'
 *   Then  'the resume spawn targets the orchestrator script {string}'
 *   Then  'the resume spawn does not target the orchestrator script {string}'
 *   Then  'the resume spawn passes issue {int} and adwId {string} as its normalized arguments'
 *   Then  'the state file for adwId {string} records orchestratorScript {string}'
 *
 * Steps NOT defined here (already registered):
 *   - Given 'the ADW codebase is checked out'                                              → ensureCronOnEveryEventSteps.ts (G18)
 *   - Given 'an issue {int} exists in the mock issue tracker'                               → givenSteps.ts (G4)
 *   - Given 'the mock GitHub API is configured to accept issue comments'                   → givenSteps.ts (G1)
 *   - Given 'a state file exists for adwId {string} at stage {string}'                     → givenSteps.ts (G6)
 *   - Given 'the worktree for adwId {string} is initialised at branch {string}'            → givenSteps.ts (G11)
 *   - Given 'issue {int} carries an ADW comment naming adwId {string}'                    → feature-527.steps.ts
 *   - Given 'issue {int} has a comment whose body is {string}'                             → feature-527.steps.ts
 *   - Given 'the state file for adwId {string} is seeded with a resume attempt count of'  → feature-639.steps.ts
 *   - When  'the PR-review outcome handoff is executed ... after a failing review'         → feature-719.steps.ts
 *   - When  'the {string} directive is processed for issue {int}'                          → feature-527.steps.ts
 *   - Then  'the state file for adwId {string} records workflowStage {string}'            → thenSteps.ts (T1)
 *   - Then  'the state file for adwId {string} records a resume attempt count of {int}'   → feature-639.steps.ts
 *   - Then  'the ADW TypeScript type-check passes'                                         → feature-504.steps.ts (T22)
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/index.ts';
import { resolveResumeSpawn, type ResumeSpawnDescriptor } from '../../../adws/core/resolveResumeSpawn.ts';
import type { AgentState } from '../../../adws/types/agentTypes.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Per-scenario mutable state (reset in Before / After hooks)
// ---------------------------------------------------------------------------

let lastResolverState: AgentState | null = null;
let lastResolverResult: ResumeSpawnDescriptor | null = null;

const productionAdwIds = new Set<string>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readProductionState(adwId: string): Record<string, unknown> | null {
  const filePath = join(AGENTS_STATE_DIR, adwId, 'state.json');
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function seedProductionState(adwId: string, partial: Record<string, unknown>): void {
  productionAdwIds.add(adwId);
  const existing = readProductionState(adwId) ?? {};
  const merged = { ...existing, ...partial };
  const dir = join(AGENTS_STATE_DIR, adwId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(merged), 'utf-8');
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-721
// ---------------------------------------------------------------------------

Before({ tags: '@adw-721' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  lastResolverState = null;
  lastResolverResult = null;
  productionAdwIds.clear();
});

After({ tags: '@adw-721' }, async function (this: RegressionWorld) {
  // Clean up production state dirs created by disk-writing scenarios (§2, §3.1).
  // Pure-resolver scenarios (§1, §3.2) write nothing to disk.
  for (const adwId of productionAdwIds) {
    const dir = join(AGENTS_STATE_DIR, adwId);
    if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
  productionAdwIds.clear();

  // Clean up worktrees written by the reused G6 / feature-719 handoff driver.
  for (const [, dir] of this.worktreePaths) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  await teardownMockInfrastructure();
  this.mockContext = null;
  this.worktreePaths.clear();
  this.prsByBranch.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
  lastResolverState = null;
  lastResolverResult = null;
});

// ---------------------------------------------------------------------------
// §1 / §3.2 — Given: build in-memory resume state for the resolver
// ---------------------------------------------------------------------------

Given(
  'a resume state for adwId {string} on issue {int} whose orchestratorScript is {string}',
  function (_adwId: string, issueNumber: number, orchestratorScript: string) {
    lastResolverState = {
      adwId: _adwId,
      issueNumber,
      orchestratorScript,
      agentName: 'sdlc-orchestrator',
      execution: { status: 'completed', startedAt: '', completedAt: '' },
    } as unknown as AgentState;
    lastResolverResult = null;
  },
);

Given(
  'a resume state for adwId {string} on issue {int} with no recorded orchestratorScript',
  function (_adwId: string, issueNumber: number) {
    lastResolverState = {
      adwId: _adwId,
      issueNumber,
      agentName: 'sdlc-orchestrator',
      execution: { status: 'completed', startedAt: '', completedAt: '' },
    } as unknown as AgentState;
    lastResolverResult = null;
  },
);

// ---------------------------------------------------------------------------
// §3.1 — Given: seed orchestratorScript into production state
// ---------------------------------------------------------------------------

Given(
  'the state file for adwId {string} is seeded with orchestratorScript {string}',
  function (adwId: string, orchestratorScript: string) {
    seedProductionState(adwId, { orchestratorScript });
  },
);

// ---------------------------------------------------------------------------
// §1 / §3.2 — When: resolve the resume spawn
// ---------------------------------------------------------------------------

When('the resume spawn is resolved for that state', function () {
  assert.ok(lastResolverState !== null, 'Expected a resume state to be set via a Given step');
  lastResolverResult = resolveResumeSpawn(lastResolverState);
});

// ---------------------------------------------------------------------------
// §1 / §3.2 — Then: assert resolver output
// ---------------------------------------------------------------------------

Then(
  'the resume spawn targets the orchestrator script {string}',
  function (expectedScript: string) {
    assert.ok(lastResolverResult !== null, 'Expected the resume spawn to have been resolved via a When step');
    assert.strictEqual(
      lastResolverResult.script,
      expectedScript,
      `Expected resume spawn script "${expectedScript}" but got "${lastResolverResult.script}"`,
    );
  },
);

Then(
  'the resume spawn does not target the orchestrator script {string}',
  function (unexpectedScript: string) {
    assert.ok(lastResolverResult !== null, 'Expected the resume spawn to have been resolved via a When step');
    assert.notStrictEqual(
      lastResolverResult.script,
      unexpectedScript,
      `Expected resume spawn script to NOT be "${unexpectedScript}" but it was`,
    );
  },
);

Then(
  'the resume spawn passes issue {int} and adwId {string} as its normalized arguments',
  function (issueNumber: number, adwId: string) {
    assert.ok(lastResolverResult !== null, 'Expected the resume spawn to have been resolved via a When step');
    assert.ok(
      lastResolverResult.args.length >= 2,
      `Expected at least 2 args but got ${lastResolverResult.args.length}`,
    );
    assert.strictEqual(
      lastResolverResult.args[0],
      String(issueNumber),
      `Expected args[0] to be "${String(issueNumber)}" but got "${lastResolverResult.args[0]}"`,
    );
    assert.strictEqual(
      lastResolverResult.args[1],
      adwId,
      `Expected args[1] to be "${adwId}" but got "${lastResolverResult.args[1]}"`,
    );
  },
);

// ---------------------------------------------------------------------------
// §2 / §3.1 — Then: assert orchestratorScript in production state file
// ---------------------------------------------------------------------------

Then(
  'the state file for adwId {string} records orchestratorScript {string}',
  function (this: RegressionWorld, adwId: string, expectedScript: string) {
    // Track for cleanup in After hook (written by completePRReviewWorkflow / handleRetryDirective).
    productionAdwIds.add(adwId);
    const productionStateFile = resolve(ROOT, `agents/${adwId}/state.json`);
    const worktreePath = this.worktreePaths.get(adwId);
    const worktreeStateFile = worktreePath ? join(worktreePath, '.adw', 'state.json') : null;
    const stateFile = existsSync(productionStateFile)
      ? productionStateFile
      : worktreeStateFile;

    assert.ok(
      stateFile && existsSync(stateFile),
      `State file not found at ${productionStateFile} (production) or ${worktreeStateFile} (worktree)`,
    );

    const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
    assert.strictEqual(
      state['orchestratorScript'],
      expectedScript,
      `Expected orchestratorScript "${expectedScript}" but got "${String(state['orchestratorScript'])}"`,
    );
  },
);
