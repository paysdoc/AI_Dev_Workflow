import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx, findFunctionUsageIndex } from './commonSteps.ts';

// Note: 'Then the WorkflowStage union type includes {string}' is defined in detectCompactionRestartBuildAgentSteps.ts

// ── Import checks ─────────────────────────────────────────────────────────────

Then('the file does not import {string}', function (importName: string) {
  const content = sharedCtx.fileContent;
  const importLines = content.split('\n').filter(line => line.trim().startsWith('import'));
  const hasImport = importLines.some(line => line.includes(importName));
  assert.ok(
    !hasImport,
    `Expected "${sharedCtx.filePath}" not to import "${importName}"`,
  );
});

// ── awaiting_merge state write check ─────────────────────────────────────────

Then(
  'the orchestrator writes {string} to the top-level state file after {string}',
  function (stage: string, afterFunc: string) {
    const content = sharedCtx.fileContent;
    const afterIdx = findFunctionUsageIndex(content, afterFunc);
    assert.ok(afterIdx !== -1, `Expected "${afterFunc}" to be called in "${sharedCtx.filePath}"`);
    const stageIdx = content.indexOf(`'${stage}'`);
    assert.ok(
      stageIdx !== -1,
      `Expected "${sharedCtx.filePath}" to reference the stage '${stage}'`,
    );
    assert.ok(
      stageIdx > afterIdx,
      `Expected '${stage}' to appear after "${afterFunc}" in "${sharedCtx.filePath}"`,
    );
  },
);

// ── Regression path ordering check ───────────────────────────────────────────

Then(
  'in the regression_possible path {string} is called before {string}',
  function (earlierFunc: string, laterFunc: string) {
    const content = sharedCtx.fileContent;
    const elseIdx = content.indexOf('} else {');
    assert.ok(
      elseIdx !== -1,
      `Expected "${sharedCtx.filePath}" to contain an else block for the regression_possible path`,
    );
    const elseBlock = content.substring(elseIdx);
    const earlierIdx = findFunctionUsageIndex(elseBlock, earlierFunc);
    const laterIdx = findFunctionUsageIndex(elseBlock, laterFunc);
    assert.ok(
      earlierIdx !== -1,
      `Expected "${earlierFunc}" to be called in the regression_possible path of "${sharedCtx.filePath}"`,
    );
    assert.ok(
      laterIdx !== -1,
      `Expected "${laterFunc}" to be called in the regression_possible path of "${sharedCtx.filePath}"`,
    );
    assert.ok(
      earlierIdx < laterIdx,
      `Expected "${earlierFunc}" to be called before "${laterFunc}" in the regression_possible path of "${sharedCtx.filePath}"`,
    );
  },
);

// ── No worktree-dependent phase after PR check ────────────────────────────────

Then('no phase that requires the worktree is called after {string}', function (afterFunc: string) {
  const content = sharedCtx.fileContent;
  // Find the LAST occurrence of the given function so we check everything after it
  const afterIdx = content.lastIndexOf(afterFunc);
  assert.ok(afterIdx !== -1, `Expected "${afterFunc}" to be called in "${sharedCtx.filePath}"`);
  const afterContent = content.substring(afterIdx);
  const worktreePhases = [
    'executeBuildPhase',
    'executeTestPhase',
    'executeDocumentPhase',
    'executeKpiPhase',
    'executeDiffEvaluationPhase',
    'executeAutoMergePhase',
  ];
  for (const phase of worktreePhases) {
    assert.ok(
      !afterContent.includes(`${phase}(`),
      `Expected "${phase}" not to be called after "${afterFunc}" in "${sharedCtx.filePath}"`,
    );
  }
});
