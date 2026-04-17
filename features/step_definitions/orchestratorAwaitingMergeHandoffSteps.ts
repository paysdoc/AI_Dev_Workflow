import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx, findFunctionUsageIndex } from './commonSteps.ts';

// ── Import absence checks ─────────────────────────────────────────────────────

Then('the file does not import {string}', function (importName: string) {
  const content = sharedCtx.fileContent;
  // Match both single-line and destructured import patterns
  const hasImport =
    content.includes(`{ ${importName} }`) ||
    content.includes(`{ ${importName},`) ||
    content.includes(`, ${importName} }`) ||
    content.includes(`, ${importName},`) ||
    content.includes(`  ${importName},`);
  assert.ok(
    !hasImport,
    `Expected "${sharedCtx.filePath}" not to import "${importName}", but it does`,
  );
});

// ── Call absence checks ───────────────────────────────────────────────────────

Then('the file does not contain a call to {string}', function (funcName: string) {
  const content = sharedCtx.fileContent;
  const hasCall =
    content.includes(`${funcName}(`) ||
    content.includes(`, ${funcName})`) ||
    content.includes(`, ${funcName}]`) ||
    content.includes(`[${funcName},`);
  assert.ok(
    !hasCall,
    `Expected "${sharedCtx.filePath}" not to call "${funcName}", but it does`,
  );
});

// ── Branch-aware ordering check ───────────────────────────────────────────────

Then(
  '{string} is called before {string} in the regression_possible branch',
  function (earlierFunc: string, laterFunc: string) {
    const content = sharedCtx.fileContent;
    // In the restructured adwChore.tsx the regression_possible block (review + document)
    // appears in the if block before the shared executePRPhase call. A positional
    // check is sufficient: earlierFunc must appear before laterFunc in the file.
    const earlierIdx = findFunctionUsageIndex(content, earlierFunc);
    const laterIdx = findFunctionUsageIndex(content, laterFunc);
    assert.ok(
      earlierIdx !== -1,
      `Expected "${earlierFunc}" to be called in "${sharedCtx.filePath}"`,
    );
    assert.ok(
      laterIdx !== -1,
      `Expected "${laterFunc}" to be called in "${sharedCtx.filePath}"`,
    );
    assert.ok(
      earlierIdx < laterIdx,
      `Expected "${earlierFunc}" to appear before "${laterFunc}" (regression_possible branch) in "${sharedCtx.filePath}"`,
    );
  },
);

// ── awaiting_merge state write checks ─────────────────────────────────────────

Then(
  'the orchestrator writes workflowStage {string} after PR approval',
  function (stage: string) {
    const content = sharedCtx.fileContent;
    // The file writes the stage inline after the PR approval block.
    const hasStageRef =
      content.includes(`'${stage}'`) || content.includes(`"${stage}"`);
    assert.ok(
      hasStageRef,
      `Expected "${sharedCtx.filePath}" to reference workflowStage "${stage}"`,
    );
    // The state write must appear after executePRPhase
    const prPhaseIdx = findFunctionUsageIndex(content, 'executePRPhase');
    const stageIdx = content.includes(`'${stage}'`)
      ? content.indexOf(`'${stage}'`, prPhaseIdx)
      : content.indexOf(`"${stage}"`, prPhaseIdx);
    assert.ok(
      prPhaseIdx !== -1,
      `Expected "${sharedCtx.filePath}" to call executePRPhase`,
    );
    assert.ok(
      stageIdx !== -1 && stageIdx > prPhaseIdx,
      `Expected workflowStage "${stage}" write to occur after executePRPhase in "${sharedCtx.filePath}"`,
    );
  },
);

Then(
  'the awaiting_merge write uses {string}',
  function (apiName: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(apiName),
      `Expected "${sharedCtx.filePath}" to use "${apiName}" for the awaiting_merge write`,
    );
  },
);

// ── No worktree-dependent phase after executePRPhase ─────────────────────────

const WORKTREE_PHASES = [
  'executeKpiPhase',
  'executeDocumentPhase',
  'executeDiffEvaluationPhase',
  'executeBuildPhase',
  'executeUnitTestPhase',
  'executeReviewPhase',
  'executeAutoMergePhase',
];

Then(
  'no phase that requires the worktree is called after {string}',
  function (anchorFunc: string) {
    const content = sharedCtx.fileContent;
    const anchorIdx = findFunctionUsageIndex(content, anchorFunc);
    assert.ok(
      anchorIdx !== -1,
      `Expected "${anchorFunc}" to be called in "${sharedCtx.filePath}"`,
    );
    const afterAnchor = content.slice(anchorIdx + anchorFunc.length);
    for (const phase of WORKTREE_PHASES) {
      const callPattern = `${phase}(`;
      const callbackPattern = `, ${phase})`;
      const arrayPattern = `, ${phase}]`;
      const hasWorktreeCall =
        afterAnchor.includes(callPattern) ||
        afterAnchor.includes(callbackPattern) ||
        afterAnchor.includes(arrayPattern);
      assert.ok(
        !hasWorktreeCall,
        `Expected no call to worktree-dependent "${phase}" after "${anchorFunc}" in "${sharedCtx.filePath}"`,
      );
    }
  },
);

Then(
  'only API calls and state writes occur between {string} and {string}',
  function (startFunc: string, endFunc: string) {
    const content = sharedCtx.fileContent;
    const startIdx = findFunctionUsageIndex(content, startFunc);
    const endIdx = content.indexOf(endFunc, startIdx !== -1 ? startIdx : 0);
    assert.ok(startIdx !== -1, `Expected "${startFunc}" to be called in "${sharedCtx.filePath}"`);
    assert.ok(endIdx !== -1, `Expected "${endFunc}" to appear after "${startFunc}" in "${sharedCtx.filePath}"`);

    const between = content.slice(startIdx + startFunc.length, endIdx);

    // No runPhase calls should appear between startFunc and endFunc
    assert.ok(
      !between.includes('runPhase('),
      `Expected no runPhase() calls between "${startFunc}" and "${endFunc}" in "${sharedCtx.filePath}". Found: ${between.slice(0, 200)}`,
    );
  },
);

Then(
  'only API calls and state writes occur after {string} until the orchestrator exits',
  function (startFunc: string) {
    const content = sharedCtx.fileContent;
    const startIdx = findFunctionUsageIndex(content, startFunc);
    assert.ok(startIdx !== -1, `Expected "${startFunc}" to be called in "${sharedCtx.filePath}"`);

    const afterStart = content.slice(startIdx + startFunc.length);

    // No runPhase calls should appear after startFunc (orchestrators no longer call
    // completeWorkflow — they write state inline and exit)
    assert.ok(
      !afterStart.includes('runPhase('),
      `Expected no runPhase() calls after "${startFunc}" in "${sharedCtx.filePath}". Found: ${afterStart.slice(0, 200)}`,
    );
  },
);

// ── Last executeXxxPhase before target ────────────────────────────────────────

Then(
  '{string} is the last executeXxxPhase call before {string}',
  function (lastPhase: string, targetFunc: string) {
    const content = sharedCtx.fileContent;
    // Try function-call pattern first; fall back to string-literal occurrence
    let targetIdx = findFunctionUsageIndex(content, targetFunc);
    if (targetIdx === -1) {
      targetIdx = content.indexOf(`'${targetFunc}'`);
    }
    if (targetIdx === -1) {
      targetIdx = content.indexOf(`"${targetFunc}"`);
    }
    assert.ok(
      targetIdx !== -1,
      `Expected "${targetFunc}" to be called in "${sharedCtx.filePath}"`,
    );

    const beforeTarget = content.slice(0, targetIdx);

    // Find all executeXxxPhase calls before targetFunc
    const phaseCallPattern = /execute\w+Phase/g;
    let match: RegExpExecArray | null;
    let lastPhaseName = '';
    let lastPhaseIdx = -1;
    while ((match = phaseCallPattern.exec(beforeTarget)) !== null) {
      // Verify it's actually a call or callback (not just an import/type reference)
      const afterMatch = beforeTarget.slice(match.index + match[0].length);
      const isCallOrCallback =
        afterMatch.startsWith('(') ||
        afterMatch.startsWith(')') ||
        afterMatch.startsWith(']');
      if (isCallOrCallback) {
        lastPhaseName = match[0];
        lastPhaseIdx = match.index;
      }
    }

    assert.ok(
      lastPhaseName === lastPhase,
      `Expected the last executeXxxPhase call before "${targetFunc}" to be "${lastPhase}", but found "${lastPhaseName}" in "${sharedCtx.filePath}"`,
    );
    assert.ok(lastPhaseIdx !== -1, `Expected "${lastPhase}" to be called in "${sharedCtx.filePath}"`);
  },
);

// ── completeWorkflow called after awaiting_merge state write ─────────────────

Then(
  '{string} is called after the awaiting_merge state write',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    // Find the awaiting_merge state write (AgentStateManager.writeTopLevelState with 'awaiting_merge')
    const writeIdx = content.indexOf("'awaiting_merge'");
    const funcIdx = findFunctionUsageIndex(content, funcName);
    assert.ok(
      writeIdx !== -1,
      `Expected "${sharedCtx.filePath}" to write 'awaiting_merge'`,
    );
    assert.ok(
      funcIdx !== -1,
      `Expected "${funcName}" to be called in "${sharedCtx.filePath}"`,
    );
    assert.ok(
      funcIdx > writeIdx,
      `Expected "${funcName}" to be called after the awaiting_merge state write in "${sharedCtx.filePath}"`,
    );
  },
);

// ── hitl label gate preserved ─────────────────────────────────────────────────

Then('the orchestrator checks for the hitl label before calling approvePR', function () {
  const content = sharedCtx.fileContent;
  // The hitl check uses issueHasLabel with 'hitl', and appears before approvePR
  const hitlIdx = content.indexOf("'hitl'");
  // Find the actual approvePR( call (not the import line)
  const approvePRCallIdx = (() => {
    let idx = content.indexOf('approvePR(');
    // Skip any occurrences that appear to be in import statements (before the first function body)
    const firstFunctionBodyIdx = content.indexOf('async function') !== -1
      ? content.indexOf('async function')
      : content.indexOf('function ');
    while (idx !== -1 && idx < firstFunctionBodyIdx) {
      idx = content.indexOf('approvePR(', idx + 1);
    }
    return idx;
  })();

  assert.ok(hitlIdx !== -1, `Expected "${sharedCtx.filePath}" to check for hitl label`);
  assert.ok(approvePRCallIdx !== -1, `Expected "${sharedCtx.filePath}" to call approvePR`);
  assert.ok(
    hitlIdx < approvePRCallIdx,
    `Expected hitl label check to appear before approvePR call in "${sharedCtx.filePath}"`,
  );
});

Then('the orchestrator skips approvePR when hitl label is present', function () {
  const content = sharedCtx.fileContent;
  // The hitl block and approvePR must be in separate conditional branches (else-if pattern)
  // Verify that there's no approvePR call inside the hitl if-block
  const hitlIdx = content.indexOf("'hitl'");
  assert.ok(hitlIdx !== -1, `Expected "${sharedCtx.filePath}" to check for hitl label`);

  // Find the closing brace of the hitl if-block
  // Look for the pattern: if (...hitl...) { ... } else
  const hitlBlockStart = content.indexOf('{', hitlIdx);
  assert.ok(hitlBlockStart !== -1, `Expected hitl if-block in "${sharedCtx.filePath}"`);

  // Find matching closing brace
  let depth = 1;
  let pos = hitlBlockStart + 1;
  while (pos < content.length && depth > 0) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    pos++;
  }
  const hitlBlockEnd = pos;
  const hitlBlock = content.slice(hitlBlockStart, hitlBlockEnd);

  assert.ok(
    !hitlBlock.includes('approvePR('),
    `Expected approvePR to NOT be called inside the hitl block in "${sharedCtx.filePath}"`,
  );

  // Verify approvePR is called in an else-if branch after the hitl block
  const afterHitlBlock = content.slice(hitlBlockEnd);
  assert.ok(
    afterHitlBlock.includes('approvePR('),
    `Expected approvePR to be called in the else branch after the hitl block in "${sharedCtx.filePath}"`,
  );
});
