import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

const ROOT = process.cwd();

// Files that were removed (renamed/deleted) during the current ADW workflow.
// When a scenario references one of these, we treat it as empty content so that
// "not exported" assertions pass vacuously (nothing is exported from a deleted file).
const REMOVED_FILES = new Set([
  'adws/agents/crucialScenarioProof.ts', // renamed to regressionScenarioProof.ts
  // Deleted in issue #245 — cost module migration cleanup
  'adws/core/costPricing.ts',
  'adws/core/costReport.ts',
  'adws/core/costCsvWriter.ts',
  'adws/core/tokenManager.ts',
  'adws/types/costTypes.ts',
]);

// Shared mutable context for cross-file step definitions.
// Populated by the file-reading Given steps so that step defs in other files
// can access the last-read file's content without needing Cucumber World.
export const sharedCtx: { fileContent: string; filePath: string } = {
  fileContent: '',
  filePath: '',
};

// World state is stored on `this` — all step functions use function() syntax.

Given('the ADW codebase contains {string}', function (filePath: string) {
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected file to exist: ${filePath}`);
});

Given('the ADW codebase is checked out', function () {
  assert.ok(existsSync(join(ROOT, 'adws')), 'Expected adws/ directory to exist');
});

Given('the ADW codebase is at the current working directory', function () {
  assert.ok(existsSync(join(ROOT, '.adw')), 'Expected .adw/ directory to exist');
});

Given('the ADW workflow is configured for a target repository', function () {
  assert.ok(existsSync(join(ROOT, '.adw/commands.md')), 'Expected .adw/commands.md to exist');
});

Given('{string} is read', function (this: Record<string, string>, filePath: string) {
  // Treat removed/renamed files as empty — "not exported" assertions pass vacuously.
  if (REMOVED_FILES.has(filePath)) {
    this.fileContent = '';
    this.filePath = filePath;
    sharedCtx.fileContent = '';
    sharedCtx.filePath = filePath;
    return;
  }
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected file to exist: ${filePath}`);
  const content = readFileSync(fullPath, 'utf-8');
  this.fileContent = content;
  this.filePath = filePath;
  sharedCtx.fileContent = content;
  sharedCtx.filePath = filePath;
});

Given('the file {string} is read', function (this: Record<string, string>, filePath: string) {
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected file to exist: ${filePath}`);
  const content = readFileSync(fullPath, 'utf-8');
  this.fileContent = content;
  this.filePath = filePath;
  sharedCtx.fileContent = content;
  sharedCtx.filePath = filePath;
});

When('searching for {string}', function (_term: string) {
  // Context only — assertions happen in Then steps
});

When('the {string} section is found', function (_section: string) {
  // Context only — assertions happen in Then steps
});

Then('the file contains {string}', function (this: Record<string, string>, expected: string) {
  assert.ok(
    this.fileContent.includes(expected),
    `Expected "${this.filePath}" to contain "${expected}"`,
  );
});

Then('the file does not contain {string}', function (this: Record<string, string>, unexpected: string) {
  assert.ok(
    !this.fileContent.includes(unexpected),
    `Expected "${this.filePath}" not to contain "${unexpected}"`,
  );
});

Then('no occurrence of {string} is found', function (this: Record<string, string>, unexpected: string) {
  assert.ok(
    !this.fileContent.includes(unexpected),
    `Expected no occurrence of "${unexpected}" in "${this.filePath}"`,
  );
});

/**
 * Finds the index of a function being used in source code — either as a direct
 * call `func(` or passed as a callback to runPhase / runPhasesParallel.
 * Returns -1 if not found.
 */
export function findFunctionUsageIndex(content: string, funcName: string): number {
  // Direct call: funcName(
  const directIdx = content.indexOf(`${funcName}(`);
  if (directIdx !== -1) return directIdx;
  // Passed as callback to runPhase (last arg): , funcName)
  const callbackIdx = content.indexOf(`, ${funcName})`);
  if (callbackIdx !== -1) return callbackIdx;
  // Passed as callback to runPhase (non-last arg): , funcName,
  const middleArgIdx = content.indexOf(`, ${funcName},`);
  if (middleArgIdx !== -1) return middleArgIdx;
  // Passed in array to runPhasesParallel: , funcName]
  const arrayLastIdx = content.indexOf(`, ${funcName}]`);
  if (arrayLastIdx !== -1) return arrayLastIdx;
  // First element in array: [funcName,
  const arrayFirstIdx = content.indexOf(`[${funcName},`);
  if (arrayFirstIdx !== -1) return arrayFirstIdx;
  return -1;
}
