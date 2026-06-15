/**
 * BDD step definitions for feature-576.feature
 * Durable opt-out unit-test gate in .github/adw.yml
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'                               → ensureCronOnEveryEventSteps.ts (G18)
 *  - Given 'the claude-cli-stub is loaded with manifest {string}'           → givenSteps.ts (G3)
 *  - Given 'the claude-cli-stub is loaded with fixture {string}'            → givenSteps.ts (G9)
 *  - Given 'an issue {int} exists in the mock issue tracker'                → givenSteps.ts (G4)
 *  - Given 'the mock GitHub API is configured to accept issue comments'     → givenSteps.ts (G1)
 *  - Given 'the worktree for adwId {string} is initialised at branch {string}' → givenSteps.ts (G11)
 *  - Given 'the worktree for adwId {string} has no {string} file'          → feature-543.steps.ts
 *  - When  'the {string} orchestrator is invoked with adwId {string} and issue {int}' → whenSteps.ts (W1, pending)
 *  - Then  'the orchestrator subprocess exited {int}'                       → thenSteps.ts (T5)
 *  - Then  'the state file for adwId {string} records workflowStage {string}' → thenSteps.ts (T1)
 *  - Then  'the mock GitHub API recorded a comment on issue {int}'          → thenSteps.ts (T2)
 *  - Then  'the ADW TypeScript type-check passes'                           → feature-504.steps.ts (T22)
 *
 * §1 (parser) and §2/§3 (create-if-absent) are driven by direct module calls — deterministic
 * and fast. §4/§5 (normal-path gate) rely on W1 which is currently 'pending'
 * (ISSUE-3-CUTOVER); those scenarios will be pending until the harness is upgraded.
 *
 * Novel vocabulary introduced here:
 *  - When  'the unit-test gate is resolved from adw.yml content {string}'
 *  - Then  'the resolved unit-test gate is enabled'
 *  - Then  'the resolved unit-test gate is disabled'
 *  - Given 'a {string} file in the worktree for adwId {string} sets unitTests to false'
 *  - Given 'a {string} file in the worktree for adwId {string} sets unitTests to false and hitl to true'
 *  - Given 'a {string} file in the worktree for adwId {string} enables unit tests'
 *  - Given 'a {string} file in the worktree for adwId {string} disables unit tests'
 *  - When  'the adw_init adw.yml bootstrap runs in the worktree of adwId {string}'
 *  - Then  'a {string} artefact exists in the worktree for adwId {string}'
 *  - Then  'the {string} artefact in the worktree for adwId {string} is byte-identical to its pre-invocation contents'
 *  - Then  'the unit-test gate read from the worktree for adwId {string} is enabled'
 *  - Then  'the unit-test gate read from the worktree for adwId {string} is disabled'
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import { parseAdwYml, readAdwYmlConfig, writeAdwYmlTemplateIfAbsent, ADW_YML_RELATIVE_PATH } from '../../../adws/core/adwYmlConfig.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
void __dirname;

// ---------------------------------------------------------------------------
// Per-scenario mutable state (reset in Before hook)
// ---------------------------------------------------------------------------

interface Ctx576 {
  resolvedUnitTestGate: boolean | undefined;
  preInvocationAdwYmlContents: Map<string, string>;
}

const ctx: Ctx576 = {
  resolvedUnitTestGate: undefined,
  preInvocationAdwYmlContents: new Map(),
};

function resetCtx(): void {
  ctx.resolvedUnitTestGate = undefined;
  ctx.preInvocationAdwYmlContents = new Map();
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-576
// ---------------------------------------------------------------------------

Before({ tags: '@adw-576' }, async function (this: RegressionWorld) {
  resetCtx();
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@adw-576' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  resetCtx();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// §1 When/Then — parser resolution
// ---------------------------------------------------------------------------

When(
  'the unit-test gate is resolved from adw.yml content {string}',
  function (content: string) {
    const config = parseAdwYml(content);
    ctx.resolvedUnitTestGate = config.unitTests;
  },
);

Then(
  'the resolved unit-test gate is enabled',
  function () {
    assert.ok(
      ctx.resolvedUnitTestGate !== undefined,
      'resolvedUnitTestGate was never set — did the When step run?',
    );
    assert.strictEqual(
      ctx.resolvedUnitTestGate,
      true,
      `Expected resolved unit-test gate to be enabled (true) but got ${String(ctx.resolvedUnitTestGate)}`,
    );
  },
);

Then(
  'the resolved unit-test gate is disabled',
  function () {
    assert.ok(
      ctx.resolvedUnitTestGate !== undefined,
      'resolvedUnitTestGate was never set — did the When step run?',
    );
    assert.strictEqual(
      ctx.resolvedUnitTestGate,
      false,
      `Expected resolved unit-test gate to be disabled (false) but got ${String(ctx.resolvedUnitTestGate)}`,
    );
  },
);

Then(
  'the unit-test gate read from the worktree for adwId {string} is enabled',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    const config = worktreePath
      ? readAdwYmlConfig(worktreePath)
      : { hitl: false, unitTests: true };
    assert.strictEqual(
      config.unitTests,
      true,
      `Expected unit-test gate to be enabled (true) for adwId "${adwId}" but got ${String(config.unitTests)}`,
    );
  },
);

Then(
  'the unit-test gate read from the worktree for adwId {string} is disabled',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(
      worktreePath,
      `No worktree registered for adwId "${adwId}" — was the worktree initialised?`,
    );
    const config = readAdwYmlConfig(worktreePath);
    assert.strictEqual(
      config.unitTests,
      false,
      `Expected unit-test gate to be disabled (false) for adwId "${adwId}" but got ${String(config.unitTests)}`,
    );
  },
);

// ---------------------------------------------------------------------------
// §2/§3 When/Then — create-if-absent bootstrap
// ---------------------------------------------------------------------------

When(
  'the adw_init adw.yml bootstrap runs in the worktree of adwId {string}',
  function (this: RegressionWorld, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(
      worktreePath,
      `No worktree registered for adwId "${adwId}" — was the worktree initialised?`,
    );
    const filePath = path.join(worktreePath, ADW_YML_RELATIVE_PATH);
    if (fs.existsSync(filePath)) {
      ctx.preInvocationAdwYmlContents.set(adwId, fs.readFileSync(filePath, 'utf-8'));
    }
    writeAdwYmlTemplateIfAbsent(worktreePath);
  },
);

// Matches: Then a ".github/adw.yml" artefact exists in the worktree for adwId "init-576-create"
// Cucumber treats ".github/adw.yml" as a {string} parameter, so we accept it as filename.
Then(
  'a {string} artefact exists in the worktree for adwId {string}',
  function (this: RegressionWorld, filename: string, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(
      worktreePath,
      `No worktree registered for adwId "${adwId}" — was the worktree initialised?`,
    );
    const filePath = path.join(worktreePath, filename);
    assert.ok(
      fs.existsSync(filePath),
      `Expected "${filename}" to exist in worktree for adwId "${adwId}" but it does not`,
    );
  },
);

// Matches: Then the ".github/adw.yml" artefact in the worktree for adwId "..." is byte-identical...
// Cucumber treats ".github/adw.yml" as a {string} parameter.
Then(
  'the {string} artefact in the worktree for adwId {string} is byte-identical to its pre-invocation contents',
  function (this: RegressionWorld, _filename: string, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    assert.ok(
      worktreePath,
      `No worktree registered for adwId "${adwId}" — was the worktree initialised?`,
    );
    const preInvocation = ctx.preInvocationAdwYmlContents.get(adwId);
    assert.ok(
      preInvocation !== undefined,
      `No pre-invocation contents captured for adwId "${adwId}" — was the When step run after the Given file-seeding step?`,
    );
    const filePath = path.join(worktreePath, ADW_YML_RELATIVE_PATH);
    const currentContents = fs.readFileSync(filePath, 'utf-8');
    assert.strictEqual(
      currentContents,
      preInvocation,
      `Expected .github/adw.yml to be byte-identical to pre-invocation contents for adwId "${adwId}"`,
    );
  },
);

// ---------------------------------------------------------------------------
// §2/§3 Given — descriptor seeding
// ---------------------------------------------------------------------------

Given(
  'a {string} file in the worktree for adwId {string} sets unitTests to false and hitl to true',
  function (this: RegressionWorld, _filename: string, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) return;
    const githubDir = path.join(worktreePath, '.github');
    if (!fs.existsSync(githubDir)) fs.mkdirSync(githubDir, { recursive: true });
    fs.writeFileSync(path.join(githubDir, 'adw.yml'), 'unitTests: false\nhitl: true\n', 'utf-8');
  },
);

// ---------------------------------------------------------------------------
// §4/§5 Given — descriptor + project.md seeding
// ---------------------------------------------------------------------------

Given(
  'a {string} file in the worktree for adwId {string} sets unitTests to false',
  function (this: RegressionWorld, _filename: string, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) return;
    const githubDir = path.join(worktreePath, '.github');
    if (!fs.existsSync(githubDir)) fs.mkdirSync(githubDir, { recursive: true });
    fs.writeFileSync(path.join(githubDir, 'adw.yml'), 'unitTests: false\n', 'utf-8');
  },
);

Given(
  'a {string} file in the worktree for adwId {string} enables unit tests',
  function (this: RegressionWorld, filename: string, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) return;
    const filePath = path.join(worktreePath, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    if (existing.includes('## Unit Tests')) {
      fs.writeFileSync(filePath, existing.replace(/## Unit Tests:.*/g, '## Unit Tests: enabled'), 'utf-8');
    } else {
      fs.writeFileSync(filePath, existing + '\n## Unit Tests: enabled\n', 'utf-8');
    }
  },
);

Given(
  'a {string} file in the worktree for adwId {string} disables unit tests',
  function (this: RegressionWorld, filename: string, adwId: string) {
    const worktreePath = this.worktreePaths.get(adwId);
    if (!worktreePath) return;
    const filePath = path.join(worktreePath, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    if (existing.includes('## Unit Tests')) {
      fs.writeFileSync(filePath, existing.replace(/## Unit Tests:.*/g, '## Unit Tests: disabled'), 'utf-8');
    } else {
      fs.writeFileSync(filePath, existing + '\n## Unit Tests: disabled\n', 'utf-8');
    }
  },
);

void resolve;
