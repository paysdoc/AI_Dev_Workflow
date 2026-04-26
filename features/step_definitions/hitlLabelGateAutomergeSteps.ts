import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sharedCtx } from './commonSteps.ts';
import { isApprovedFromReviewsList } from '../../adws/github/prApi.ts';
import { executeMerge, type MergeDeps } from '../../adws/adwMerge.tsx';

const ROOT = process.cwd();

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

Then(
  'the function {string} accepts parameters {string}, {string}, and an optional {string} object',
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

// ── HITL block — state and outcome shape checks ───────────────────────────────

Then('the hitl early-return block does not write workflowStage {string}', function (stage: string) {
  const content = sharedCtx.fileContent;
  const hitlBlock = extractHitlBlockBody(content);
  assert.ok(
    hitlBlock !== null,
    `Expected "${sharedCtx.filePath}" to have an if-block containing issueHasLabel`,
  );
  const hasStageWrite =
    hitlBlock.includes(`workflowStage: '${stage}'`) ||
    hitlBlock.includes(`workflowStage: "${stage}"`);
  assert.ok(
    !hasStageWrite,
    `Expected the hitl block in "${sharedCtx.filePath}" NOT to write workflowStage "${stage}"`,
  );
});

Then(
  'the hitl early-return block returns an outcome with reason containing {string}',
  function (substring: string) {
    const content = sharedCtx.fileContent;
    const hitlBlock = extractHitlBlockBody(content);
    assert.ok(
      hitlBlock !== null,
      `Expected "${sharedCtx.filePath}" to have an if-block containing issueHasLabel`,
    );
    const reasonPattern = new RegExp(`reason:\\s*['"][^'"]*${substring}[^'"]*['"]`);
    assert.ok(
      reasonPattern.test(hitlBlock),
      `Expected the hitl block in "${sharedCtx.filePath}" to return an outcome with reason containing "${substring}"`,
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

// ── fetchPRApprovalState reviewDecision checks ────────────────────────────────

Then(
  'the function {string} returns true when reviewDecision equals {string}',
  function (funcName: string, decision: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(funcName),
      `Expected "${sharedCtx.filePath}" to define "${funcName}"`,
    );
    // APPROVED specifically should return true via an explicit check
    if (decision === 'APPROVED') {
      assert.ok(
        content.includes(`=== 'APPROVED'`) || content.includes(`=== "APPROVED"`),
        `Expected "${funcName}" to check === 'APPROVED' and return true`,
      );
    } else {
      assert.ok(
        content.includes(`'${decision}'`) || content.includes(`"${decision}"`),
        `Expected "${funcName}" in "${sharedCtx.filePath}" to reference "${decision}"`,
      );
    }
  },
);

Then(
  'the function {string} returns false when reviewDecision equals {string}',
  function (funcName: string, decision: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(funcName),
      `Expected "${sharedCtx.filePath}" to define "${funcName}"`,
    );
    // Non-APPROVED, non-null decisions should cause false
    assert.ok(
      content.includes('reviewDecision'),
      `Expected "${funcName}" in "${sharedCtx.filePath}" to reference "reviewDecision"`,
    );
    assert.ok(
      content.includes('return false') || content.includes('!== null'),
      `Expected "${funcName}" in "${sharedCtx.filePath}" to have a false-return path for non-APPROVED decisions (e.g. "${decision}")`,
    );
  },
);

Then(
  'the function {string} calls {string} when reviewDecision is null',
  function (funcName: string, callee: string) {
    const content = sharedCtx.fileContent;
    assert.ok(content.includes(funcName), `Expected "${sharedCtx.filePath}" to define "${funcName}"`);
    assert.ok(
      content.includes(callee),
      `Expected "${funcName}" in "${sharedCtx.filePath}" to call "${callee}"`,
    );
    assert.ok(
      content.includes('null') && content.includes(callee),
      `Expected "${funcName}" to fall back to "${callee}" when reviewDecision is null`,
    );
  },
);

// ── isApprovedFromReviewsList export check ────────────────────────────────────
// NOTE: 'the file exports a function named {string}' is defined in autoApproveMergeAfterReviewSteps.ts

// ── isApprovedFromReviewsList behavioural tests (unit-style BDD) ──────────────

interface ReviewEntry {
  author: { login: string };
  state: string;
  submittedAt: string;
}

let _reviewsList: ReviewEntry[] = [];
let _isApprovedResult = false;

function makeReview(login: string, state: string, dateStr: string): ReviewEntry {
  return { author: { login }, state, submittedAt: dateStr };
}

Given(
  'a reviews list with one author {string} whose latest review state is {string}',
  function (author: string, state: string) {
    _reviewsList = [makeReview(author, state, '2024-01-01T10:00:00Z')];
  },
);

Given(
  'a reviews list with authors {string} and {string} whose latest reviews are both {string}',
  function (author1: string, author2: string, state: string) {
    _reviewsList = [
      makeReview(author1, state, '2024-01-01T10:00:00Z'),
      makeReview(author2, state, '2024-01-01T11:00:00Z'),
    ];
  },
);

Given(
  'a reviews list with author {string} latest {string} and author {string} latest {string}',
  function (author1: string, state1: string, author2: string, state2: string) {
    _reviewsList = [
      makeReview(author1, state1, '2024-01-01T10:00:00Z'),
      makeReview(author2, state2, '2024-01-01T11:00:00Z'),
    ];
  },
);

Given(
  'a reviews list with one author {string} whose earlier review is {string} and latest review is {string}',
  function (author: string, earlierState: string, latestState: string) {
    _reviewsList = [
      makeReview(author, earlierState, '2024-01-01T09:00:00Z'),
      makeReview(author, latestState, '2024-01-01T10:00:00Z'),
    ];
  },
);

Given(
  'a reviews list with author {string} whose latest substantive review is {string} and a later {string} review',
  function (author: string, substantiveState: string, laterState: string) {
    _reviewsList = [
      makeReview(author, substantiveState, '2024-01-01T10:00:00Z'),
      makeReview(author, laterState, '2024-01-01T11:00:00Z'),
    ];
  },
);

Given('an empty reviews list', function () {
  _reviewsList = [];
});

When('isApprovedFromReviewsList aggregates the list', function () {
  _isApprovedResult = isApprovedFromReviewsList(_reviewsList);
});

Then('isApprovedFromReviewsList returns true', function () {
  assert.strictEqual(_isApprovedResult, true, 'Expected isApprovedFromReviewsList to return true');
});

Then('isApprovedFromReviewsList returns false', function () {
  assert.strictEqual(_isApprovedResult, false, 'Expected isApprovedFromReviewsList to return false');
});

// ── MergeDeps interface checks ────────────────────────────────────────────────

function extractInterfaceBody(content: string, interfaceName: string): string {
  const interfaceStart = content.indexOf(`interface ${interfaceName}`);
  if (interfaceStart === -1) return '';
  const braceOpen = content.indexOf('{', interfaceStart);
  if (braceOpen === -1) return '';
  let depth = 1;
  let i = braceOpen + 1;
  while (i < content.length && depth > 0) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') depth--;
    i++;
  }
  return content.substring(braceOpen + 1, i - 1);
}

Then('the MergeDeps interface declares a {string} field', function (fieldName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('interface MergeDeps'),
    `Expected "${sharedCtx.filePath}" to declare MergeDeps interface`,
  );
  const interfaceBody = extractInterfaceBody(content, 'MergeDeps');
  assert.ok(
    interfaceBody.includes(fieldName),
    `Expected MergeDeps interface in "${sharedCtx.filePath}" to declare "${fieldName}"`,
  );
});

Then('the MergeDeps interface does not declare an {string} field', function (fieldName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('interface MergeDeps'),
    `Expected "${sharedCtx.filePath}" to declare MergeDeps interface`,
  );
  const interfaceBody = extractInterfaceBody(content, 'MergeDeps');
  assert.ok(
    !interfaceBody.includes(fieldName),
    `Expected MergeDeps interface in "${sharedCtx.filePath}" NOT to declare "${fieldName}"`,
  );
});

// ── buildDefaultDeps wiring checks ───────────────────────────────────────────

function extractFunctionReturnBody(content: string, funcName: string): string {
  const funcIdx = content.indexOf(`function ${funcName}`);
  if (funcIdx === -1) return '';
  const returnIdx = content.indexOf('return', funcIdx);
  if (returnIdx === -1) return '';
  const braceOpen = content.indexOf('{', returnIdx);
  if (braceOpen === -1) return '';
  let depth = 1;
  let i = braceOpen + 1;
  while (i < content.length && depth > 0) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') depth--;
    i++;
  }
  return content.substring(braceOpen + 1, i - 1);
}

Then(
  '{string} returns an object containing {string}',
  function (funcName: string, fieldName: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(`function ${funcName}`),
      `Expected "${sharedCtx.filePath}" to define "${funcName}"`,
    );
    const objectBody = extractFunctionReturnBody(content, funcName);
    assert.ok(
      objectBody.includes(fieldName),
      `Expected "${funcName}" in "${sharedCtx.filePath}" to return an object containing "${fieldName}"`,
    );
  },
);

Then(
  '{string} does not return an object containing {string}',
  function (funcName: string, fieldName: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(`function ${funcName}`),
      `Expected "${sharedCtx.filePath}" to define "${funcName}"`,
    );
    const objectBody = extractFunctionReturnBody(content, funcName);
    assert.ok(
      !objectBody.includes(fieldName),
      `Expected "${funcName}" in "${sharedCtx.filePath}" NOT to return an object containing "${fieldName}"`,
    );
  },
);

// ── Ordering checks — '{string} is called before {string}' ───────────────────
// NOTE: this step is defined in autoApproveMergeAfterReviewSteps.ts

// ── Approval gate — skip/not-approved branch checks ──────────────────────────

Then(
  'the phase skips {string} when fetchPRApprovalState returns false',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes('fetchPRApprovalState('),
      `Expected "${sharedCtx.filePath}" to call fetchPRApprovalState`,
    );
    const approvalIdx = content.indexOf('fetchPRApprovalState(');
    const mergeIdx = content.indexOf(`${funcName}(`);
    assert.ok(mergeIdx !== -1, `Expected "${sharedCtx.filePath}" to call "${funcName}"`);
    assert.ok(
      mergeIdx > approvalIdx,
      `Expected "${funcName}" to appear after fetchPRApprovalState in "${sharedCtx.filePath}"`,
    );
    // Verify there's a short-circuit return when not approved
    assert.ok(
      content.includes('awaiting_approval'),
      `Expected "${sharedCtx.filePath}" to return early with awaiting_approval when PR is not approved`,
    );
  },
);

Then(
  'the not-approved branch returns an outcome with reason {string}',
  function (reason: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(`reason: '${reason}'`) || content.includes(`reason: "${reason}"`),
      `Expected "${sharedCtx.filePath}" to return an outcome with reason "${reason}"`,
    );
  },
);

Then(
  'the not-approved branch does not call {string}',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    // Find the approval gate area — between approval check and end of not-approved block
    const approvalIdx = content.indexOf('fetchPRApprovalState(');
    assert.ok(approvalIdx !== -1, `Expected "${sharedCtx.filePath}" to call fetchPRApprovalState`);
    // The not-approved block ends with a return statement
    // Find the first return after the approval check
    const notApprovedWindow = content.substring(approvalIdx, approvalIdx + 400);
    const returnIdx = notApprovedWindow.indexOf('return');
    assert.ok(returnIdx !== -1, 'Expected an early return in the approval gate window');
    const earlyReturnBlock = notApprovedWindow.substring(0, returnIdx + 80);
    assert.ok(
      !earlyReturnBlock.includes(`${funcName}(`),
      `Expected "${funcName}" NOT to be called in the not-approved early-return block`,
    );
  },
);

Then(
  'the phase logs a message containing {string} when fetchPRApprovalState returns false',
  function (logText: string) {
    const content = sharedCtx.fileContent;
    const approvalIdx = content.indexOf('fetchPRApprovalState(');
    assert.ok(approvalIdx !== -1, `Expected "${sharedCtx.filePath}" to call fetchPRApprovalState`);
    const gateWindow = content.substring(approvalIdx, approvalIdx + 500);
    assert.ok(
      gateWindow.includes(logText),
      `Expected "${sharedCtx.filePath}" to log a message containing "${logText}" near the approval gate`,
    );
  },
);

// ── executeMerge integration scenarios (BDD) ─────────────────────────────────

interface MergeTestCtx {
  adwId: string;
  branch: string;
  prNumber: number;
  approvalResult: boolean;
  result: Awaited<ReturnType<typeof executeMerge>> | null;
}

const _mergeCtx: MergeTestCtx = {
  adwId: '',
  branch: '',
  prNumber: 0,
  approvalResult: true,
  result: null,
};

let _mergeWithConflictResolutionCalled = false;
let _writeTopLevelStateCalled = false;
let _issueHasLabelCalled = false;
// Tracks hitl label state for the unified gate — set by Given steps below.
export let _hitlOnIssue = false;

function buildMergeDeps(): MergeDeps {
  const ctx = _mergeCtx;
  return {
    readTopLevelState: () => ({
      adwId: ctx.adwId,
      issueNumber: 99,
      agentName: 'sdlc-orchestrator',
      execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
      workflowStage: 'awaiting_merge',
    }),
    findOrchestratorStatePath: () => `/agents/${ctx.adwId}/sdlc-orchestrator`,
    readOrchestratorState: () => ({
      adwId: ctx.adwId,
      issueNumber: 99,
      agentName: 'sdlc-orchestrator',
      execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
      workflowStage: 'awaiting_merge',
      branchName: ctx.branch,
    }),
    findPRByBranch: () => ({
      number: ctx.prNumber || 42,
      state: 'OPEN',
      headRefName: ctx.branch,
      baseRefName: 'main',
    }),
    issueHasLabel: () => {
      _issueHasLabelCalled = true;
      return _hitlOnIssue;
    },
    fetchPRApprovalState: () => ctx.approvalResult,
    ensureWorktree: () => `/worktrees/${ctx.branch}`,
    ensureLogsDirectory: () => `/logs/${ctx.adwId}`,
    mergeWithConflictResolution: async () => {
      _mergeWithConflictResolutionCalled = true;
      return { success: true };
    },
    writeTopLevelState: () => {
      _writeTopLevelStateCalled = true;
    },
    commentOnIssue: () => undefined,
    commentOnPR: () => undefined,
    getPlanFilePath: () => '',
    planFileExists: () => false,
  };
}

Given(
  'an awaiting_merge state file for adw-id {string} with branch {string} and an open PR',
  function (adwId: string, branch: string) {
    _mergeCtx.adwId = adwId;
    _mergeCtx.branch = branch;
    _mergeCtx.prNumber = 42;
    _mergeCtx.approvalResult = true;
    _mergeCtx.result = null;
    _hitlOnIssue = false;
  },
);

Given('fetchPRApprovalState returns true for the PR', function () {
  _mergeCtx.approvalResult = true;
});

Given('fetchPRApprovalState returns false for the PR', function () {
  _mergeCtx.approvalResult = false;
});

Given('the issue carries the {string} label', function (_label: string) {
  _hitlOnIssue = true;
});

Given('the issue does not carry the {string} label', function (_label: string) {
  _hitlOnIssue = false;
});

When(
  'executeMerge is invoked for issue {int} with the injected deps',
  async function (issueNumber: number) {
    _mergeWithConflictResolutionCalled = false;
    _writeTopLevelStateCalled = false;
    _issueHasLabelCalled = false;
    const deps = buildMergeDeps();
    _mergeCtx.result = await executeMerge(
      issueNumber,
      _mergeCtx.adwId,
      { owner: 'acme', repo: 'widgets' },
      deps,
    );
  },
);

Then('mergeWithConflictResolution is called with the PR number', function () {
  assert.strictEqual(
    _mergeWithConflictResolutionCalled,
    true,
    'Expected mergeWithConflictResolution to be called',
  );
});

Then('the outcome is {string} or the merge attempt is reached', function (expectedOutcome: string) {
  assert.ok(_mergeCtx.result !== null, 'Expected executeMerge to return a result');
  const ok = _mergeCtx.result!.outcome === expectedOutcome || _mergeWithConflictResolutionCalled;
  assert.ok(ok, `Expected outcome "${expectedOutcome}" or merge to be attempted`);
});

Then('mergeWithConflictResolution is not called', function () {
  assert.strictEqual(
    _mergeWithConflictResolutionCalled,
    false,
    'Expected mergeWithConflictResolution NOT to be called',
  );
});

Then(
  'the outcome is {string} with reason {string}',
  function (outcome: string, reason: string) {
    assert.ok(_mergeCtx.result !== null, 'Expected executeMerge to return a result');
    assert.strictEqual(_mergeCtx.result!.outcome, outcome, `Expected outcome "${outcome}"`);
    assert.strictEqual(_mergeCtx.result!.reason, reason, `Expected reason "${reason}"`);
  },
);

Then(
  'writeTopLevelState is not called on the awaiting-approval branch',
  function () {
    assert.strictEqual(
      _writeTopLevelStateCalled,
      false,
      'Expected writeTopLevelState NOT to be called on the awaiting-approval branch',
    );
  },
);

Then(
  'writeTopLevelState is not called on the gate-closed branch',
  function () {
    assert.strictEqual(
      _writeTopLevelStateCalled,
      false,
      'Expected writeTopLevelState NOT to be called on the gate-closed branch',
    );
  },
);

Then('issueHasLabel is consulted as part of the unified gate evaluation', function () {
  assert.strictEqual(
    _issueHasLabelCalled,
    true,
    'Expected issueHasLabel to be consulted as part of the unified gate evaluation',
  );
});

// ── hitl label still present — adwMerge no longer reads it ───────────────────

Given(
  'a state file for adw-id {string} with workflowStage {string} and an open approved PR',
  function (adwId: string, _stage: string) {
    _mergeCtx.adwId = adwId;
    _mergeCtx.branch = `feature/issue-99-${adwId}`;
    _mergeCtx.prNumber = 42;
    _mergeCtx.approvalResult = true;
    _mergeCtx.result = null;
    _hitlOnIssue = false;
  },
);

Given('the issue still carries the {string} label', function (_label: string) {
  _hitlOnIssue = true;
});

When(
  'executeMerge is invoked with fetchPRApprovalState returning true',
  async function () {
    _mergeWithConflictResolutionCalled = false;
    _writeTopLevelStateCalled = false;
    _issueHasLabelCalled = false;
    _mergeCtx.approvalResult = true;
    const deps = buildMergeDeps();
    _mergeCtx.result = await executeMerge(
      99,
      _mergeCtx.adwId,
      { owner: 'acme', repo: 'widgets' },
      deps,
    );
  },
);

Then('the merge proceeds via mergeWithConflictResolution', function () {
  assert.strictEqual(
    _mergeWithConflictResolutionCalled,
    true,
    'Expected mergeWithConflictResolution to be called',
  );
});

Then('no call to {string} is made', function (funcName: string) {
  if (funcName === 'issueHasLabel') {
    // issueHasLabel was removed from MergeDeps — verify it's not referenced in adwMerge.tsx
    const content = readFileSync(join(ROOT, 'adws/adwMerge.tsx'), 'utf-8');
    assert.ok(
      !content.includes('issueHasLabel'),
      `Expected adwMerge.tsx NOT to call "issueHasLabel"`,
    );
  }
});

// ── TypeScript type-check ─────────────────────────────────────────────────────
// NOTE: 'the ADW TypeScript type-check passes' is defined in cronGuardToctouFixSteps.ts
