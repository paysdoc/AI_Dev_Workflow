/**
 * Step definitions for @adw-402: executePRReviewTestPhase relocation + commit+push extraction
 *
 * Covers:
 * - executePRReviewTestPhase moved from prReviewCompletion.ts to prReviewPhase.ts
 * - New executePRReviewCommitPushPhase in prReviewPhase.ts
 * - completePRReviewWorkflow trimmed to terminal-handler only
 * - adwPrReview.tsx wires commit+push phase via runPhase
 * - Export chain updates (phases/index.ts, workflowPhases.ts, adws/index.ts)
 */

import { When, Then } from '@cucumber/cucumber';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx, findFunctionUsageIndex } from './commonSteps.ts';

const ROOT = process.cwd();

// ---------------------------------------------------------------------------
// 1. executePRReviewTestPhase relocated
// ---------------------------------------------------------------------------

Then('the module defines the function {string}', function (funcName: string) {
  const exportPattern = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${funcName}\\b`,
  );
  assert.ok(
    exportPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" to define exported function "${funcName}"`,
  );
});

Then('the function is not imported from prReviewCompletion', function () {
  assert.ok(
    !sharedCtx.fileContent.includes("from './prReviewCompletion'"),
    `Expected "${sharedCtx.filePath}" not to import from './prReviewCompletion'`,
  );
});

Then('the module does NOT define a function named {string}', function (funcName: string) {
  const definePattern = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${funcName}\\b`,
  );
  assert.ok(
    !definePattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" NOT to define a function named "${funcName}"`,
  );
});

Then('the module does NOT export {string}', function (exportName: string) {
  // Check for direct export definition
  const directExportPattern = new RegExp(
    `export\\s+(?:async\\s+)?(?:function|const|class)\\s+${exportName}\\b`,
  );
  assert.ok(
    !directExportPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" NOT to export "${exportName}" (direct definition)`,
  );
  // Check for named re-export: export { exportName } or export { exportName, ...
  const reExportPattern = new RegExp(
    `export\\s*\\{[^}]*\\b${exportName}\\b[^}]*\\}`,
  );
  assert.ok(
    !reExportPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" NOT to re-export "${exportName}"`,
  );
});

Then('the file does not re-export {string} from {string}', function (symbol: string, source: string) {
  // Check for: export { symbol } from 'source' or export { symbol, ... } from 'source'
  const pattern = new RegExp(
    `export\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*['"]${source.replace(/\./g, '\\.').replace(/\//g, '/')}['"]`,
  );
  assert.ok(
    !pattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" not to re-export "${symbol}" from "${source}"`,
  );
});

// ---------------------------------------------------------------------------
// 2. Barrel export chain check
// ---------------------------------------------------------------------------

let reExportSources: Map<string, string[]> = new Map();

When('all TypeScript files under {string} are searched for {string}', function (dir: string, symbol: string) {
  const fullDir = join(ROOT, dir);
  const collect = (d: string): string[] => {
    return readdirSync(d).flatMap((entry: string) => {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) return collect(full);
      if (entry.endsWith('.ts') || entry.endsWith('.tsx')) return [full];
      return [];
    });
  };

  const files = collect(fullDir);
  reExportSources = new Map();

  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    if (content.includes(symbol)) {
      const relPath = file.replace(ROOT + '/', '');
      // Find what file this re-exports the symbol from
      const fromMatch = content.match(
        new RegExp(`export\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`),
      );
      if (fromMatch) {
        reExportSources.set(relPath, [fromMatch[1]]);
      }
    }
  }
  this.adwsSearchSymbol = symbol;
  this.adwsSearchDir = dir;
});

Then('every re-export chain traces back to {string}', function (targetFile: string) {
  // Check that the target file exports the symbol directly (not re-exports)
  const targetContent = readFileSync(join(ROOT, targetFile), 'utf-8');
  const symbol = this.adwsSearchSymbol as string;
  const directExport = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${symbol}\\b`,
  );
  assert.ok(
    directExport.test(targetContent),
    `Expected "${targetFile}" to directly define/export "${symbol}"`,
  );
});

Then('no re-export chain traces back to {string}', function (forbiddenFile: string) {
  const symbol = this.adwsSearchSymbol as string;
  // Check that neither the file itself exports it, nor any barrel re-exports from it
  for (const [file, sources] of reExportSources) {
    for (const source of sources) {
      assert.ok(
        !source.includes(forbiddenFile.replace('adws/phases/', '')),
        `Expected no file to re-export "${symbol}" from "${forbiddenFile}" (found in "${file}")`,
      );
    }
  }
  // Also check direct export in the forbidden file
  try {
    const forbiddenContent = readFileSync(join(ROOT, forbiddenFile), 'utf-8');
    const directExport = new RegExp(
      `export\\s+(?:async\\s+)?function\\s+${symbol}\\b`,
    );
    assert.ok(
      !directExport.test(forbiddenContent),
      `Expected "${forbiddenFile}" NOT to directly define/export "${symbol}"`,
    );
  } catch {
    // File doesn't exist — that's fine
  }
});

// ---------------------------------------------------------------------------
// 3. executePRReviewCommitPushPhase existence and shape
// Note: 'the module exports a function named {string}' is defined in devServerLifecycleSteps.ts
// Note: 'the function {string} calls {string}' is defined in autoApproveMergeAfterReviewSteps.ts
// ---------------------------------------------------------------------------

Then('executePRReviewCommitPushPhase accepts a {string} parameter', function (paramType: string) {
  const content = sharedCtx.fileContent;
  // Check the function signature includes the type
  assert.ok(
    content.includes(`executePRReviewCommitPushPhase`) && content.includes(paramType),
    `Expected "executePRReviewCommitPushPhase" in "${sharedCtx.filePath}" to accept "${paramType}" parameter`,
  );
});

Then('executePRReviewCommitPushPhase returns an object with {string}, {string}, and {string}', function (
  field1: string, field2: string, field3: string,
) {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function executePRReviewCommitPushPhase');
  assert.ok(fnIdx !== -1, `Expected "${sharedCtx.filePath}" to define "executePRReviewCommitPushPhase"`);
  const fromFn = content.slice(fnIdx);
  assert.ok(fromFn.includes(field1), `Expected "executePRReviewCommitPushPhase" to return "${field1}"`);
  assert.ok(fromFn.includes(field2), `Expected "executePRReviewCommitPushPhase" to return "${field2}"`);
  assert.ok(fromFn.includes(field3), `Expected "executePRReviewCommitPushPhase" to return "${field3}"`);
});

Then('executePRReviewCommitPushPhase posts {string} before the commit', function (stageKey: string) {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function executePRReviewCommitPushPhase');
  assert.ok(fnIdx !== -1, `Expected "${sharedCtx.filePath}" to define "executePRReviewCommitPushPhase"`);
  const fromFn = content.slice(fnIdx);
  assert.ok(
    fromFn.includes(stageKey),
    `Expected "executePRReviewCommitPushPhase" to post stage comment "${stageKey}"`,
  );
  // Check it appears before runCommitAgent
  const stageIdx = fromFn.indexOf(stageKey);
  const commitIdx = fromFn.indexOf('runCommitAgent');
  assert.ok(
    stageIdx < commitIdx,
    `Expected "${stageKey}" to be posted before "runCommitAgent" in executePRReviewCommitPushPhase`,
  );
});

Then('executePRReviewCommitPushPhase posts {string} after the push', function (stageKey: string) {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function executePRReviewCommitPushPhase');
  assert.ok(fnIdx !== -1, `Expected "${sharedCtx.filePath}" to define "executePRReviewCommitPushPhase"`);
  const fromFn = content.slice(fnIdx);
  assert.ok(
    fromFn.includes(stageKey),
    `Expected "executePRReviewCommitPushPhase" to post stage comment "${stageKey}"`,
  );
  // Check it appears after pushBranch
  const pushIdx = fromFn.indexOf('pushBranch');
  const stageIdx = fromFn.indexOf(stageKey);
  assert.ok(
    stageIdx > pushIdx,
    `Expected "${stageKey}" to be posted after "pushBranch" in executePRReviewCommitPushPhase`,
  );
});

// ---------------------------------------------------------------------------
// 4. completePRReviewWorkflow terminal-handler checks
// ---------------------------------------------------------------------------

Then('the function {string} does not call {string}', function (ownerFn: string, calledFn: string) {
  const fnIdx = sharedCtx.fileContent.indexOf(`function ${ownerFn}`);
  assert.ok(fnIdx !== -1, `Expected "${sharedCtx.filePath}" to define function "${ownerFn}"`);
  const fromFn = sharedCtx.fileContent.slice(fnIdx);
  // Find the end of this function by counting braces
  let depth = 0;
  let inFn = false;
  let endIdx = fromFn.length;
  for (let i = 0; i < fromFn.length; i++) {
    if (fromFn[i] === '{') { depth++; inFn = true; }
    else if (fromFn[i] === '}') {
      depth--;
      if (inFn && depth === 0) { endIdx = i + 1; break; }
    }
  }
  const fnBody = fromFn.slice(0, endIdx);
  assert.ok(
    !fnBody.includes(calledFn),
    `Expected function "${ownerFn}" in "${sharedCtx.filePath}" NOT to call "${calledFn}"`,
  );
});

// Note: 'the file does not import {string}' is defined in orchestratorAwaitingMergeHandoffSteps.ts

Then('completePRReviewWorkflow calls {string} to build the cost section', function (funcName: string) {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function completePRReviewWorkflow');
  assert.ok(fnIdx !== -1, `Expected "${sharedCtx.filePath}" to define "completePRReviewWorkflow"`);
  const fromFn = content.slice(fnIdx);
  assert.ok(
    fromFn.includes(funcName),
    `Expected "completePRReviewWorkflow" to call "${funcName}"`,
  );
});

Then('completePRReviewWorkflow calls {string} to write final state', function (funcName: string) {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function completePRReviewWorkflow');
  assert.ok(fnIdx !== -1, `Expected "${sharedCtx.filePath}" to define "completePRReviewWorkflow"`);
  const fromFn = content.slice(fnIdx);
  assert.ok(
    fromFn.includes(funcName),
    `Expected "completePRReviewWorkflow" to call "${funcName}"`,
  );
});

Then('completePRReviewWorkflow posts {string} comment', function (stageKey: string) {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function completePRReviewWorkflow');
  assert.ok(fnIdx !== -1, `Expected "${sharedCtx.filePath}" to define "completePRReviewWorkflow"`);
  const fromFn = content.slice(fnIdx);
  assert.ok(
    fromFn.includes(stageKey),
    `Expected "completePRReviewWorkflow" to post stage comment "${stageKey}"`,
  );
});

Then('completePRReviewWorkflow logs a completion banner', function () {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function completePRReviewWorkflow');
  assert.ok(fnIdx !== -1, `Expected "${sharedCtx.filePath}" to define "completePRReviewWorkflow"`);
  const fromFn = content.slice(fnIdx);
  const hasBanner = fromFn.includes('log(') && (
    fromFn.includes('completed') || fromFn.includes('ADW PR Review') || fromFn.includes('success')
  );
  assert.ok(hasBanner, `Expected "completePRReviewWorkflow" to log a completion banner`);
});

Then('completePRReviewWorkflow does not post {string}', function (stageKey: string) {
  const content = sharedCtx.fileContent;
  const fnIdx = content.indexOf('function completePRReviewWorkflow');
  assert.ok(fnIdx !== -1, `Expected "${sharedCtx.filePath}" to define "completePRReviewWorkflow"`);
  // Find the function body end
  const fromFn = content.slice(fnIdx);
  let depth = 0;
  let inFn = false;
  let endIdx = fromFn.length;
  for (let i = 0; i < fromFn.length; i++) {
    if (fromFn[i] === '{') { depth++; inFn = true; }
    else if (fromFn[i] === '}') {
      depth--;
      if (inFn && depth === 0) { endIdx = i + 1; break; }
    }
  }
  const fnBody = fromFn.slice(0, endIdx);
  assert.ok(
    !fnBody.includes(stageKey),
    `Expected "completePRReviewWorkflow" NOT to post stage comment "${stageKey}"`,
  );
});

// ---------------------------------------------------------------------------
// 5. prReviewCompletion.ts exports only terminal handlers
// ---------------------------------------------------------------------------

Then('the module exports {string}', function (exportName: string) {
  const exportPattern = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${exportName}\\b`,
  );
  assert.ok(
    exportPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" to export "${exportName}"`,
  );
});

Then('the module does not export any function prefixed with {string}', function (prefix: string) {
  const exportPattern = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${prefix}`,
  );
  assert.ok(
    !exportPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" NOT to export any function prefixed with "${prefix}"`,
  );
});

// ---------------------------------------------------------------------------
// 6. adwPrReview.tsx wiring
// ---------------------------------------------------------------------------

Then('executePRReviewCommitPushPhase is called via runPhase after the scenario test retry loop', function () {
  const content = sharedCtx.fileContent;
  // The commit+push phase should appear after the scenario retry loop
  const loopIdx = content.indexOf('for (let attempt');
  const commitPushIdx = findFunctionUsageIndex(content, 'executePRReviewCommitPushPhase');
  assert.ok(loopIdx !== -1, `Expected "${sharedCtx.filePath}" to contain a scenario retry loop`);
  assert.ok(
    commitPushIdx !== -1,
    `Expected "${sharedCtx.filePath}" to call executePRReviewCommitPushPhase`,
  );
  assert.ok(
    commitPushIdx > loopIdx,
    `Expected executePRReviewCommitPushPhase to appear after the scenario retry loop`,
  );
});

Then('executePRReviewCommitPushPhase is called before completePRReviewWorkflow', function () {
  const content = sharedCtx.fileContent;
  const commitPushIdx = findFunctionUsageIndex(content, 'executePRReviewCommitPushPhase');
  const completionIdx = content.indexOf('completePRReviewWorkflow(');
  assert.ok(
    commitPushIdx !== -1,
    `Expected "${sharedCtx.filePath}" to call executePRReviewCommitPushPhase`,
  );
  assert.ok(
    completionIdx !== -1,
    `Expected "${sharedCtx.filePath}" to call completePRReviewWorkflow`,
  );
  assert.ok(
    commitPushIdx < completionIdx,
    `Expected executePRReviewCommitPushPhase to appear before completePRReviewWorkflow`,
  );
});

Then('the commit+push phase is called via a closure wrapping executePRReviewCommitPushPhase with config', function () {
  const content = sharedCtx.fileContent;
  // Check for the closure-wrapper pattern: _ => executePRReviewCommitPushPhase(config)
  const closurePattern = /executePRReviewCommitPushPhase\s*\(\s*config\s*\)/;
  assert.ok(
    closurePattern.test(content),
    `Expected "${sharedCtx.filePath}" to call executePRReviewCommitPushPhase via closure wrapper`,
  );
});

Then('the closure passes config.base to runPhase as the first argument', function () {
  const content = sharedCtx.fileContent;
  // Pattern: runPhase(config.base, ...
  assert.ok(
    content.includes('runPhase(config.base,'),
    `Expected "${sharedCtx.filePath}" to call runPhase with config.base as the first argument`,
  );
});

// ---------------------------------------------------------------------------
// 7. Import checks for prReviewCompletion.ts
// ---------------------------------------------------------------------------

Then('the file does not import {string} from agents', function (symbol: string) {
  const importFromAgentsPattern = new RegExp(
    `import[^;]*\\b${symbol}\\b[^;]*from\\s*['"](?:\\.\\./)?agents['"]`,
  );
  assert.ok(
    !importFromAgentsPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" NOT to import "${symbol}" from agents`,
  );
});

Then('the file does not import {string} from vcs', function (symbol: string) {
  const importFromVcsPattern = new RegExp(
    `import[^;]*\\b${symbol}\\b[^;]*from\\s*['"](?:\\.\\./)?vcs['"]`,
  );
  assert.ok(
    !importFromVcsPattern.test(sharedCtx.fileContent),
    `Expected "${sharedCtx.filePath}" NOT to import "${symbol}" from vcs`,
  );
});
