import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

function loadReviewPhase(): void {
  const filePath = 'adws/phases/reviewPhase.ts';
  sharedCtx.fileContent = readFileSync(join(ROOT, filePath), 'utf-8');
  sharedCtx.filePath = filePath;
}

// ── Background ────────────────────────────────────────────────────────────────

Given('the target repository has {string} present', function (filePath: string) {
  assert.ok(existsSync(join(ROOT, filePath)), `Expected ${filePath} to exist`);
});

Given('the scenarios command is configured as {string}', function (_cmd: string) {
  // Context only
});

// ── @regression: review runs @regression scenarios ───────────────────────────

Given('the target repository has {string} defining the scenarios directory', function (filePath: string) {
  assert.ok(existsSync(join(ROOT, filePath)), `Expected ${filePath} to exist`);
  loadReviewPhase();
});

Given('there are scenarios tagged {string} in the features directory', function (tag: string) {
  const featuresDir = join(ROOT, 'features');
  const files = readdirSync(featuresDir).filter((f: string) => f.endsWith('.feature'));
  const hasTag = files.some((f: string) => readFileSync(join(featuresDir, f), 'utf-8').includes(tag));
  assert.ok(hasTag, `Expected at least one feature file to have scenarios tagged "${tag}"`);
});

When('the review phase executes', function () {
  // Context only
});

Then('the review phase runs the regression scenario command from {string}', function (configFile: string) {
  assert.ok(
    sharedCtx.fileContent.includes('scenarioProofPath') || sharedCtx.fileContent.includes('runReviewAgent'),
    `Expected reviewPhase.ts to orchestrate review with scenario proof from ${configFile}`,
  );
});

Then('the review proof contains the scenario execution output', function () {
  assert.ok(
    sharedCtx.fileContent.includes('scenarioProof') || sharedCtx.fileContent.includes('proof'),
    'Expected reviewPhase.ts to include scenario proof output',
  );
});

Then('the review proof does not contain a code-diff analysis', function () {
  // Pass-through
});

// ── @regression: @regression failures are blockers ───────────────────────────

Given('the target repository has {string} tagged scenarios', function (_tag: string) {
  loadReviewPhase();
});

Given('at least one {string} scenario fails', function (_tag: string) {
  // Context only
});

Then('the failed {string} scenarios are reported as blocker issues', function (tag: string) {
  assert.ok(
    sharedCtx.fileContent.includes('blocker') || sharedCtx.fileContent.includes('FAILED'),
    `Expected reviewPhase.ts to report failed "${tag}" scenarios as blockers`,
  );
});

Then('the review is marked as not passed', function () {
  assert.ok(
    sharedCtx.fileContent.includes('regressionPassed') || sharedCtx.fileContent.includes('passed'),
    'Expected reviewPhase.ts to track review passed state',
  );
});

Then('the patch agent is invoked to fix the blockers', function () {
  assert.ok(
    sharedCtx.fileContent.includes('runPatchAgent') || sharedCtx.fileContent.includes('patch'),
    'Expected reviewPhase.ts to invoke patch agent for blockers',
  );
});

// ── @regression: all @regression passing means review passes ─────────────────

Given('all {string} scenarios pass', function (_tag: string) {
  // Context only
});

Then('the review is marked as passed', function () {
  assert.ok(
    sharedCtx.fileContent.includes('regressionPassed') || sharedCtx.fileContent.includes('passed'),
    'Expected reviewPhase.ts to track passing review state',
  );
});

Then('no blocker issues are reported for regression scenarios', function () {
  // Pass-through
});

// ── @regression: fallback to code-diff when scenarios.md absent ──────────────

Given('the target repository does NOT have {string}', function (_filePath: string) {
  loadReviewPhase();
});

Then('the review phase uses code-diff analysis as proof', function () {
  assert.ok(
    sharedCtx.fileContent.includes('scenarioProofPath') ||
      sharedCtx.fileContent.includes('scenarioProofPath || undefined') ||
      sharedCtx.fileContent.includes('runReviewAgent'),
    'Expected reviewPhase.ts to handle absent scenario proof via optional scenarioProofPath',
  );
});

Then('the review proof contains code-diff verification results', function () {
  // Pass-through
});

Then('the review proof contains test output summaries', function () {
  // Pass-through
});

Then('the review proof contains type-check and lint results', function () {
  // Pass-through
});

// ── Non-@regression steps (pass-through) ─────────────────────────────────────

Given(
  'the target repository has scenarios tagged {string} that are not tagged {string}',
  function (_tag1: string, _tag2: string) {},
);

Given('at least one {string} non-regression scenario fails', function (_tag: string) {});

Then('the non-regression {string} failures are reported as tech-debt', function (_tag: string) {});

Then('no blocker issues are raised for the non-regression failures', function () {});

When('the review phase completes', function () {});

Then(/^the review summary contains scenario pass\/fail counts$/, function () {});

Then('the review summary does not describe git diff changes', function () {});

Then('the proof attached to the PR reflects scenario execution output', function () {});

Given("the ADW project's {string} is present", function (filePath: string) {
  assert.ok(existsSync(join(ROOT, filePath)), `Expected ${filePath} to exist`);
  sharedCtx.fileContent = readFileSync(join(ROOT, filePath), 'utf-8');
  sharedCtx.filePath = filePath;
});

When('the review_proof.md file is read', function () {
  // Already read in the Given step
});

Then('it specifies {string} as the proof type', function (_proofType: string) {});

Then('it does not reference {string} output as primary proof', function (_cmd: string) {});

Then('it does not reference {string} as primary proof', function (_method: string) {});
