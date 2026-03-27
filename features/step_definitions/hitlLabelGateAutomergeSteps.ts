import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

/**
 * Extracts the body of the if-block that contains the `issueHasLabel(` call.
 * Uses brace-counting to find the matching closing brace.
 * Returns the text between { and } (exclusive), or null if not found.
 */
function extractHitlBlockBody(content: string): string | null {
  const hitlCallIdx = content.indexOf('issueHasLabel(');
  if (hitlCallIdx === -1) return null;

  // Search backwards from the call site for the nearest `if (`
  const before = content.substring(Math.max(0, hitlCallIdx - 200), hitlCallIdx);
  const relIfIdx = before.lastIndexOf('if (');
  if (relIfIdx === -1) return null;

  const ifIdx = Math.max(0, hitlCallIdx - 200) + relIfIdx;
  const braceOpen = content.indexOf('{', ifIdx);
  if (braceOpen === -1) return null;

  let depth = 1;
  let i = braceOpen + 1;
  while (i < content.length && depth > 0) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') depth--;
    i++;
  }

  return content.substring(braceOpen + 1, i - 1);
}

// ── Parameter signature check ─────────────────────────────────────────────────

Then(
  'the function {string} accepts parameters {string}, {string}, and {string}',
  function (funcName: string, param1: string, param2: string, param3: string) {
    const content = sharedCtx.fileContent;
    const funcIdx = content.indexOf(`function ${funcName}`);
    assert.ok(
      funcIdx !== -1,
      `Expected function "${funcName}" to be defined in "${sharedCtx.filePath}"`,
    );
    // Read enough of the function signature to cover all parameters
    const sigWindow = content.substring(funcIdx, funcIdx + 400);
    assert.ok(sigWindow.includes(param1), `Expected "${funcName}" to have parameter "${param1}"`);
    assert.ok(sigWindow.includes(param2), `Expected "${funcName}" to have parameter "${param2}"`);
    assert.ok(sigWindow.includes(param3), `Expected "${funcName}" to have parameter "${param3}"`);
  },
);

// ── gh CLI call check ─────────────────────────────────────────────────────────

Then(
  'the function {string} calls {string} with {string}',
  function (funcName: string, callStr: string, withStr: string) {
    const content = sharedCtx.fileContent;
    assert.ok(content.includes(funcName), `Expected "${sharedCtx.filePath}" to define "${funcName}"`);
    assert.ok(
      content.includes(callStr),
      `Expected "${funcName}" in "${sharedCtx.filePath}" to call "${callStr}"`,
    );
    assert.ok(
      content.includes(withStr),
      `Expected "${funcName}" in "${sharedCtx.filePath}" to use "${withStr}"`,
    );
  },
);

// ── Import check (single-arg, no module path required) ───────────────────────

Then('the file imports {string}', function (importName: string) {
  const content = sharedCtx.fileContent;
  const hasImport =
    content.includes(`import ${importName}`) ||
    content.includes(`{ ${importName}`) ||
    content.includes(`${importName},`) ||
    content.includes(`, ${importName} }`) ||
    content.includes(`, ${importName},`);
  assert.ok(hasImport, `Expected "${sharedCtx.filePath}" to import "${importName}"`);
});

// ── HITL block — skip checks ──────────────────────────────────────────────────

Then('the phase skips {string} when the hitl label is detected', function (funcName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('issueHasLabel('),
    `Expected "${sharedCtx.filePath}" to call issueHasLabel`,
  );
  const hitlBlock = extractHitlBlockBody(content);
  assert.ok(
    hitlBlock !== null,
    `Expected "${sharedCtx.filePath}" to have an if-block containing issueHasLabel`,
  );
  assert.ok(
    hitlBlock.includes('return'),
    `Expected the hitl if-block in "${sharedCtx.filePath}" to contain an early return`,
  );
  assert.ok(
    !hitlBlock.includes(`${funcName}(`),
    `Expected "${funcName}" NOT to be called inside the hitl if-block in "${sharedCtx.filePath}"`,
  );
});

// ── HITL block — call checks ──────────────────────────────────────────────────

Then('the phase calls {string} when the hitl label is detected', function (funcName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('issueHasLabel('),
    `Expected "${sharedCtx.filePath}" to call issueHasLabel`,
  );
  const hitlBlock = extractHitlBlockBody(content);
  assert.ok(
    hitlBlock !== null,
    `Expected "${sharedCtx.filePath}" to have an if-block containing issueHasLabel`,
  );
  assert.ok(
    hitlBlock.includes(`${funcName}(`),
    `Expected "${funcName}" to be called inside the hitl if-block in "${sharedCtx.filePath}"`,
  );
});

// ── Comment content check ─────────────────────────────────────────────────────

Then('the comment contains {string}', function (text: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(text),
    `Expected "${sharedCtx.filePath}" to contain comment text "${text}"`,
  );
});

// ── HITL skip path return shape ───────────────────────────────────────────────

Then(
  'the hitl skip path returns a result with costUsd 0 and empty phaseCostRecords',
  function () {
    const content = sharedCtx.fileContent;
    const hitlBlock = extractHitlBlockBody(content);
    assert.ok(
      hitlBlock !== null,
      `Expected "${sharedCtx.filePath}" to have an if-block containing issueHasLabel`,
    );
    assert.ok(
      hitlBlock.includes('costUsd: 0'),
      `Expected the hitl block in "${sharedCtx.filePath}" to return costUsd: 0`,
    );
    assert.ok(
      hitlBlock.includes('phaseCostRecords: []'),
      `Expected the hitl block in "${sharedCtx.filePath}" to return phaseCostRecords: []`,
    );
  },
);

// ── HITL log check ────────────────────────────────────────────────────────────

Then(
  'the phase logs a message containing {string} when the label is detected',
  function (logText: string) {
    const content = sharedCtx.fileContent;
    const hitlBlock = extractHitlBlockBody(content);
    assert.ok(
      hitlBlock !== null,
      `Expected "${sharedCtx.filePath}" to have an if-block containing issueHasLabel`,
    );
    assert.ok(
      hitlBlock.includes(logText),
      `Expected the hitl block in "${sharedCtx.filePath}" to log a message containing "${logText}"`,
    );
  },
);

// ── Webhook / unchanged-file checks ──────────────────────────────────────────

Then(
  'the file does not reference {string} or {string}',
  function (str1: string, str2: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      !content.includes(str1),
      `Expected "${sharedCtx.filePath}" NOT to reference "${str1}"`,
    );
    assert.ok(
      !content.includes(str2),
      `Expected "${sharedCtx.filePath}" NOT to reference "${str2}"`,
    );
  },
);

Then(
  'the approved-review branch does not check for a {string} label',
  function (labelName: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      !content.includes(labelName),
      `Expected "${sharedCtx.filePath}" NOT to reference "${labelName}" in the approved-review branch`,
    );
  },
);

// ── UBIQUITOUS_LANGUAGE check ─────────────────────────────────────────────────

Then('the file contains a definition for {string}', function (term: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(term),
    `Expected "${sharedCtx.filePath}" to contain a definition for "${term}"`,
  );
});
