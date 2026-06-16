/**
 * BDD step definitions for feature-581.feature
 * Stack-coherence check (warn loud, non-blocking).
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'        → ensureCronOnEveryEventSteps.ts (G18)
 *  - Given 'the claude-cli-stub is loaded with manifest {string}' → givenSteps.ts (G3)
 *  - Given 'the claude-cli-stub is loaded with fixture {string}'  → givenSteps.ts (G9)
 *  - Given 'an issue {int} exists in the mock issue tracker'      → givenSteps.ts (G4)
 *  - Given 'the mock GitHub API is configured to accept issue comments' → givenSteps.ts (G1)
 *  - Given 'the mock GitHub API is configured to accept label applications' → givenSteps.ts (G12)
 *  - Given 'the worktree for adwId {string} is initialised at branch {string}' → givenSteps.ts (G11)
 *  - When  'the {string} orchestrator is invoked with adwId {string} and issue {int}' → whenSteps.ts (W1, pending)
 *  - Then  'the orchestrator subprocess exited {int}'             → thenSteps.ts (T5)
 *  - Then  'the state file for adwId {string} records no error'  → thenSteps.ts (T9)
 *  - Then  'the mock GitHub API recorded a comment on issue {int}' → thenSteps.ts (T2)
 *  - Then  'the mock GitHub API recorded an application of the {string} label on issue {int}' → thenSteps.ts (T12)
 *  - Then  'the ADW TypeScript type-check passes'                 → feature-504.steps.ts (T22)
 *
 * Novel phrases introduced here:
 *  - When  'the stack-coherence check is resolved for detected BDD framework {string} and scenario run command {string}'
 *  - Then  'the stack-coherence check result is {string}'
 *  - Then  'the stack-coherence check is non-blocking'
 *  - Given 'the worktree for adwId {string} declares an incoherent stack config'
 *
 * §5 is PENDING until the W1 subprocess driver lands (ISSUE-3-CUTOVER).
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import { stackCoherenceCheck } from '../../../adws/core/stackCoherenceCheck.ts';
import type { StackCoherenceResult } from '../../../adws/core/stackCoherenceCheck.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// ---------------------------------------------------------------------------
// Per-scenario helper state
// ---------------------------------------------------------------------------

const ctx: { result: StackCoherenceResult | null; threw: boolean } = {
  result: null,
  threw: false,
};

function resetCtx(): void {
  ctx.result = null;
  ctx.threw = false;
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-581 (required for §5 mock infra)
// ---------------------------------------------------------------------------

Before({ tags: '@adw-581' }, async function (this: RegressionWorld) {
  resetCtx();
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@adw-581' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  resetCtx();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// §1–§4 — coherence check helper layer (pure-function scenarios)
// ---------------------------------------------------------------------------

When(
  'the stack-coherence check is resolved for detected BDD framework {string} and scenario run command {string}',
  function (framework: string, runCommand: string) {
    resetCtx();
    try {
      ctx.result = stackCoherenceCheck({
        testFramework: '',
        bddFramework: framework,
        runTests: '',
        runScenariosByTag: runCommand,
      });
    } catch {
      ctx.threw = true;
    }
  },
);

Then('the stack-coherence check result is {string}', function (expected: string) {
  assert.ok(ctx.result !== null, 'Expected stackCoherenceCheck to have been called');
  const actual = ctx.result.ok ? 'ok' : 'warning';
  assert.strictEqual(actual, expected, `Expected result "${expected}" but got "${actual}"`);
});

Then('the stack-coherence check is non-blocking', function () {
  assert.ok(!ctx.threw, 'Expected stackCoherenceCheck NOT to throw, but it did');
  assert.ok(ctx.result !== null, 'Expected stackCoherenceCheck to return a result');
});

// ---------------------------------------------------------------------------
// §5 — worktree descriptor setup for the PENDING e2e scenario
// ---------------------------------------------------------------------------

Given(
  'the worktree for adwId {string} declares an incoherent stack config',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) return;
    const adwDir = path.join(worktreePath, '.adw');
    fs.mkdirSync(adwDir, { recursive: true });
    // Incoherent: Python testFramework paired with cucumber-js (JavaScript) BDD runner
    const commandsMd = [
      '## Test Framework',
      'pytest',
      '',
      '## Run Tests',
      'pytest tests/',
      '',
      '## Run Scenarios by Tag',
      'bunx cucumber-js --tags "@{tag}"',
    ].join('\n');
    fs.writeFileSync(path.join(adwDir, 'commands.md'), commandsMd, 'utf-8');
    const scenariosMd = [
      '## BDD Framework',
      'cucumber-js',
      '',
      '## Step Def Directory',
      'features/step_definitions',
    ].join('\n');
    fs.writeFileSync(path.join(adwDir, 'scenarios.md'), scenariosMd, 'utf-8');
  },
);
