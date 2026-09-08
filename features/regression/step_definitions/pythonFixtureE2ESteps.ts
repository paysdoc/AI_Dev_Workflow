/**
 * Step definitions for the Python fixture e2e regression scenario.
 *
 * Execution pattern: Phase import — drives the real ADW pipeline modules
 * (loadProjectConfig → runScenarioProof → harvestProofArtifacts →
 * formatPrProofComment / publishPrProof) in-process against an isolated
 * copy of test/fixtures/python-app/.
 *
 * Vocabulary phrases: G-PY1, W-PY1, T-PY1 through T-PY6
 * (see features/regression/vocabulary.md).
 *
 * The @regression Before/After hooks (features/regression/support/hooks.ts)
 * run automatically; they set REAL_GIT_PATH. A @python-e2e After hook here
 * tears down the fixture repo and proofDir.
 */

import { After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  setupFixtureRepo,
  teardownFixtureRepo,
} from '../../../test/mocks/test-harness.ts';
import { loadProjectConfig } from '../../../adws/core/projectConfig.ts';
import { stepDefExtensionsFor } from '../../../adws/core/stepDefDetection.ts';
import { runScenarioProof } from '../../../adws/phases/scenarioProof.ts';
import { harvestProofArtifacts } from '../../../adws/proof/proofArtifactHarvester.ts';
import { formatPrProofComment, publishPrProof } from '../../../adws/proof/prProofPublisher.ts';
import { ADW_SIGNATURE } from '../../../adws/core/workflowCommentParsing.ts';
import type { UploadedArtifact } from '../../../adws/proof/types.ts';
import type { RegressionWorld } from './world.ts';
import { Platform } from '../../../adws/providers/types.ts';

const ADW_ID = 'x3qme8-python-fixture-targe';

// ---------------------------------------------------------------------------
// Teardown — scoped to @python-e2e
// ---------------------------------------------------------------------------

After({ tags: '@python-e2e' }, function (this: RegressionWorld) {
  if (this.pythonFixture) {
    teardownFixtureRepo(this.pythonFixture);
    this.pythonFixture = undefined;
  }
  if (this.proofDir) {
    fs.rmSync(this.proofDir, { recursive: true, force: true });
    this.proofDir = undefined;
  }
  this.scenarioProofResult = undefined;
  this.capturedProofComment = undefined;
});

// ---------------------------------------------------------------------------
// G-PY1: initialise the Python fixture as an ADW target repo
// ---------------------------------------------------------------------------

Given(
  'the Python fixture target {string} is initialised as an ADW target repo',
  function (this: RegressionWorld, fixtureName: string) {
    this.pythonFixture = setupFixtureRepo(fixtureName);
  },
);

// ---------------------------------------------------------------------------
// W-PY1: run the scenario proof pipeline against the fixture
// ---------------------------------------------------------------------------

When(
  'ADW runs the scenario proof pipeline against the Python fixture for issue {int}',
  async function (this: RegressionWorld, issueNumber: number) {
    assert.ok(this.pythonFixture, 'Expected pythonFixture to be set by Given step');
    const { repoDir } = this.pythonFixture;
    const cfg = loadProjectConfig(repoDir);
    const proofDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-python-e2e-'));
    this.proofDir = proofDir;

    this.scenarioProofResult = await runScenarioProof({
      scenariosMd: cfg.scenariosMd,
      reviewProofConfig: cfg.reviewProofConfig,
      runByTagCommand: cfg.commands.runScenariosByTag,
      issueNumber,
      proofDir,
      cwd: repoDir,
      stepDefDirectory: cfg.scenarios.stepDefDirectory,
      stepDefExtensions: stepDefExtensionsFor(cfg.scenarios.bddFramework),
    });
  },
);

// ---------------------------------------------------------------------------
// T-PY1: proof run was not skipped
// ---------------------------------------------------------------------------

Then(
  'the scenario proof for the Python fixture is not skipped',
  function (this: RegressionWorld) {
    assert.ok(this.scenarioProofResult, 'Expected scenarioProofResult to be set by When step');
    const [first] = this.scenarioProofResult.tagResults;
    assert.ok(first, 'Expected at least one tag result');
    assert.ok(!first.skipped, 'Expected proof run not to be skipped (step-def gate should have found .py files)');
  },
);

// ---------------------------------------------------------------------------
// T-PY2: JUnit tally
// ---------------------------------------------------------------------------

Then(
  'the scenario proof reports {int} passed and {int} failed',
  function (this: RegressionWorld, expectedPassed: number, expectedFailed: number) {
    assert.ok(this.scenarioProofResult, 'Expected scenarioProofResult to be set by When step');
    const [first] = this.scenarioProofResult.tagResults;
    assert.ok(first?.counts, 'Expected counts to be present in the tag result');
    assert.strictEqual(first.counts.passed, expectedPassed);
    assert.strictEqual(first.counts.failed, expectedFailed);
  },
);

// ---------------------------------------------------------------------------
// T-PY3: no blocker failures
// ---------------------------------------------------------------------------

Then(
  'the scenario proof records no blocker failures',
  function (this: RegressionWorld) {
    assert.ok(this.scenarioProofResult, 'Expected scenarioProofResult to be set by When step');
    assert.ok(
      !this.scenarioProofResult.hasBlockerFailures,
      'Expected hasBlockerFailures to be false',
    );
  },
);

// ---------------------------------------------------------------------------
// T-PY4: harvest at least N screenshots
// ---------------------------------------------------------------------------

Then(
  'the proof run harvests at least {int} screenshot artifact',
  function (this: RegressionWorld, minCount: number) {
    assert.ok(this.scenarioProofResult, 'Expected scenarioProofResult to be set by When step');
    const artifacts = harvestProofArtifacts(this.scenarioProofResult.artifactsDir);
    assert.ok(
      artifacts.length >= minCount,
      `Expected at least ${minCount} harvested screenshot(s), got ${artifacts.length}`,
    );
  },
);

// ---------------------------------------------------------------------------
// T-PY5: proof comment contains tally + inline screenshot embed
// ---------------------------------------------------------------------------

Then(
  'the composed proof comment shows the pass tally and an inline screenshot',
  function (this: RegressionWorld) {
    assert.ok(this.scenarioProofResult, 'Expected scenarioProofResult to be set by When step');
    const artifacts = harvestProofArtifacts(this.scenarioProofResult.artifactsDir);
    assert.ok(artifacts.length > 0, 'Expected at least one harvested artifact for embed assertion');

    const uploaded: UploadedArtifact[] = artifacts.map(a => ({
      scenario: a.relPath.split('/')[0] ?? 'Screenshots',
      url: `https://screenshots.paysdoc.nl/proof/${ADW_ID}/${a.relPath}`,
      fileName: path.basename(a.relPath),
    }));

    const comment = formatPrProofComment({
      tagResults: this.scenarioProofResult.tagResults,
      uploaded,
      r2Configured: true,
    });

    assert.ok(comment.includes('**2 passed, 0 failed**'), 'Expected tally in comment');
    assert.ok(comment.includes('<details>'), 'Expected <details> block for scenario group');
    assert.ok(comment.includes('calculator'), 'Expected calculator scenario group in comment');
    assert.ok(comment.includes('[!['), 'Expected inline screenshot embed in comment');
  },
);

// ---------------------------------------------------------------------------
// T-PY6: publish posts a comment with tally + signature
// ---------------------------------------------------------------------------

Then(
  'publishing the proof posts a PR comment carrying the pass tally',
  async function (this: RegressionWorld) {
    assert.ok(this.scenarioProofResult, 'Expected scenarioProofResult to be set by When step');

    await publishPrProof({
      artifactsDir: this.scenarioProofResult.artifactsDir,
      scenarioProof: this.scenarioProofResult,
      prNumber: 583,
      repoInfo: { owner: 'paysdoc', repo: 'python-app', platform: Platform.GitHub },
      adwId: ADW_ID,
      commenter: (_n, body) => { this.capturedProofComment = body; },
    });

    assert.ok(this.capturedProofComment, 'Expected publishPrProof to invoke the commenter');
    assert.ok(
      this.capturedProofComment.includes('**2 passed, 0 failed**'),
      'Expected captured comment to contain pass tally',
    );
    assert.ok(
      this.capturedProofComment.includes(ADW_SIGNATURE),
      'Expected captured comment to include ADW_SIGNATURE',
    );
  },
);
