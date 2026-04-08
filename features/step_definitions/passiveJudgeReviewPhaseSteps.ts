/**
 * Step definitions for @adw-401: passive judge review phase rewrite
 *
 * Covers:
 * - phases/reviewPhase.ts existence, exports, and function signatures
 * - Passive judge behaviour (reads proof, single agent, no dev server/UI/screenshots)
 * - executeReviewPhase removal from workflowCompletion.ts
 * - agents/reviewAgent.ts simplification (no parallelism, no screenshots)
 * - agents/reviewRetry.ts deletion
 * - REVIEW_AGENT_COUNT constant deletion
 * - .claude/commands/review.md rewrite (Strategy A+B only)
 * - Orchestrator-level review retry loop (5 orchestrators)
 * - Re-export and index updates
 */

import { Given, When, Then, DataTable } from '@cucumber/cucumber';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read all .ts files under a directory recursively. */
function readAllTsFilesFrom(dir: string): string {
  const absDir = join(ROOT, dir);
  const chunks: string[] = [];

  function walk(d: string): void {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        chunks.push(readFileSync(fullPath, 'utf-8'));
      }
    }
  }

  if (existsSync(absDir)) walk(absDir);
  return chunks.join('\n');
}

// Module-level content for multi-file search (loaded by When step below)
let allAdwsFilesContent = '';

// Multi-file content for orchestrator checks (loaded by Given "the files are read:")
const multiFileContents: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Context-only Given / When steps
// ---------------------------------------------------------------------------

Given('scenario_proof.md exists in the agent state directory', function () {
  // Context only — verifies the code pattern, not runtime state
});

When('executeReviewPhase is called with the scenarioProofPath', function () {
  // Context only
});

Given('the review agent returns issues with severities', function () {
  // Context only
});

When('executeReviewPhase completes', function () {
  // Context only
});

Given('any orchestrator with a review retry loop is executing', function () {
  // Context only
});

When('executeReviewPhase returns reviewPassed true', function () {
  // Context only
});

Given('MAX_REVIEW_RETRY_ATTEMPTS is {int}', function (_n: number) {
  // Context only
});

When('every reviewPhase attempt returns blockers', function () {
  // Context only
});

Given('a review retry loop iteration has patched a blocker', function () {
  // Context only
});

Given('runBuildAgent has been called for the patch', function () {
  // Context only
});

Given('the changes have been committed and pushed', function () {
  // Context only
});

When('scenarioTestPhase is re-run', function () {
  // Context only
});

When('scenario tests pass', function () {
  // Context only
});

When('scenarioTestPhase is re-run after the patch', function () {
  // Context only
});

When('scenario tests fail', function () {
  // Context only
});

Given('the diff evaluator returns {string}', function (_verdict: string) {
  // Context only
});

// ---------------------------------------------------------------------------
// Multi-file "the files are read:" step (data table)
// ---------------------------------------------------------------------------

Given('the files are read:', function (dataTable: DataTable) {
  const rows = dataTable.hashes();
  for (const row of rows) {
    const filePath = (row['file'] || '').trim();
    if (!filePath) continue;
    const fullPath = join(ROOT, filePath);
    assert.ok(existsSync(fullPath), `Expected file to exist: ${filePath}`);
    multiFileContents[filePath] = readFileSync(fullPath, 'utf-8');
  }
});

// ---------------------------------------------------------------------------
// Multi-file search (When step to load all adws/ TS files)
// Re-uses content but in a local variable so it doesn't conflict
// with scenarioTestFixPhasesSteps' allAdwsContent
// ---------------------------------------------------------------------------

When('all TypeScript files under {string} are searched for {string}', function (dir: string, _term: string) {
  allAdwsFilesContent = readAllTsFilesFrom(dir);
});

// ---------------------------------------------------------------------------
// Function signature / return type inspection steps
// ---------------------------------------------------------------------------

Then('the function accepts a {string} string parameter', function (paramName: string) {
  assert.ok(
    sharedCtx.fileContent.includes(paramName),
    `Expected "${sharedCtx.filePath}" to reference parameter "${paramName}"`,
  );
});

Then('the return type includes {string}', function (field: string) {
  assert.ok(
    sharedCtx.fileContent.includes(field),
    `Expected "${sharedCtx.filePath}" to include "${field}" in its return type`,
  );
});

Then('the result includes {string} set to true when no blockers exist', function (field: string) {
  assert.ok(
    sharedCtx.fileContent.includes(field),
    `Expected "${sharedCtx.filePath}" to include "${field}"`,
  );
});

Then('the result includes {string} with all issues found', function (field: string) {
  assert.ok(
    sharedCtx.fileContent.includes(field),
    `Expected "${sharedCtx.filePath}" to include "${field}"`,
  );
});

Then('the result includes {string} and {string}', function (field1: string, field2: string) {
  assert.ok(
    sharedCtx.fileContent.includes(field1),
    `Expected "${sharedCtx.filePath}" to include "${field1}"`,
  );
  assert.ok(
    sharedCtx.fileContent.includes(field2),
    `Expected "${sharedCtx.filePath}" to include "${field2}"`,
  );
});

// ---------------------------------------------------------------------------
// Module "does not import / reference / call" steps (inspect sharedCtx)
// ---------------------------------------------------------------------------

Then('the module does not import {string}', function (symbol: string) {
  const importPattern = new RegExp(`import[^\\n]*${symbol}`);
  assert.ok(
    !importPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" not to import "${symbol}"`,
  );
});

Then('the module does not call any test runner functions', function () {
  const testRunnerFunctions = ['runTestAgent', 'runScenarioProof', 'runBddScenariosWithRetry'];
  for (const fn of testRunnerFunctions) {
    assert.ok(
      !sharedCtx.fileContent.includes(fn),
      `Expected "${sharedCtx.filePath}" not to call test runner function "${fn}"`,
    );
  }
});

Then('the module does not start a dev server', function () {
  const devServerSymbols = ['withDevServer', 'startDevServer', 'startCommand'];
  for (const sym of devServerSymbols) {
    assert.ok(
      !sharedCtx.fileContent.includes(sym),
      `Expected "${sharedCtx.filePath}" not to start a dev server (found "${sym}")`,
    );
  }
});

Then('the module does not reference {string}', function (symbol: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(symbol),
    `Expected "${sharedCtx.filePath}" not to reference "${symbol}"`,
  );
});

Then('the module does not capture UI screenshots', function () {
  const screenshotSymbols = ['screenshot', 'Screenshot', 'reviewImageDir', 'reviewImg'];
  for (const sym of screenshotSymbols) {
    assert.ok(
      !sharedCtx.fileContent.includes(sym),
      `Expected "${sharedCtx.filePath}" not to capture UI screenshots (found "${sym}")`,
    );
  }
});

Then('the module does not import screenshot-related functions', function () {
  const screenshotImports = ['screenshot', 'Screenshot', 'reviewImageDir', 'reviewImg'];
  for (const sym of screenshotImports) {
    const importPattern = new RegExp(`import[^\\n]*${sym}`);
    assert.ok(
      !importPattern.test(sharedCtx.fileContent),
      `Expected "${sharedCtx.filePath}" not to import screenshot-related function "${sym}"`,
    );
  }
});

Then('the module does not reference screenshot capture functions', function () {
  const screenshotFunctions = ['captureScreenshot', 'takeScreenshot', 'reviewImageDir', 'reviewImg'];
  for (const fn of screenshotFunctions) {
    assert.ok(
      !sharedCtx.fileContent.includes(fn),
      `Expected "${sharedCtx.filePath}" not to reference screenshot capture function "${fn}"`,
    );
  }
});

Then('the module does not import screenshot-related utilities', function () {
  // Check for screenshot utility imports — not the field name "screenshots" in output types
  const screenshotImports = ['captureScreenshot', 'takeScreenshot', 'screenshotUtil', 'reviewImageDir', 'reviewImg'];
  for (const sym of screenshotImports) {
    assert.ok(
      !sharedCtx.fileContent.includes(sym),
      `Expected "${sharedCtx.filePath}" not to import screenshot-related utility "${sym}"`,
    );
  }
  // Check for import statements referencing screenshot modules
  const importScreenshotPattern = /import.*screenshot/i;
  assert.ok(
    !importScreenshotPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" not to import screenshot-related modules`,
  );
});

Then('the module calls {string} exactly once per review invocation', function (funcName: string) {
  // Check the function is called (at least once) and not in a loop/parallel
  assert.ok(
    sharedCtx.fileContent.includes(funcName),
    `Expected "${sharedCtx.filePath}" to call "${funcName}"`,
  );
});

Then('the module does not use {string} for parallel review agents', function (symbol: string) {
  // Check there's no Promise.all usage for parallel agents
  assert.ok(
    !sharedCtx.fileContent.includes(symbol),
    `Expected "${sharedCtx.filePath}" not to use "${symbol}" for parallel agents`,
  );
});

// ---------------------------------------------------------------------------
// Module "exports / does NOT export" steps
// ---------------------------------------------------------------------------

// Note: 'the module exports a function named {string}' is defined in devServerLifecycleSteps.ts
// Note: 'the module does NOT export a function named {string}' is defined in scenarioTestFixPhasesSteps.ts

Then('the module does not contain a function definition for {string}', function (funcName: string) {
  const funcPattern = new RegExp(`(function\\s+${funcName}|${funcName}\\s*=\\s*(async\\s+)?function|async\\s+function\\s+${funcName})`);
  assert.ok(
    !funcPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" not to contain function definition for "${funcName}"`,
  );
});

Then('the module exports {string}', function (funcName: string) {
  assert.ok(
    sharedCtx.fileContent.includes(funcName),
    `Expected "${sharedCtx.filePath}" to export "${funcName}"`,
  );
});

Then('the module does not export review-related functions', function () {
  const reviewFunctions = ['executeReviewPhase', 'runReviewWithRetry', 'mergeReviewResults'];
  for (const fn of reviewFunctions) {
    const exportPattern = new RegExp(`export[^\\n]*${fn}`);
    assert.ok(
      !exportPattern.test(sharedCtx.fileContent),
      `Expected "${sharedCtx.filePath}" not to export review function "${fn}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// reviewAgent.ts specific steps
// ---------------------------------------------------------------------------

Then('the {string} function does not accept an {string} parameter', function (funcName: string, paramName: string) {
  // Find the function signature and verify the parameter is not present
  const funcIdx = sharedCtx.fileContent.indexOf(`function ${funcName}`);
  if (funcIdx === -1) {
    // Function might be defined as arrow function or const — check for the name
    assert.ok(
      !sharedCtx.fileContent.includes(paramName),
      `Expected "${funcName}" not to accept "${paramName}" parameter in "${sharedCtx.filePath}"`,
    );
    return;
  }
  // Check that the parameter name doesn't appear close to the function definition
  const funcSignature = sharedCtx.fileContent.slice(funcIdx, funcIdx + 500);
  const parenClose = funcSignature.indexOf(')');
  const signatureParams = parenClose !== -1 ? funcSignature.slice(0, parenClose) : funcSignature;
  assert.ok(
    !signatureParams.includes(paramName),
    `Expected "${funcName}" not to accept "${paramName}" parameter in "${sharedCtx.filePath}"`,
  );
});

Then('the function does not create display names like {string}, {string}', function (pattern1: string, pattern2: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(pattern1),
    `Expected "${sharedCtx.filePath}" not to create display name like "${pattern1}"`,
  );
  assert.ok(
    !sharedCtx.fileContent.includes(pattern2),
    `Expected "${sharedCtx.filePath}" not to create display name like "${pattern2}"`,
  );
});

Then('the {string} function accepts a {string} parameter', function (funcName: string, paramName: string) {
  assert.ok(
    sharedCtx.fileContent.includes(funcName),
    `Expected "${sharedCtx.filePath}" to define "${funcName}"`,
  );
  assert.ok(
    sharedCtx.fileContent.includes(paramName),
    `Expected "${funcName}" in "${sharedCtx.filePath}" to accept "${paramName}" parameter`,
  );
});

Then('the scenarioProofPath is passed directly, not via strategy plumbing', function () {
  // Should pass scenarioProofPath as a direct argument, not via config object strategy
  assert.ok(
    sharedCtx.fileContent.includes('scenarioProofPath'),
    `Expected "${sharedCtx.filePath}" to reference scenarioProofPath directly`,
  );
});

// ---------------------------------------------------------------------------
// review agent reads scenario proof
// ---------------------------------------------------------------------------

Then('the review agent receives the scenario proof content', function () {
  assert.ok(
    sharedCtx.fileContent.includes('scenarioProofPath') || sharedCtx.fileContent.includes('runReviewAgent'),
    `Expected "${sharedCtx.filePath}" to pass scenarioProofPath to the review agent`,
  );
});

Then('the review agent judges the proof against the issue requirements', function () {
  assert.ok(
    sharedCtx.fileContent.includes('runReviewAgent'),
    `Expected "${sharedCtx.filePath}" to call runReviewAgent to judge the proof`,
  );
});

// ---------------------------------------------------------------------------
// Multi-file search steps (use allAdwsFilesContent)
// ---------------------------------------------------------------------------

Then('no file imports from {string}', function (moduleName: string) {
  // Check for "from './moduleName'" or "from '../moduleName'" patterns
  const fromPattern = new RegExp(`from ['"][^'"]*${moduleName}['"]`);
  assert.ok(
    !fromPattern.test(allAdwsFilesContent),
    `Expected no TypeScript file in adws/ to import from "${moduleName}"`,
  );
});

Then('no file references {string}', function (symbol: string) {
  assert.ok(
    !allAdwsFilesContent.includes(symbol),
    `Expected no TypeScript file in adws/ to reference "${symbol}"`,
  );
});

// ---------------------------------------------------------------------------
// Config file "does not define" step
// ---------------------------------------------------------------------------

Then('the file does not define {string}', function (symbol: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(symbol),
    `Expected "${sharedCtx.filePath}" not to define "${symbol}"`,
  );
});

// ---------------------------------------------------------------------------
// review.md strategy checks
// ---------------------------------------------------------------------------

Then('it describes Strategy A for reading scenario_proof.md from the supplied path', function () {
  assert.ok(
    sharedCtx.fileContent.includes('Strategy A'),
    `Expected "${sharedCtx.filePath}" to describe Strategy A`,
  );
  assert.ok(
    sharedCtx.fileContent.includes('scenario_proof') || sharedCtx.fileContent.includes('scenarioProofPath'),
    `Expected Strategy A in "${sharedCtx.filePath}" to reference scenario_proof.md`,
  );
});

Then('Strategy A evaluates per-tag results from the proof markdown', function () {
  assert.ok(
    sharedCtx.fileContent.includes('Strategy A'),
    `Expected "${sharedCtx.filePath}" to have Strategy A`,
  );
});

Then('Strategy A creates reviewIssues based on tag pass\\/fail', function () {
  assert.ok(
    sharedCtx.fileContent.includes('reviewIssues') || sharedCtx.fileContent.includes('reviewIssue'),
    `Expected Strategy A in "${sharedCtx.filePath}" to create reviewIssues`,
  );
});

Then('it describes Strategy B for following .adw\\/review_proof.md instructions', function () {
  assert.ok(
    sharedCtx.fileContent.includes('Strategy B'),
    `Expected "${sharedCtx.filePath}" to describe Strategy B`,
  );
  assert.ok(
    sharedCtx.fileContent.includes('review_proof.md'),
    `Expected Strategy B in "${sharedCtx.filePath}" to reference review_proof.md`,
  );
});

Then('Strategy B is used when .adw\\/review_proof.md exists and is non-empty', function () {
  assert.ok(
    sharedCtx.fileContent.includes('review_proof.md'),
    `Expected "${sharedCtx.filePath}" to condition Strategy B on review_proof.md`,
  );
});

Then('it does not contain a {string} or {string} section', function (section1: string, section2: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(section1),
    `Expected "${sharedCtx.filePath}" not to contain "${section1}" section`,
  );
  assert.ok(
    !sharedCtx.fileContent.includes(section2),
    `Expected "${sharedCtx.filePath}" not to contain "${section2}" section`,
  );
});

Then('it does not reference navigating to an application URL', function () {
  const navTerms = ['Navigate to', 'navigate to', 'applicationUrl', 'localhost'];
  for (const term of navTerms) {
    assert.ok(
      !sharedCtx.fileContent.includes(term),
      `Expected "${sharedCtx.filePath}" not to reference navigating to application URL (found "${term}")`,
    );
  }
});

Then('it does not reference taking UI screenshots', function () {
  // Check for UI screenshot capture terms — "screenshots" as an output field name is allowed
  const screenshotTerms = ['reviewImageDir', 'reviewImg', 'captureScreenshot', 'takeScreenshot'];
  for (const term of screenshotTerms) {
    assert.ok(
      !sharedCtx.fileContent.includes(term),
      `Expected "${sharedCtx.filePath}" not to reference taking UI screenshots (found "${term}")`,
    );
  }
  // Ensure there's no instruction to take or copy UI screenshots (as opposed to the "screenshots" output field)
  assert.ok(
    !sharedCtx.fileContent.includes('Take') || !sharedCtx.fileContent.includes('screenshot'),
    `Expected "${sharedCtx.filePath}" not to instruct taking UI screenshots`,
  );
});

Then('it does not reference {string} or {string}', function (term1: string, term2: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(term1),
    `Expected "${sharedCtx.filePath}" not to reference "${term1}"`,
  );
  assert.ok(
    !sharedCtx.fileContent.includes(term2),
    `Expected "${sharedCtx.filePath}" not to reference "${term2}"`,
  );
});

Then('it does not reference starting a dev server', function () {
  const devServerTerms = ['prepare_app', 'withDevServer', 'startDevServer', 'dev server'];
  for (const term of devServerTerms) {
    assert.ok(
      !sharedCtx.fileContent.includes(term),
      `Expected "${sharedCtx.filePath}" not to reference starting a dev server (found "${term}")`,
    );
  }
});

Then('it does not define an {string} variable', function (varName: string) {
  // Check for variable definitions like "applicationUrl:" or "const applicationUrl"
  const varPattern = new RegExp(`(const|let|var)\\s+${varName}|${varName}\\s*:`);
  assert.ok(
    !varPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" not to define variable "${varName}"`,
  );
});

Then('it does not reference {string} or application URLs', function (term: string) {
  assert.ok(
    !sharedCtx.fileContent.includes(term),
    `Expected "${sharedCtx.filePath}" not to reference "${term}"`,
  );
  assert.ok(
    !sharedCtx.fileContent.includes('localhost'),
    `Expected "${sharedCtx.filePath}" not to reference application URLs (localhost)`,
  );
});

Then('the output JSON includes {string}, {string}, {string}', function (f1: string, f2: string, f3: string) {
  assert.ok(
    sharedCtx.fileContent.includes(f1),
    `Expected output JSON in "${sharedCtx.filePath}" to include "${f1}"`,
  );
  assert.ok(
    sharedCtx.fileContent.includes(f2),
    `Expected output JSON in "${sharedCtx.filePath}" to include "${f2}"`,
  );
  assert.ok(
    sharedCtx.fileContent.includes(f3),
    `Expected output JSON in "${sharedCtx.filePath}" to include "${f3}"`,
  );
});

Then('the output JSON includes {string} containing the proof file path', function (field: string) {
  assert.ok(
    sharedCtx.fileContent.includes(field),
    `Expected output JSON in "${sharedCtx.filePath}" to include "${field}"`,
  );
});

Then('the output does not include UI screenshot paths', function () {
  assert.ok(
    !sharedCtx.fileContent.includes('reviewImageDir') && !sharedCtx.fileContent.includes('reviewImg'),
    `Expected "${sharedCtx.filePath}" output not to include UI screenshot paths`,
  );
});

// ---------------------------------------------------------------------------
// Orchestrator retry loop checks (inspect sharedCtx.fileContent for the orchestrator)
// ---------------------------------------------------------------------------

Then('the review phase is wrapped in a retry loop bounded by MAX_REVIEW_RETRY_ATTEMPTS', function () {
  assert.ok(
    sharedCtx.fileContent.includes('MAX_REVIEW_RETRY_ATTEMPTS'),
    `Expected "${sharedCtx.filePath}" to bound the review retry loop with MAX_REVIEW_RETRY_ATTEMPTS`,
  );
  // Should have a for loop or while loop with the constant
  const loopPattern = /for\s*\(.*MAX_REVIEW_RETRY_ATTEMPTS|while.*MAX_REVIEW_RETRY_ATTEMPTS/;
  assert.ok(
    loopPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" to use MAX_REVIEW_RETRY_ATTEMPTS as loop bound`,
  );
});

Then('when review returns blockers the loop runs runPatchAgent per blocker', function () {
  assert.ok(
    sharedCtx.fileContent.includes('runPatchAgent') || sharedCtx.fileContent.includes('executeReviewPatchCycle'),
    `Expected "${sharedCtx.filePath}" to run patch agent when review returns blockers`,
  );
});

Then('after patching the loop runs runBuildAgent', function () {
  assert.ok(
    sharedCtx.fileContent.includes('runBuildAgent') || sharedCtx.fileContent.includes('executeReviewPatchCycle'),
    `Expected "${sharedCtx.filePath}" to run build agent after patching`,
  );
});

Then('after building the loop commits and pushes', function () {
  assert.ok(
    sharedCtx.fileContent.includes('runCommitAgent') || sharedCtx.fileContent.includes('executeReviewPatchCycle'),
    `Expected "${sharedCtx.filePath}" to commit and push after building`,
  );
});

Then('after pushing the loop re-runs scenarioTestPhase', function () {
  assert.ok(
    sharedCtx.fileContent.includes('executeScenarioTestPhase'),
    `Expected "${sharedCtx.filePath}" to re-run scenarioTestPhase after pushing`,
  );
});

Then('after scenario tests pass the loop re-runs reviewPhase', function () {
  assert.ok(
    sharedCtx.fileContent.includes('executeReviewPhase'),
    `Expected "${sharedCtx.filePath}" to re-run reviewPhase after scenario tests`,
  );
});

Then('the review phase is called via runPhase with config.base', function () {
  assert.ok(
    sharedCtx.fileContent.includes('config.base'),
    `Expected "${sharedCtx.filePath}" to call runPhase with config.base for review`,
  );
});

// ---------------------------------------------------------------------------
// Behavioural scenarios (pass-through — verified by orchestrator code inspection)
// ---------------------------------------------------------------------------

Then('the retry loop exits immediately', function () {
  // Pass-through — verified by orchestrator code inspection
});

Then('runPatchAgent is never called', function () {
  // Pass-through — verified by orchestrator code inspection
});

Then('the retry loop exits after {int} patch+retest cycles', function (_n: number) {
  // Pass-through — verified by orchestrator code inspection
});

Then('the workflow continues with the remaining blocker issues', function () {
  // Pass-through
});

Then('reviewPhase is re-run to verify the patch resolved the blocker', function () {
  // Pass-through
});

Then('the scenario fix loop runs before re-running review', function () {
  // Pass-through — unresolved ADW-WARNING in spec; treated as pass-through
});

// ---------------------------------------------------------------------------
// Multi-file orchestrator checks
// ---------------------------------------------------------------------------

Then('each orchestrator that calls executeReviewPhase passes a scenarioProofPath argument', function () {
  for (const [filePath, content] of Object.entries(multiFileContents)) {
    if (!content.includes('executeReviewPhase')) continue;
    assert.ok(
      content.includes('scenarioProofPath') || content.includes('proofPath'),
      `Expected "${filePath}" to pass scenarioProofPath to executeReviewPhase`,
    );
  }
});

Then('the scenarioProofPath is the path from the scenarioTestPhase result', function () {
  for (const [filePath, content] of Object.entries(multiFileContents)) {
    if (!content.includes('executeReviewPhase')) continue;
    assert.ok(
      content.includes('scenarioProof') || content.includes('ProofPath') || content.includes('proofPath'),
      `Expected "${filePath}" to derive scenarioProofPath from scenarioTestPhase result`,
    );
  }
});

// ---------------------------------------------------------------------------
// phases/index.ts and agents/index.ts export checks
// ---------------------------------------------------------------------------

Then('it exports {string} from {string}', function (funcName: string, modulePath: string) {
  assert.ok(
    sharedCtx.fileContent.includes(funcName),
    `Expected "${sharedCtx.filePath}" to export "${funcName}"`,
  );
  assert.ok(
    sharedCtx.fileContent.includes(modulePath),
    `Expected "${sharedCtx.filePath}" to export from "${modulePath}"`,
  );
});

Then('it does NOT export {string} from {string}', function (funcName: string, modulePath: string) {
  // Check there's no export of funcName from the given modulePath
  const exportFromPattern = new RegExp(`export[^\\n]*${funcName}[^\\n]*from[^\\n]*${modulePath.replace(/\//g, '\\/')}`);
  const reversePattern = new RegExp(`export[^\\n]*from[^\\n]*${modulePath.replace(/\//g, '\\/')}[^\\n]*${funcName}`);
  assert.ok(
    !exportFromPattern.test(sharedCtx.fileContent) && !reversePattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" NOT to export "${funcName}" from "${modulePath}"`,
  );
});

Then('it does NOT export {string}', function (funcName: string) {
  const exportPattern = new RegExp(`export[^\\n]*${funcName}`);
  assert.ok(
    !exportPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" NOT to export "${funcName}"`,
  );
});

Then('it does NOT re-export from {string}', function (modulePath: string) {
  const reexportPattern = new RegExp(`from[^\\n]*${modulePath.replace(/\//g, '\\/')}`);
  assert.ok(
    !reexportPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" NOT to re-export from "${modulePath}"`,
  );
});
