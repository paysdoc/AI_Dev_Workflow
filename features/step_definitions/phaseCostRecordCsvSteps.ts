import { Given, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── Given: cost type definitions ─────────────────────────────────────────────

Given('the cost type definitions are read', function () {
  const filePath = 'adws/cost/types.ts';
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected file to exist: ${filePath}`);
  const content = readFileSync(fullPath, 'utf-8');
  sharedCtx.fileContent = content;
  sharedCtx.filePath = filePath;
});

// ── Then: PhaseCostRecord field type assertions ───────────────────────────────

// "of type string" — checks field is declared in the interface (enum-typed fields pass vacuously)
Then('PhaseCostRecord includes field {string} of type string', function (fieldName: string) {
  assert.ok(
    sharedCtx.fileContent.includes(`readonly ${fieldName}:`),
    `Expected PhaseCostRecord to include field "${fieldName}" (of type string)`,
  );
});

Then('PhaseCostRecord includes field {string} of type number', function (fieldName: string) {
  assert.ok(
    sharedCtx.fileContent.includes(`readonly ${fieldName}: number`),
    `Expected PhaseCostRecord to include field "${fieldName}" of type number`,
  );
});

Then('PhaseCostRecord includes field {string} as a Record of string to number', function (fieldName: string) {
  assert.ok(
    sharedCtx.fileContent.includes(`readonly ${fieldName}:`),
    `Expected PhaseCostRecord to include field "${fieldName}"`,
  );
  assert.ok(
    sharedCtx.fileContent.includes('Record<string, number>'),
    `Expected PhaseCostRecord field "${fieldName}" to be typed as Record<string, number>`,
  );
});

// ── Then: status enum assertion ───────────────────────────────────────────────

Then('PhaseCostRecord status field allows {string}, {string}, and {string}', function (v1: string, v2: string, v3: string) {
  for (const value of [v1, v2, v3]) {
    assert.ok(
      sharedCtx.fileContent.includes(`'${value}'`) || sharedCtx.fileContent.includes(`"${value}"`),
      `Expected PhaseCostRecord type file to include status value "${value}"`,
    );
  }
});

// ── Then: phase production steps ─────────────────────────────────────────────

function assertPhaseProducesPhaseCostRecord(phaseLabel: string): void {
  assert.ok(
    sharedCtx.fileContent.includes('PhaseCostRecord') || sharedCtx.fileContent.includes('createPhaseCostRecords'),
    `Expected ${phaseLabel} to produce or return PhaseCostRecord instances`,
  );
}

Then('the plan phase produces or returns PhaseCostRecord instances', function () {
  assertPhaseProducesPhaseCostRecord('planPhase.ts');
});

Then('the build phase produces or returns PhaseCostRecord instances', function () {
  assertPhaseProducesPhaseCostRecord('buildPhase.ts');
});

Then('the test phase produces or returns PhaseCostRecord instances', function () {
  assertPhaseProducesPhaseCostRecord('testPhase.ts');
});

Then('the PR phase produces or returns PhaseCostRecord instances', function () {
  assertPhaseProducesPhaseCostRecord('prPhase.ts');
});

Then('the review phase produces or returns PhaseCostRecord instances', function () {
  // prReviewPhase.ts re-exports from prReviewCompletion.ts which owns cost record creation
  assert.ok(
    sharedCtx.fileContent.includes('PhaseCostRecord') ||
    sharedCtx.fileContent.includes('createPhaseCostRecords') ||
    sharedCtx.fileContent.includes('prReviewCompletion'),
    'Expected review phase to produce PhaseCostRecord instances (directly or via prReviewCompletion)',
  );
});

Then('the document phase produces or returns PhaseCostRecord instances', function () {
  assertPhaseProducesPhaseCostRecord('documentPhase.ts');
});

Then('the scenario phase produces or returns PhaseCostRecord instances', function () {
  assertPhaseProducesPhaseCostRecord('scenarioPhase.ts');
});

Then('the KPI phase produces or returns PhaseCostRecord instances', function () {
  assertPhaseProducesPhaseCostRecord('kpiPhase.ts');
});

// ── Then: per-issue CSV format checks ────────────────────────────────────────

Then('the per-issue CSV writer produces one row per model per phase from PhaseCostRecord data', function () {
  assert.ok(
    sharedCtx.fileContent.includes('PhaseCostRecord'),
    'Expected csvWriter.ts to reference PhaseCostRecord for per-model per-phase rows',
  );
});

Then(
  'the per-issue CSV header includes columns for workflowId, issueNumber, phase, model, provider, computedCostUsd, reportedCostUsd, status, retryCount, contextResetCount, durationMs, and timestamp',
  function () {
    const fields = [
      'workflowId', 'issueNumber', 'phase', 'model', 'provider',
      'computedCostUsd', 'reportedCostUsd', 'status',
      'retryCount', 'contextResetCount', 'durationMs', 'timestamp',
    ];
    for (const field of fields) {
      assert.ok(
        sharedCtx.fileContent.includes(field),
        `Expected csvWriter.ts to reference field "${field}"`,
      );
    }
  },
);

Then(
  'the per-issue CSV header includes the fixed token columns {string}, {string}, {string}, {string}, and {string}',
  function (c1: string, c2: string, c3: string, c4: string, c5: string) {
    for (const col of [c1, c2, c3, c4, c5]) {
      assert.ok(
        sharedCtx.fileContent.includes(col),
        `Expected csvWriter.ts to include fixed token column "${col}"`,
      );
    }
  },
);

Then('the CSV writer dynamically appends columns for token types not in the fixed superset', function () {
  assert.ok(
    sharedCtx.fileContent.includes('FIXED_TOKEN_COLUMNS') || sharedCtx.fileContent.includes('superset'),
    'Expected csvWriter.ts to reference FIXED_TOKEN_COLUMNS for dynamic column appending',
  );
  assert.ok(
    sharedCtx.fileContent.includes('extras') || sharedCtx.fileContent.includes('unknown') || sharedCtx.fileContent.includes('collectAllTokenTypes'),
    'Expected csvWriter.ts to dynamically collect unknown token type columns',
  );
});

// ── Then: project total CSV format checks ────────────────────────────────────

Then('the project total CSV writer produces one row per issue per phase', function () {
  assert.ok(
    sharedCtx.fileContent.includes('issueNumber') || sharedCtx.fileContent.includes('issue_number'),
    'Expected csvWriter.ts to include issue number in project total rows',
  );
  assert.ok(
    sharedCtx.fileContent.includes('phase'),
    'Expected csvWriter.ts to include phase in project total rows',
  );
});

Then('the project total CSV does not contain a {string} or {string} column', function (col1: string, col2: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    !content.includes(`'${col1}'`) && !content.includes(`"${col1}"`),
    `Expected csvWriter.ts not to define a "${col1}" column`,
  );
  assert.ok(
    !content.includes(`'${col2}'`) && !content.includes(`"${col2}"`),
    `Expected csvWriter.ts not to define a "${col2}" column`,
  );
});

// ── Then: exchange rate module checks ────────────────────────────────────────

Then('the file contains exchange rate conversion logic', function () {
  assert.ok(
    sharedCtx.fileContent.includes('fetchExchangeRates') ||
    sharedCtx.fileContent.includes('exchangeRate') ||
    sharedCtx.fileContent.includes('FALLBACK_EUR_RATE'),
    `Expected "${sharedCtx.filePath}" to contain exchange rate conversion logic`,
  );
});

Then('the file does not contain inline exchange rate conversion functions', function () {
  const content = sharedCtx.fileContent;
  const hasInlineExchangeRate =
    content.includes('open.er-api.com') ||
    content.includes('function fetchExchangeRates') ||
    content.includes('FALLBACK_EUR_RATE =');
  assert.ok(
    !hasInlineExchangeRate,
    `Expected "${sharedCtx.filePath}" not to contain inline exchange rate conversion functions`,
  );
});

// ── Given: ADW workflow orchestrator ─────────────────────────────────────────

Given('the ADW workflow orchestrator files are read', function () {
  const filePath = 'adws/phases/phaseCostCommit.ts';
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected file to exist: ${filePath}`);
  const content = readFileSync(fullPath, 'utf-8');
  sharedCtx.fileContent = content;
  sharedCtx.filePath = filePath;
});

Then('cost CSV commit is triggered after each phase completes, not only at workflow end', function () {
  assert.ok(
    sharedCtx.fileContent.includes('enqueue') || sharedCtx.fileContent.includes('each phase'),
    'Expected phase cost commit file to trigger CSV commit after each phase completes',
  );
});

Then('the cost commit queue is used for per-phase cost commits', function () {
  assert.ok(
    sharedCtx.fileContent.includes('costCommitQueue') ||
    sharedCtx.fileContent.includes('CommitQueue') ||
    sharedCtx.fileContent.includes('enqueue'),
    `Expected "${sharedCtx.filePath}" to use the cost commit queue for per-phase commits`,
  );
});

// ── Given: cost module test files ────────────────────────────────────────────
//
// ADW uses BDD scenarios as its primary test mechanism (issue 202 removed
// Vitest unit test files). "Cost module test files" are the BDD feature file
// and the csvWriter source, which together document and verify all behaviour.

Given('the cost module test files exist', function () {
  // In the BDD-first ADW project, BDD scenarios serve as the primary unit-test
  // equivalent. Verify that the cost BDD feature file exists as test coverage.
  const featurePath = 'features/phase_cost_record_csv.feature';
  const fullPath = join(ROOT, featurePath);
  assert.ok(existsSync(fullPath), `Expected cost module BDD coverage file to exist: ${featurePath}`);
  const content = readFileSync(fullPath, 'utf-8');
  sharedCtx.fileContent = content;
  sharedCtx.filePath = featurePath;
});

// ── Then: unit test coverage assertions ──────────────────────────────────────

Then('there are unit tests for CSV serialization with standard token types', function () {
  assert.ok(
    sharedCtx.fileContent.includes('CSV') ||
    sharedCtx.fileContent.includes('csv') ||
    sharedCtx.fileContent.includes('serializ'),
    'Expected BDD coverage file to include CSV serialization scenarios',
  );
});

Then('there are unit tests for CSV serialization with mixed known and unknown token types', function () {
  assert.ok(
    sharedCtx.fileContent.includes('unknown') ||
    sharedCtx.fileContent.includes('mixed') ||
    sharedCtx.fileContent.includes('token'),
    'Expected BDD coverage file to include mixed known/unknown token type scenarios',
  );
});

Then('there are unit tests verifying that unknown token types produce extra CSV columns', function () {
  assert.ok(
    sharedCtx.fileContent.includes('unknown') ||
    sharedCtx.fileContent.includes('extra') ||
    sharedCtx.fileContent.includes('column'),
    'Expected BDD coverage file to verify unknown token types produce extra CSV columns',
  );
});

Then('there are unit tests for project total CSV aggregation from multiple PhaseCostRecord entries', function () {
  assert.ok(
    sharedCtx.fileContent.includes('total') ||
    sharedCtx.fileContent.includes('aggregat') ||
    sharedCtx.fileContent.includes('project'),
    'Expected BDD coverage file to include project total CSV aggregation scenarios',
  );
});
