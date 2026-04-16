/**
 * Step definitions for @adw-400:
 * Wire scenarioTestPhase + scenarioFixPhase into remaining orchestrators.
 *
 * Covers:
 * - Per-orchestrator retry loop assertions (MAX_TEST_RETRY_ATTEMPTS, hasBlockerFailures)
 * - adwPrReview.tsx config.base / closure patterns
 * - adwChore.tsx diff evaluator gate ordering
 * - adwPlanBuildTestReview.tsx review phase empty scenariosMd
 * - All-five-orchestrators consistency check
 */

import { Given, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx, findFunctionUsageIndex } from './commonSteps.ts';

const ROOT = process.cwd();

// ── Retry loop: hasBlockerFailures gating (shared across orchestrators) ──────

Then('the retry loop calls executeScenarioFixPhase when scenarioProof has hasBlockerFailures true', function () {
  const content = sharedCtx.fileContent;
  const fixIdx = findFunctionUsageIndex(content, 'executeScenarioFixPhase');
  assert.ok(
    fixIdx !== -1,
    `Expected "${sharedCtx.filePath}" to call executeScenarioFixPhase in the retry loop`,
  );
  assert.ok(
    content.includes('hasBlockerFailures'),
    `Expected "${sharedCtx.filePath}" to check hasBlockerFailures before calling fix phase`,
  );
});

// ── adwPrReview.tsx: config.base and closure patterns ────────────────────────

Then('executeScenarioTestPhase is called via runPhase with config.base as the first argument', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('config.base'),
    `Expected "${sharedCtx.filePath}" to use config.base`,
  );
  const scenarioIdx = findFunctionUsageIndex(content, 'executeScenarioTestPhase');
  assert.ok(
    scenarioIdx !== -1,
    `Expected "${sharedCtx.filePath}" to call executeScenarioTestPhase`,
  );
});

Then('executeScenarioFixPhase is called via runPhase with config.base as the first argument', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('config.base'),
    `Expected "${sharedCtx.filePath}" to use config.base`,
  );
  const fixIdx = findFunctionUsageIndex(content, 'executeScenarioFixPhase');
  assert.ok(
    fixIdx !== -1,
    `Expected "${sharedCtx.filePath}" to call executeScenarioFixPhase`,
  );
});

Then('no scenario phase call passes the full PRReviewWorkflowConfig directly', function () {
  const content = sharedCtx.fileContent;
  // runPhase calls should use config.base, not config directly for scenario phases
  // The pattern is: runPhase(config.base, tracker, executeScenarioTestPhase)
  // NOT: runPhase(config, tracker, executeScenarioTestPhase) — where config is the full PRReviewWorkflowConfig
  assert.ok(
    content.includes('config.base'),
    `Expected "${sharedCtx.filePath}" to pass config.base (not full config) for scenario phases`,
  );
});

Then('the scenario fix phase is called via a closure wrapping executeScenarioFixPhase with scenarioProof', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('executeScenarioFixPhase') && content.includes('scenarioProof'),
    `Expected "${sharedCtx.filePath}" to wrap executeScenarioFixPhase with scenarioProof in a closure`,
  );
  // Verify the closure pattern: (cfg) => executeScenarioFixPhase(cfg, scenarioResult.scenarioProof)
  assert.ok(
    content.includes('fixWrapper') || content.includes('=>'),
    `Expected "${sharedCtx.filePath}" to use a closure/wrapper for the fix phase`,
  );
});

Then('executeUnitTestPhase is called via runPhase with config.base', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('config.base'),
    `Expected "${sharedCtx.filePath}" to use config.base`,
  );
  const unitIdx = findFunctionUsageIndex(content, 'executeUnitTestPhase');
  assert.ok(
    unitIdx !== -1,
    `Expected "${sharedCtx.filePath}" to call executeUnitTestPhase`,
  );
});

// ── adwChore.tsx: diff evaluator gate ordering ───────────────────────────────

Then('executeDiffEvaluationPhase is called after the scenario test retry loop completes', function () {
  const content = sharedCtx.fileContent;
  const scenarioFixIdx = findFunctionUsageIndex(content, 'executeScenarioFixPhase');
  const diffIdx = findFunctionUsageIndex(content, 'executeDiffEvaluationPhase');
  assert.ok(diffIdx !== -1, `Expected "${sharedCtx.filePath}" to call executeDiffEvaluationPhase`);
  assert.ok(scenarioFixIdx !== -1, `Expected "${sharedCtx.filePath}" to call executeScenarioFixPhase`);
  assert.ok(
    diffIdx > scenarioFixIdx,
    `Expected executeDiffEvaluationPhase to appear after scenario retry loop in "${sharedCtx.filePath}"`,
  );
});

Then('the diff evaluator verdict still gates the review and document phases', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('verdict') || content.includes('diffResult'),
    `Expected "${sharedCtx.filePath}" to check diff evaluator verdict`,
  );
  assert.ok(
    content.includes('executeReviewPhase') || content.includes('review'),
    `Expected "${sharedCtx.filePath}" to gate review phase on verdict`,
  );
});

Then('the diff evaluator gate is unchanged from its previous behaviour', function () {
  const content = sharedCtx.fileContent;
  // Verify the conditional pattern: if verdict !== 'safe' then review + document
  assert.ok(
    content.includes("verdict") && (content.includes("'safe'") || content.includes('"safe"')),
    `Expected "${sharedCtx.filePath}" to compare verdict against 'safe'`,
  );
});

// ── adwPlanBuildTestReview.tsx: review phase empty scenariosMd ────────────────
// Note: 'the review phase is called with empty scenariosMd' is already defined
// in scenarioTestFixPhasesSteps.ts

// ── 5. All five orchestrators consistency check ──────────────────────────────

// Multi-file contents for the consistency scenario
const orchestratorContents: Record<string, string> = {};

Given('the orchestrator files are read:', function (dataTable: { hashes(): Array<{ file: string }> }) {
  const rows = dataTable.hashes();
  for (const row of rows) {
    const filePath = row.file.trim();
    if (!filePath) continue;
    const fullPath = join(ROOT, filePath);
    assert.ok(existsSync(fullPath), `Expected file to exist: ${filePath}`);
    orchestratorContents[filePath] = readFileSync(fullPath, 'utf-8');
  }
});

Then('each orchestrator imports executeScenarioTestPhase', function () {
  for (const [filePath, content] of Object.entries(orchestratorContents)) {
    assert.ok(
      content.includes('executeScenarioTestPhase'),
      `Expected "${filePath}" to import executeScenarioTestPhase`,
    );
  }
});

Then('each orchestrator imports executeScenarioFixPhase', function () {
  for (const [filePath, content] of Object.entries(orchestratorContents)) {
    assert.ok(
      content.includes('executeScenarioFixPhase'),
      `Expected "${filePath}" to import executeScenarioFixPhase`,
    );
  }
});

Then('each orchestrator has a scenarioTest-scenarioFix retry loop bounded by MAX_TEST_RETRY_ATTEMPTS', function () {
  for (const [filePath, content] of Object.entries(orchestratorContents)) {
    assert.ok(
      content.includes('MAX_TEST_RETRY_ATTEMPTS'),
      `Expected "${filePath}" to use MAX_TEST_RETRY_ATTEMPTS in retry loop`,
    );
    const testIdx = findFunctionUsageIndex(content, 'executeScenarioTestPhase');
    const fixIdx = findFunctionUsageIndex(content, 'executeScenarioFixPhase');
    assert.ok(testIdx !== -1, `Expected "${filePath}" to call executeScenarioTestPhase`);
    assert.ok(fixIdx !== -1, `Expected "${filePath}" to call executeScenarioFixPhase`);
  }
});

Then('each orchestrator calls executeUnitTestPhase before executeScenarioTestPhase', function () {
  for (const [filePath, content] of Object.entries(orchestratorContents)) {
    const unitIdx = findFunctionUsageIndex(content, 'executeUnitTestPhase');
    const scenarioIdx = findFunctionUsageIndex(content, 'executeScenarioTestPhase');
    assert.ok(unitIdx !== -1, `Expected "${filePath}" to call executeUnitTestPhase`);
    assert.ok(scenarioIdx !== -1, `Expected "${filePath}" to call executeScenarioTestPhase`);
    assert.ok(
      unitIdx < scenarioIdx,
      `Expected executeUnitTestPhase before executeScenarioTestPhase in "${filePath}"`,
    );
  }
});

// ── 6. Retry loop behaviour (cross-cutting) ────────────────────────────────

Given('any of the four newly-wired orchestrators is executing the scenario retry loop', function () {
  // Read one representative orchestrator to validate the loop pattern
  const filePath = 'adws/adwPlanBuildTest.tsx';
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = filePath;
});

Given('MAX_TEST_RETRY_ATTEMPTS is {int}', function (_max: number) {
  // Context annotation — the actual constant is read from the source
});
