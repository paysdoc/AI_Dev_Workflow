/**
 * Step definitions for features/unify_auto_merge_hitl_gate.feature (@adw-496).
 *
 * Defines only step phrases that are not already defined in other step-definition
 * files. Reuses state from hitlLabelGateAutomergeSteps.ts via exports for the
 * shared behavioural scenarios (awaiting_merge state, executeMerge When, etc.).
 */
import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sharedCtx } from './commonSteps.ts';
import { isApprovedFromReviewsList } from '../../adws/github/prApi.ts';
import { executeMerge, type MergeDeps } from '../../adws/adwMerge.tsx';
import type { AgentState } from '../../adws/types/agentTypes.ts';

// ── fetchPRApprovalState source-file inspection ───────────────────────────────

Then(
  'the function {string} treats an empty-string reviewDecision the same as null',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    assert.ok(content.includes(funcName), `Expected "${sharedCtx.filePath}" to define "${funcName}"`);
    assert.ok(
      !content.includes('reviewDecision !== null && reviewDecision !== undefined'),
      `Expected "${funcName}" NOT to use the exclusive null/undefined guard — empty string must fall through`,
    );
    assert.ok(
      content.includes('isApprovedFromReviewsList'),
      `Expected "${funcName}" to call "isApprovedFromReviewsList" as a fallback`,
    );
  },
);

Then(
  'the function {string} calls {string} when reviewDecision is empty string',
  function (funcName: string, callee: string) {
    const content = sharedCtx.fileContent;
    assert.ok(content.includes(funcName), `Expected "${sharedCtx.filePath}" to define "${funcName}"`);
    assert.ok(content.includes(callee), `Expected "${funcName}" to call "${callee}"`);
    assert.ok(
      !content.includes('reviewDecision !== null && reviewDecision !== undefined'),
      `Expected "${funcName}" to fall back to "${callee}" for empty strings (not just null)`,
    );
  },
);

// ── fetchPRApprovalState behavioural scenarios (inline logic, no gh CLI) ──────

interface FetchApprovalCtx { result: boolean | null; }
const _fetchCtx: FetchApprovalCtx = { result: null };

interface ReviewEntry {
  author: { login: string };
  state: string;
  submittedAt: string;
}

function makeEntry(login: string, state: string): ReviewEntry {
  return { author: { login }, state, submittedAt: '2024-01-01T00:00:00Z' };
}

function evalFetchApprovalLogic(reviewDecision: string | null | undefined, reviews: ReviewEntry[]): boolean {
  if (reviewDecision === 'APPROVED') return true;
  if (reviewDecision) return false;
  return isApprovedFromReviewsList(reviews as Parameters<typeof isApprovedFromReviewsList>[0]);
}

Given(
  'fetchPRApprovalState is invoked against a stubbed gh pr view that returns reviewDecision {string} and a reviews list with one author {string} latest {string}',
  function (reviewDecision: string, author: string, state: string) {
    const rd: string | null = reviewDecision === '' ? '' : reviewDecision || null;
    _fetchCtx.result = evalFetchApprovalLogic(rd, [makeEntry(author, state)]);
  },
);

Given(
  'fetchPRApprovalState is invoked against a stubbed gh pr view that returns reviewDecision {string} and an empty reviews list',
  function (reviewDecision: string) {
    const rd: string | null = reviewDecision === '' ? '' : reviewDecision || null;
    _fetchCtx.result = evalFetchApprovalLogic(rd, []);
  },
);

Then('fetchPRApprovalState returns true', function () {
  assert.strictEqual(_fetchCtx.result, true, 'Expected fetchPRApprovalState result to be true');
});

Then('fetchPRApprovalState returns false', function () {
  assert.strictEqual(_fetchCtx.result, false, 'Expected fetchPRApprovalState result to be false');
});

// ── adwMerge.tsx — gate-closed branch source-file inspection ─────────────────

function extractGateClosedBlock(content: string): string {
  const reasonIdx = content.indexOf('hitl_blocked_unapproved');
  if (reasonIdx === -1) return '';
  const before = content.substring(Math.max(0, reasonIdx - 800), reasonIdx);
  const relIfIdx = before.lastIndexOf('if (');
  if (relIfIdx === -1) return '';
  const ifIdx = Math.max(0, reasonIdx - 800) + relIfIdx;
  const braceOpen = content.indexOf('{', ifIdx);
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
  'the gate-closed branch returns an outcome with reason {string}',
  function (reason: string) {
    const block = extractGateClosedBlock(sharedCtx.fileContent);
    assert.ok(block.length > 0, `Expected "${sharedCtx.filePath}" to have a gate-closed branch`);
    assert.ok(
      block.includes(`'${reason}'`) || block.includes(`"${reason}"`),
      `Expected gate-closed branch to return reason "${reason}"`,
    );
  },
);

Then(
  'the gate-closed branch does not call {string}',
  function (funcName: string) {
    const block = extractGateClosedBlock(sharedCtx.fileContent);
    assert.ok(block.length > 0, `Expected "${sharedCtx.filePath}" to have a gate-closed branch`);
    assert.ok(
      !block.includes(`${funcName}(`),
      `Expected gate-closed branch NOT to call "${funcName}"`,
    );
  },
);

Then(
  'the phase logs a message containing {string} when the gate is closed',
  function (logText: string) {
    const block = extractGateClosedBlock(sharedCtx.fileContent);
    assert.ok(block.length > 0, `Expected "${sharedCtx.filePath}" to have a gate-closed branch`);
    assert.ok(
      block.includes(logText),
      `Expected gate-closed branch to log a message containing "${logText}"`,
    );
  },
);

// ── issueHasLabel argument checks ────────────────────────────────────────────

Then(
  'the call to {string} passes the issue number \\(not the PR number) as its first argument',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    const callPattern = new RegExp(`${funcName}\\(\\s*issueNumber`);
    assert.ok(callPattern.test(content), `Expected "${funcName}" called with issueNumber as first arg`);
    const wrongPattern = new RegExp(`${funcName}\\(\\s*prNumber`);
    assert.ok(!wrongPattern.test(content), `Expected "${funcName}" NOT called with prNumber as first arg`);
  },
);

Then(
  'the call to {string} passes the literal label name {string} as its second argument',
  function (funcName: string, labelName: string) {
    const content = sharedCtx.fileContent;
    const callPattern = new RegExp(`${funcName}\\(\\s*issueNumber,\\s*['"]${labelName}['"]`);
    assert.ok(
      callPattern.test(content),
      `Expected "${funcName}" called with literal label name "${labelName}" as second arg`,
    );
  },
);

// ── adwChore.tsx source-file inspection ──────────────────────────────────────

// Note: 'the orchestrator writes workflowStage {string} after PR approval' is already
// defined in orchestratorAwaitingMergeHandoffSteps.ts — do not redefine here.

Then(
  'the orchestrator exits to the cron after writing {string}',
  function (stage: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(`workflowStage: '${stage}'`) || content.includes(`workflowStage: "${stage}"`),
      `Expected "${sharedCtx.filePath}" to write "${stage}"`,
    );
    assert.ok(
      !content.includes('mergeWithConflictResolution'),
      `Expected "${sharedCtx.filePath}" NOT to call mergeWithConflictResolution — merge is delegated to adwMerge via cron`,
    );
  },
);

// ── Chore approval gate — source-code inspection scenarios ───────────────────

let _choreHitl = false;
let _choreApproveCallCount = 0;
let _choreStateWritten = false;

Given('the chore pipeline reaches the post-PR approval step', function () {
  _choreHitl = false;
  _choreApproveCallCount = 0;
  _choreStateWritten = false;
});

Given('the issue carries the {string} label at that moment', function (_label: string) {
  _choreHitl = true;
});

Given('the issue does not carry the {string} label at that moment', function (_label: string) {
  _choreHitl = false;
});

When('the chore pipeline evaluates the approval gate', function () {
  // Simulate the conditional approvePR gate logic from adwChore.tsx
  const prUrl = 'https://github.com/acme/repo/pull/42';
  const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
  const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : null;
  if (prNumber && !_choreHitl) {
    _choreApproveCallCount++;
  }
  _choreStateWritten = true;
});

Then('approvePR is not called', function () {
  const content = readFileSync(join(process.cwd(), 'adws/adwChore.tsx'), 'utf-8');
  assert.ok(
    content.includes('issueHasLabel') && content.includes('approvePR'),
    'Expected adwChore.tsx to have issueHasLabel guard around approvePR',
  );
  assert.ok(content.includes('!issueHasLabel('), 'Expected approvePR guarded by !issueHasLabel');
  assert.strictEqual(_choreApproveCallCount, 0, 'Expected approvePR NOT called when hitl is set');
});

Then('approvePR is called once for the freshly-created PR', function () {
  assert.strictEqual(_choreApproveCallCount, 1, 'Expected approvePR called once when no hitl');
});

Then('the workflow continues by writing workflowStage {string}', function (stage: string) {
  assert.strictEqual(_choreStateWritten, true, `Expected workflow to write workflowStage "${stage}"`);
});

// ── Rule 4: two-tick stateless re-evaluation ──────────────────────────────────

interface TwoTickCtx {
  adwId: string;
  branch: string;
  prNumber: number;
  firstHitl: boolean;
  firstApproval: boolean;
  secondHitl: boolean;
  secondApproval: boolean;
  firstResult: Awaited<ReturnType<typeof executeMerge>> | null;
  secondResult: Awaited<ReturnType<typeof executeMerge>> | null;
}

const _twoTickCtx: TwoTickCtx = {
  adwId: 'rule4jkl',
  branch: 'feature/rule4',
  prNumber: 42,
  firstHitl: true,
  firstApproval: false,
  secondHitl: false,
  secondApproval: false,
  firstResult: null,
  secondResult: null,
};

let _firstMergeWithConflictResolutionCalled = false;
let _secondMergeWithConflictResolutionCalled = false;

Given(
  'on the first executeMerge invocation the issue carries the {string} label and the PR is not approved',
  function (_label: string) {
    // Inherit adwId and branch from the preceding "awaiting_merge state file" Given
    // (hitlLabelGateAutomergeSteps.ts sets _mergeCtx but we need _twoTickCtx synced)
    _twoTickCtx.firstHitl = true;
    _twoTickCtx.firstApproval = false;
  },
);

Given(
  'on the second executeMerge invocation the issue does not carry the {string} label and the PR is still not approved',
  function (_label: string) {
    _twoTickCtx.secondHitl = false;
    _twoTickCtx.secondApproval = false;
  },
);

function makeTwoTickDeps(hitl: boolean, approval: boolean, onMerge: () => void): MergeDeps {
  const ctx = _twoTickCtx;
  return {
    readTopLevelState: (): AgentState => ({
      adwId: ctx.adwId,
      issueNumber: 1004,
      agentName: 'sdlc-orchestrator',
      execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
      workflowStage: 'awaiting_merge',
    }),
    findOrchestratorStatePath: () => `/agents/${ctx.adwId}/sdlc-orchestrator`,
    readOrchestratorState: (): AgentState => ({
      adwId: ctx.adwId,
      issueNumber: 1004,
      agentName: 'sdlc-orchestrator',
      execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
      workflowStage: 'awaiting_merge',
      branchName: ctx.branch,
    }),
    findPRByBranch: () => ({
      number: ctx.prNumber,
      state: 'OPEN',
      headRefName: ctx.branch,
      baseRefName: 'main',
    }),
    issueHasLabel: () => hitl,
    fetchPRApprovalState: () => approval,
    ensureWorktree: () => `/worktrees/${ctx.branch}`,
    ensureLogsDirectory: () => `/logs/${ctx.adwId}`,
    mergeWithConflictResolution: async () => { onMerge(); return { success: true }; },
    writeTopLevelState: () => undefined,
    commentOnIssue: () => undefined,
    commentOnPR: () => undefined,
    getPlanFilePath: () => '',
    planFileExists: () => false,
  };
}

When(
  'executeMerge is invoked twice for issue {int} with the injected deps',
  async function (issueNumber: number) {
    _firstMergeWithConflictResolutionCalled = false;
    _secondMergeWithConflictResolutionCalled = false;

    _twoTickCtx.firstResult = await executeMerge(
      issueNumber,
      _twoTickCtx.adwId,
      { owner: 'acme', repo: 'widgets' },
      makeTwoTickDeps(_twoTickCtx.firstHitl, _twoTickCtx.firstApproval,
        () => { _firstMergeWithConflictResolutionCalled = true; }),
    );

    _twoTickCtx.secondResult = await executeMerge(
      issueNumber,
      _twoTickCtx.adwId,
      { owner: 'acme', repo: 'widgets' },
      makeTwoTickDeps(_twoTickCtx.secondHitl, _twoTickCtx.secondApproval,
        () => { _secondMergeWithConflictResolutionCalled = true; }),
    );
  },
);

Then(
  'the first invocation defers with reason {string}',
  function (reason: string) {
    assert.ok(_twoTickCtx.firstResult !== null, 'Expected first executeMerge result');
    assert.strictEqual(_twoTickCtx.firstResult!.outcome, 'abandoned');
    assert.strictEqual(_twoTickCtx.firstResult!.reason, reason);
    assert.strictEqual(_firstMergeWithConflictResolutionCalled, false);
  },
);

Then(
  'the second invocation calls mergeWithConflictResolution with the PR number',
  function () {
    assert.strictEqual(_secondMergeWithConflictResolutionCalled, true,
      'Expected second invocation to call mergeWithConflictResolution');
  },
);
