/**
 * BDD step definitions for feature-583.feature
 * Python fixture target + end-to-end @regression test
 *
 * Steps NOT defined here (already registered — reused verbatim):
 *  - Given 'the ADW codebase is checked out'        → ensureCronOnEveryEventSteps.ts (G18)
 *  - Then  'the ADW TypeScript type-check passes'   → feature-504.steps.ts (T22)
 *  - Then  'the resolved test framework is {string}'   → feature-577.steps.ts
 *  - Then  'the resolved test directory is {string}'   → feature-577.steps.ts
 *  - Then  'the resolved BDD framework is {string}'    → feature-579.steps.ts
 *  - Then  'the resolved step-def directory is {string}' → feature-579.steps.ts
 *  - Then  'the descriptor-driven step-def presence is {string}' → feature-579.steps.ts
 *
 * The When steps below populate the shared ctx objects from feature-577 and
 * feature-579 so the existing registered Then phrases read the correct values.
 *
 * Novel phrases introduced here:
 *  - When 'the project configuration is resolved over the Python fixture target {string}'
 *  - Given 'the Python fixture target {string} is prepared'
 *  - When  'step-def presence is resolved from the prepared fixture's descriptor'
 *  - When  'the non-TypeScript scenario-proof and proof-publish pipeline runs against the prepared fixture'
 *  - Then  'the scenario-proof run resolves a JUnit tally of {int} passed and {int} failed'
 *  - Then  'the proof run harvests {int} screenshot'
 *  - Then  'the harvested screenshots include {string}'
 *  - Then  'the recorded proof comment includes a pass/fail summary of {int} passed and {int} failed'
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
  setupFixtureRepo,
} from '../../../test/mocks/test-harness.ts';
import { loadProjectConfig } from '../../../adws/core/projectConfig.ts';
import { stepDefExtensionsFor, hasStepDefinitions } from '../../../adws/core/stepDefDetection.ts';
import { runScenarioProof } from '../../../adws/phases/scenarioProof.ts';
import { harvestProofArtifacts } from '../../../adws/proof/proofArtifactHarvester.ts';
import { formatPrProofComment, publishPrProof } from '../../../adws/proof/prProofPublisher.ts';
import { ADW_SIGNATURE } from '../../../adws/core/workflowCommentParsing.ts';
import { ctx577 } from './feature-577.steps.ts';
import { ctx579 } from './feature-579.steps.ts';
import type { UploadedArtifact, ProofArtifact } from '../../../adws/proof/types.ts';
import { Platform } from '../../../adws/providers/types.ts';
import type { ScenarioProofResult } from '../../../adws/phases/scenarioProof.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

const ADW_ID = 'x3qme8-python-fixture-targe';

interface Ctx583 {
  fixtureRepoDir: string | null;
  cleanupFixture: (() => void) | null;
  proofDir: string | null;
  scenarioProofResult: ScenarioProofResult | null;
  artifacts: ProofArtifact[] | null;
  capturedComment: string | null;
}

const ctx: Ctx583 = {
  fixtureRepoDir: null,
  cleanupFixture: null,
  proofDir: null,
  scenarioProofResult: null,
  artifacts: null,
  capturedComment: null,
};

function resetCtx(): void {
  if (ctx.cleanupFixture) {
    ctx.cleanupFixture();
    ctx.cleanupFixture = null;
  }
  if (ctx.proofDir) {
    fs.rmSync(ctx.proofDir, { recursive: true, force: true });
    ctx.proofDir = null;
  }
  ctx.fixtureRepoDir = null;
  ctx.scenarioProofResult = null;
  ctx.artifacts = null;
  ctx.capturedComment = null;
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-583
// ---------------------------------------------------------------------------

Before({ tags: '@adw-583' }, async function (this: RegressionWorld) {
  resetCtx();
  this.mockContext = await setupMockInfrastructure();
});

After({ tags: '@adw-583' }, async function (this: RegressionWorld) {
  await teardownMockInfrastructure();
  resetCtx();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// §1 When — resolve project config over the fixture target
// ---------------------------------------------------------------------------

When(
  'the project configuration is resolved over the Python fixture target {string}',
  function (fixtureName: string) {
    const fixtureDir = path.resolve(ROOT, 'test/fixtures', fixtureName);
    const cfg = loadProjectConfig(fixtureDir);
    // Populate shared ctx objects so the existing registered Then steps can read them.
    ctx577.resolvedCommands = cfg.commands;
    ctx579.parsedDescriptor = cfg.scenarios;
  },
);

// ---------------------------------------------------------------------------
// §2 Given / When — prepare fixture and resolve step-def presence
// ---------------------------------------------------------------------------

Given(
  'the Python fixture target {string} is prepared',
  function (fixtureName: string) {
    const fixture = setupFixtureRepo(fixtureName);
    ctx.fixtureRepoDir = fixture.repoDir;
    ctx.cleanupFixture = fixture.cleanup;
  },
);

When(
  "step-def presence is resolved from the prepared fixture's descriptor",
  function () {
    assert.ok(ctx.fixtureRepoDir, 'Expected fixture repo to be prepared via Given step');
    const cfg = loadProjectConfig(ctx.fixtureRepoDir);
    const extensions = stepDefExtensionsFor(cfg.scenarios.bddFramework);
    const present = hasStepDefinitions(cfg.scenarios.stepDefDirectory, extensions, ctx.fixtureRepoDir);
    ctx579.descriptorPresence = present ? 'present' : 'absent';
  },
);

// ---------------------------------------------------------------------------
// §3 When — run the full non-TS scenario-proof + proof-publish pipeline
// ---------------------------------------------------------------------------

When(
  'the non-TypeScript scenario-proof and proof-publish pipeline runs against the prepared fixture',
  async function () {
    assert.ok(ctx.fixtureRepoDir, 'Expected fixture repo to be prepared via Given step');
    const cfg = loadProjectConfig(ctx.fixtureRepoDir);
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-py-e2e-proof-'));
    ctx.proofDir = proofDir;

    ctx.scenarioProofResult = await runScenarioProof({
      scenariosMd: cfg.scenariosMd,
      reviewProofConfig: cfg.reviewProofConfig,
      runByTagCommand: cfg.commands.runScenariosByTag,
      issueNumber: 583,
      proofDir,
      cwd: ctx.fixtureRepoDir,
      stepDefDirectory: cfg.scenarios.stepDefDirectory,
      stepDefExtensions: stepDefExtensionsFor(cfg.scenarios.bddFramework),
    });
  },
);

// ---------------------------------------------------------------------------
// §3 Then — assert pipeline outputs
// ---------------------------------------------------------------------------

Then(
  'the scenario-proof run resolves a JUnit tally of {int} passed and {int} failed',
  function (expectedPassed: number, expectedFailed: number) {
    assert.ok(ctx.scenarioProofResult, 'Expected scenario proof result to be set by When step');
    const [first] = ctx.scenarioProofResult.tagResults;
    assert.ok(first, 'Expected at least one tag result');
    assert.ok(!first.skipped, 'Expected proof run not to be skipped');
    assert.ok(first.counts, 'Expected counts to be present in the tag result');
    assert.strictEqual(first.counts.passed, expectedPassed);
    assert.strictEqual(first.counts.failed, expectedFailed);
  },
);

Then('the proof run harvests {int} screenshot', function (expected: number) {
  assert.ok(ctx.scenarioProofResult, 'Expected scenario proof result to be set by When step');
  ctx.artifacts = harvestProofArtifacts(ctx.scenarioProofResult.artifactsDir);
  assert.ok(
    ctx.artifacts.length >= expected,
    `Expected at least ${expected} harvested screenshot(s), got ${ctx.artifacts.length}`,
  );
});

Then('the harvested screenshots include {string}', function (fileName: string) {
  assert.ok(ctx.artifacts, 'Expected artifacts to be harvested by prior Then step');
  const found = ctx.artifacts.some(a => path.basename(a.relPath) === fileName);
  assert.ok(found, `Expected harvested artifacts to include "${fileName}"`);
});

Then(
  'the recorded proof comment includes a pass\\/fail summary of {int} passed and {int} failed',
  async function (expectedPassed: number, expectedFailed: number) {
    assert.ok(ctx.scenarioProofResult, 'Expected scenario proof result to be set by When step');
    assert.ok(ctx.artifacts, 'Expected artifacts to be harvested by prior Then step');

    const uploaded: UploadedArtifact[] = ctx.artifacts.map(a => ({
      scenario: a.relPath.split('/')[0] ?? 'Screenshots',
      url: `https://screenshots.paysdoc.nl/proof/${ADW_ID}/${a.relPath}`,
      fileName: path.basename(a.relPath),
    }));

    const formattedComment = formatPrProofComment({
      tagResults: ctx.scenarioProofResult.tagResults,
      uploaded,
      r2Configured: true,
    });

    assert.ok(
      formattedComment.includes(`**${expectedPassed} passed, ${expectedFailed} failed**`),
      `Expected comment to contain "**${expectedPassed} passed, ${expectedFailed} failed**"`,
    );
    assert.ok(formattedComment.includes('<details>'), 'Expected comment to contain screenshot <details> block');
    assert.ok(formattedComment.includes('calculator'), 'Expected comment to reference calculator scenario group');
    assert.ok(formattedComment.includes('[!['), 'Expected comment to contain inline screenshot embed');

    await publishPrProof({
      artifactsDir: ctx.scenarioProofResult.artifactsDir,
      scenarioProof: ctx.scenarioProofResult,
      prNumber: 583,
      repoInfo: { owner: 'paysdoc', repo: 'python-app', platform: Platform.GitHub },
      adwId: ADW_ID,
      commenter: (_n, body) => { ctx.capturedComment = body; },
    });

    assert.ok(ctx.capturedComment, 'Expected publishPrProof to call the commenter');
    assert.ok(
      ctx.capturedComment.includes(`**${expectedPassed} passed, ${expectedFailed} failed**`),
      'Expected captured comment to contain pass/fail tally',
    );
    assert.ok(
      ctx.capturedComment.includes(ADW_SIGNATURE),
      'Expected captured comment to include ADW_SIGNATURE',
    );
  },
);
