/**
 * BDD step definitions for feature-577.feature
 * Configurable test directory + kill the src/ silent-green
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'                               → ensureCronOnEveryEventSteps.ts (G18)
 *  - Given 'the claude-cli-stub is loaded with manifest {string}'           → givenSteps.ts (G3)
 *  - Given 'the claude-cli-stub is loaded with fixture {string}'            → givenSteps.ts (G9)
 *  - Given 'an issue {int} exists in the mock issue tracker'                → givenSteps.ts (G4)
 *  - Given 'the mock GitHub API is configured to accept issue comments'     → givenSteps.ts (G1)
 *  - Given 'the mock GitHub API is configured to accept label applications'  → givenSteps.ts (G12)
 *  - Given 'the worktree for adwId {string} is initialised at branch {string}' → givenSteps.ts (G11)
 *  - Given 'the worktree for adwId {string} has no {string} file'          → feature-543.steps.ts
 *  - When  'the {string} orchestrator is invoked with adwId {string} and issue {int}' → whenSteps.ts (W1, pending)
 *  - Then  'the orchestrator subprocess exited {int}'                       → thenSteps.ts (T5)
 *  - Then  'the state file for adwId {string} records workflowStage {string}' → thenSteps.ts (T1)
 *  - Then  'the mock GitHub API recorded a comment on issue {int}'          → thenSteps.ts (T2)
 *  - Then  'the mock GitHub API recorded a comment containing the text {string}' → thenSteps.ts (T3)
 *  - Then  'the mock GitHub API recorded an application of the {string} label on issue {int}' → thenSteps.ts (T12)
 *  - Then  'the mock harness recorded zero applications of the {string} label on issue {int}' → thenSteps.ts (T13)
 *  - Then  'the ADW TypeScript type-check passes'                           → feature-504.steps.ts (T22)
 *
 * §1–§3 assert the config PARSER's resolved values over canned commands.md content
 * — produced values over input data, not source-file text matches.
 * §4–§7 assert the verdict the testVerdict module RESOLVES over a canned
 * report summary plus framework/enabled signals.
 * §8/§9 are PENDING until the ISSUE-3-CUTOVER W1 subprocess driver lands.
 *
 * Novel vocabulary introduced here:
 *  - When  'the test configuration is resolved from a commands.md declaring test directory {string} and test framework {string}'
 *  - When  'the test configuration is resolved from a commands.md that declares no test directory'
 *  - Then  'the resolved test directory is {string}'
 *  - Then  'the resolved test framework is {string}'
 *  - When  'the unit-test verdict is resolved for a report with {int} passing and {int} failing tests with the test framework signal {string}'
 *  - Then  'the resolved unit-test verdict is {string}'
 *  - Given 'the worktree for adwId {string} declares a detected test framework'
 *  - Given 'the worktree for adwId {string} declares no detected test framework'
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import { parseCommandsMd } from '../../../adws/core/projectConfig.ts';
import { computeTestVerdict } from '../../../adws/core/testVerdict.ts';
import type { CommandsConfig } from '../../../adws/core/projectConfig.ts';
import type { TestVerdictOutcome } from '../../../adws/core/testVerdict.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
void __dirname;

// ---------------------------------------------------------------------------
// Per-scenario mutable state (reset in Before hook)
// ---------------------------------------------------------------------------

interface Ctx577 {
  resolvedCommands: CommandsConfig | undefined;
  resolvedVerdict: TestVerdictOutcome | undefined;
}

const ctx: Ctx577 = {
  resolvedCommands: undefined,
  resolvedVerdict: undefined,
};

export { ctx as ctx577 };

function resetCtx(): void {
  ctx.resolvedCommands = undefined;
  ctx.resolvedVerdict = undefined;
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-577
// ---------------------------------------------------------------------------

Before({ tags: '@adw-577' }, async function (this: RegressionWorld) {
  resetCtx();
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@adw-577' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  resetCtx();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// §1–§3 When/Then — config parser resolution
// ---------------------------------------------------------------------------

When(
  'the test configuration is resolved from a commands.md declaring test directory {string} and test framework {string}',
  function (testDirectory: string, testFramework: string) {
    const content = [
      `## Test Directory`,
      testDirectory,
      '',
      `## Test Framework`,
      testFramework,
    ].join('\n');
    ctx.resolvedCommands = parseCommandsMd(content);
  },
);

When(
  'the test configuration is resolved from a commands.md that declares no test directory',
  function () {
    const content = '## Run Tests\nbun run test\n';
    ctx.resolvedCommands = parseCommandsMd(content);
  },
);

Then(
  'the resolved test directory is {string}',
  function (expected: string) {
    assert.ok(
      ctx.resolvedCommands !== undefined,
      'resolvedCommands was never set — did the When step run?',
    );
    assert.strictEqual(
      ctx.resolvedCommands.testDirectory,
      expected,
      `Expected resolved testDirectory to be "${expected}" but got "${ctx.resolvedCommands.testDirectory}"`,
    );
  },
);

Then(
  'the resolved test framework is {string}',
  function (expected: string) {
    assert.ok(
      ctx.resolvedCommands !== undefined,
      'resolvedCommands was never set — did the When step run?',
    );
    assert.strictEqual(
      ctx.resolvedCommands.testFramework,
      expected,
      `Expected resolved testFramework to be "${expected}" but got "${ctx.resolvedCommands.testFramework}"`,
    );
  },
);

// ---------------------------------------------------------------------------
// §4–§7 When/Then — verdict resolution
// ---------------------------------------------------------------------------

When(
  'the unit-test verdict is resolved for a report with {int} passing and {int} failing tests with the test framework signal {string}',
  function (passingCount: number, failingCount: number, frameworkSignal: string) {
    const frameworkDetected = frameworkSignal === 'detected';
    const hasFailures = failingCount > 0;
    const testcaseCount = passingCount + failingCount;
    const result = computeTestVerdict({ enabled: true, hasFailures, testcaseCount, frameworkDetected });
    ctx.resolvedVerdict = result.verdict;
  },
);

Then(
  'the resolved unit-test verdict is {string}',
  function (expected: string) {
    assert.ok(
      ctx.resolvedVerdict !== undefined,
      'resolvedVerdict was never set — did the When step run?',
    );
    assert.strictEqual(
      ctx.resolvedVerdict,
      expected,
      `Expected resolved verdict to be "${expected}" but got "${ctx.resolvedVerdict}"`,
    );
  },
);

// ---------------------------------------------------------------------------
// §8/§9 Given — worktree framework declaration (for PENDING e2e scenarios)
// ---------------------------------------------------------------------------

Given(
  'the worktree for adwId {string} declares a detected test framework',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) return;
    const adwDir = path.join(worktreePath, '.adw');
    fs.mkdirSync(adwDir, { recursive: true });
    const commandsPath = path.join(adwDir, 'commands.md');
    const existing = fs.existsSync(commandsPath) ? fs.readFileSync(commandsPath, 'utf-8') : '';
    if (existing.includes('## Test Framework')) {
      fs.writeFileSync(commandsPath, existing.replace(/## Test Framework\n[^\n]*/m, '## Test Framework\npytest'), 'utf-8');
    } else {
      fs.writeFileSync(commandsPath, existing + '\n## Test Framework\npytest\n', 'utf-8');
    }
  },
);

Given(
  'the worktree for adwId {string} declares no detected test framework',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) return;
    const adwDir = path.join(worktreePath, '.adw');
    fs.mkdirSync(adwDir, { recursive: true });
    const commandsPath = path.join(adwDir, 'commands.md');
    const existing = fs.existsSync(commandsPath) ? fs.readFileSync(commandsPath, 'utf-8') : '';
    if (existing.includes('## Test Framework')) {
      fs.writeFileSync(commandsPath, existing.replace(/## Test Framework\n[^\n]*/m, '## Test Framework\n'), 'utf-8');
    } else {
      fs.writeFileSync(commandsPath, existing + '\n## Test Framework\n\n', 'utf-8');
    }
  },
);
