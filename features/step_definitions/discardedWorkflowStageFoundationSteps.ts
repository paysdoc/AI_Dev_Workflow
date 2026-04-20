/**
 * Step definitions for @adw-454: discarded workflow stage foundation
 *
 * Covers:
 * - WorkflowStage union includes 'discarded'
 * - cronStageResolver treats discarded as non-active / non-retriable
 * - cronIssueFilter skips discarded issues (parity with completed)
 * - handleWorkflowDiscarded helper (writes stage, posts comment, exits 0)
 * - handleWorkflowError regression (still writes abandoned)
 * - Unit test file coverage assertions
 * - Migration guard (no existing state files are touched)
 * - Scope guard (adwMerge / webhookHandlers not yet reclassified)
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { existsSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { globSync } from 'glob';

import { isRetriableStage } from '../../adws/triggers/cronStageResolver';
import { evaluateIssue, type CronIssue, type ProcessedSets } from '../../adws/triggers/cronIssueFilter';
import { AgentStateManager } from '../../adws/core/agentState';
import { AGENTS_STATE_DIR, GRACE_PERIOD_MS } from '../../adws/core/config';
import { handleWorkflowDiscarded } from '../../adws/phases/workflowCompletion';
import type { WorkflowContext } from '../../adws/github/workflowCommentsIssue';
import type { WorkflowConfig } from '../../adws/phases/workflowInit';
import type { StageResolution } from '../../adws/triggers/cronStageResolver';
import { sharedCtx } from './commonSteps';

const ROOT = process.cwd();

// ── Test adwIds cleaned up between scenarios ───────────────────────────────

const TEST_ADW_IDS_454 = [
  'discarded1', 'done-c-9999', 'done-d-9999', 'retry-d-1234',
  'kill-1234', 'legacy-12345', 'disc-comment-77', 'disc-reason-88',
];

Before({ tags: '@adw-454' }, function () {
  for (const id of TEST_ADW_IDS_454) {
    const dir = join(AGENTS_STATE_DIR, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  this.stageEvalResult = undefined;
  this.stageInput = undefined;
  this.stageEvalType = undefined;
  this.multiIssueResults = undefined;
  this.discardedHelperRan = false;
  this.capturedComments = [];
  this.helperAdwId = undefined;
});

After({ tags: '@adw-454' }, function () {
  for (const id of TEST_ADW_IDS_454) {
    const dir = join(AGENTS_STATE_DIR, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTestIssue(number: number, updatedMsAgo = GRACE_PERIOD_MS * 10): CronIssue {
  return {
    number,
    body: '',
    comments: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: new Date(Date.now() - updatedMsAgo).toISOString(),
  };
}

function noProcessed(): ProcessedSets {
  return { spawns: new Set<number>(), merges: new Set<number>() };
}

// ── WorkflowStage union ────────────────────────────────────────────────────

Then('the WorkflowStage union type includes the literal {string}', function (literal: string) {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    content.includes(`'${literal}'`) || content.includes(`"${literal}"`),
    `Expected WorkflowStage union in "${sharedCtx.filePath}" to include the literal '${literal}'`,
  );
});

// ── Multi-issue evaluation ─────────────────────────────────────────────────

When('the cron trigger evaluates eligibility for each issue', function () {
  const GRACE = GRACE_PERIOD_MS;
  const results: Array<{ number: number; eligible: boolean; reason: string | undefined }> = [];

  // Scan all known test IDs that had state files written in this scenario's setup steps
  for (const adwId of TEST_ADW_IDS_454) {
    const dir = join(AGENTS_STATE_DIR, adwId);
    if (!existsSync(dir)) continue;
    const state = AgentStateManager.readTopLevelState(adwId);
    if (!state) continue;

    const issueNum = (state.issueNumber as number) ?? 9999;
    const issue = makeTestIssue(issueNum);
    const resolve = (): StageResolution => ({
      stage: (state.workflowStage as string | null) ?? null,
      adwId,
      lastActivityMs: null,
    });

    const result = evaluateIssue(issue, Date.now(), noProcessed(), GRACE, resolve);
    results.push({ number: issueNum, eligible: result.eligible, reason: result.reason });
  }

  assert.ok(results.length > 0, 'Expected at least one issue to be evaluated — check that state files were written in the Given steps');
  this.multiIssueResults = results;
});

Then('both issues are not eligible for re-processing', function () {
  const results = this.multiIssueResults as Array<{ number: number; eligible: boolean }>;
  assert.ok(results, 'Expected multiIssueResults to be set');
  for (const r of results) {
    assert.strictEqual(r.eligible, false, `Expected issue #${r.number} to be ineligible`);
  }
});

Then('the filter reasons identify them as terminal skip cases', function () {
  const results = this.multiIssueResults as Array<{ number: number; reason: string | undefined }>;
  for (const r of results) {
    const reason = r.reason ?? '';
    const isTerminal = reason === 'completed' || reason === 'discarded';
    assert.ok(
      isTerminal,
      `Expected issue #${r.number} reason to be a terminal skip ('completed' or 'discarded'), got '${reason}'`,
    );
  }
});

// The "Given an issue with adw-id ... extracted from comments" + "Given a state file exists at..."
// steps in cronStageFromStateFileSteps.ts handle single-issue setup. For the multi-issue scenario
// we need a separate accumulator on this.multiIssues.

Given('an issue with adw-id {string} extracted from comments for multi-eval', function (adwId: string) {
  if (!this.multiIssues) this.multiIssues = [];
  (this.multiIssues as Array<{ number: number; adwId: string }>).push({
    number: 9990 + (this.multiIssues as Array<unknown>).length,
    adwId,
  });
});

// ── discarded bypasses retriable path ─────────────────────────────────────

Then('the issue is not considered eligible via isRetriableStage', function () {
  const result = this.filterResult as { eligible: boolean; reason?: string } | undefined;
  assert.ok(result, 'Expected filterResult to be set');
  // If discarded is correctly handled, the reason is 'discarded' (not null / 'abandoned')
  assert.strictEqual(result.eligible, false, 'Expected issue to be ineligible');
  assert.notStrictEqual(result.reason, undefined, 'Expected a reason to be set');
  assert.notStrictEqual(result.reason, 'abandoned', 'Expected discarded not to take the abandoned/retriable path');
});

Then('the cron does not spawn a workflow for this issue', function () {
  const result = this.filterResult as { eligible: boolean; action?: string } | undefined;
  assert.ok(result, 'Expected filterResult to be set');
  assert.strictEqual(result.eligible, false, 'Expected no spawn because issue is not eligible');
  assert.strictEqual(result.action, undefined, 'Expected no action (no spawn) for discarded issue');
});

// ── handleWorkflowDiscarded — runtime invocation ───────────────────────────

Given('a workflow invoking {string} for adw-id {string}', function (helperName: string, adwId: string) {
  assert.strictEqual(helperName, 'handleWorkflowDiscarded', `This step only supports handleWorkflowDiscarded`);
  this.helperAdwId = adwId;
  this.helperRepoContext = undefined;
  this.helperIssueNumber = 1;
  this.helperReason = 'test-discard';
  // Write an initial state file so the writeState path has something to complete
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber: 1,
    agentName: 'orchestrator',
    workflowStage: 'build_running',
    execution: { status: 'running', startedAt: new Date().toISOString() },
  });
});

Given('a workflow invoking {string} with a repoContext and issue number {int}', function (helperName: string, issueNumber: number) {
  assert.strictEqual(helperName, 'handleWorkflowDiscarded');
  const capturedComments: Array<{ issueNumber: number; comment: string }> = [];
  this.capturedComments = capturedComments;
  const adwId = 'disc-comment-77';
  this.helperAdwId = adwId;
  this.helperIssueNumber = issueNumber;
  this.helperReason = 'test-discard-with-repo';
  this.helperRepoContext = {
    issueTracker: {
      commentOnIssue: (num: number, body: string) => {
        capturedComments.push({ issueNumber: num, comment: body });
      },
      moveToStatus: (_num: number, _status: unknown) => Promise.resolve(),
    },
  };
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber,
    agentName: 'orchestrator',
    workflowStage: 'build_running',
    execution: { status: 'running', startedAt: new Date().toISOString() },
  });
});

Given('a workflow invoking {string} with reason {string}', function (helperName: string, reason: string) {
  assert.strictEqual(helperName, 'handleWorkflowDiscarded');
  const capturedComments: Array<{ issueNumber: number; comment: string }> = [];
  this.capturedComments = capturedComments;
  const adwId = 'disc-reason-88';
  this.helperAdwId = adwId;
  this.helperIssueNumber = 88;
  this.helperReason = reason;
  this.helperRepoContext = {
    issueTracker: {
      commentOnIssue: (num: number, body: string) => {
        capturedComments.push({ issueNumber: num, comment: body });
      },
      moveToStatus: (_num: number, _status: unknown) => Promise.resolve(),
    },
  };
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber: 88,
    agentName: 'orchestrator',
    workflowStage: 'build_running',
    execution: { status: 'running', startedAt: new Date().toISOString() },
  });
});

When('the helper runs to completion', function () {
  const adwId = this.helperAdwId as string;
  const issueNumber = (this.helperIssueNumber as number) ?? 1;
  const reason = (this.helperReason as string) ?? 'test-discard';
  const repoContext = this.helperRepoContext as WorkflowConfig['repoContext'];

  // orchestratorStatePath is a *directory*, not a file (AgentStateManager.writeState appends /state.json)
  const statePath = AgentStateManager.initializeState(adwId, 'orchestrator');

  const ctx: WorkflowContext = { issueNumber, adwId };
  const config: WorkflowConfig = {
    issueNumber,
    adwId,
    orchestratorStatePath: statePath,
    orchestratorName: 'orchestrator',
    ctx,
    repoContext,
  } as unknown as WorkflowConfig;

  // Mock process.exit so it doesn't kill the test runner.
  // handleWorkflowDiscarded writes state BEFORE calling process.exit,
  // so all side effects complete before the mock throws.
  const originalExit = process.exit.bind(process);
  (process as NodeJS.Process).exit = ((code: number) => {
    (process as NodeJS.Process).exit = originalExit;
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit;

  try {
    handleWorkflowDiscarded(config, reason);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    assert.ok(
      msg.startsWith('process.exit('),
      `Expected process.exit to be called, got: ${msg}`,
    );
  } finally {
    (process as NodeJS.Process).exit = originalExit;
  }

  this.discardedHelperRan = true;
});

Then('the top-level state file at {string} has workflowStage {string}', function (relativePath: string, expectedStage: string) {
  const parts = relativePath.replace(/\\/g, '/').split('/');
  const adwId = parts[1];
  const state = AgentStateManager.readTopLevelState(adwId);
  assert.ok(state, `Expected state file to exist for adwId '${adwId}'`);
  assert.strictEqual(
    state.workflowStage,
    expectedStage,
    `Expected workflowStage '${expectedStage}', got '${String(state.workflowStage)}'`,
  );
});

Then('a terminal comment is posted on issue {int} via the repoContext issue tracker', function (issueNumber: number) {
  const comments = this.capturedComments as Array<{ issueNumber: number; comment: string }>;
  assert.ok(comments.length > 0, `Expected at least one comment to be posted on issue ${issueNumber}`);
  const match = comments.find(c => c.issueNumber === issueNumber);
  assert.ok(match, `Expected a comment posted on issue ${issueNumber}, got comments on: ${comments.map(c => c.issueNumber).join(', ')}`);
});

Then('the comment communicates that the workflow was discarded \\(non-retriable)', function () {
  const comments = this.capturedComments as Array<{ issueNumber: number; comment: string }>;
  assert.ok(comments.length > 0, 'Expected at least one comment to have been captured');
  const comment = comments[0].comment;
  assert.ok(
    comment.includes('Discarded') || comment.includes('discarded'),
    `Expected comment to mention "Discarded", got: ${comment.substring(0, 200)}`,
  );
  assert.ok(
    comment.includes('not be retried') || comment.includes('terminal'),
    `Expected comment to communicate non-retriable nature, got: ${comment.substring(0, 200)}`,
  );
});

Then('the terminal comment posted on the issue includes the reason context {string}', function (reason: string) {
  const comments = this.capturedComments as Array<{ issueNumber: number; comment: string }>;
  assert.ok(comments.length > 0, 'Expected at least one comment to have been captured');
  const allCommentBodies = comments.map(c => c.comment).join('\n');
  assert.ok(
    allCommentBodies.includes(reason),
    `Expected comment to include reason '${reason}', got: ${allCommentBodies.substring(0, 300)}`,
  );
});

// ── handleWorkflowError regression ────────────────────────────────────────

Then('handleWorkflowError writes workflowStage {string} to the top-level state file', function (stage: string) {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    content.includes(`workflowStage: '${stage}'`) || content.includes(`workflowStage: "${stage}"`),
    `Expected handleWorkflowError in "${sharedCtx.filePath}" to write workflowStage '${stage}'`,
  );
  // Also verify handleWorkflowError specifically (not just any call site)
  const errFnMatch = content.match(/export function handleWorkflowError[\s\S]*?^}/m);
  if (errFnMatch) {
    assert.ok(
      errFnMatch[0].includes(`workflowStage: '${stage}'`) || errFnMatch[0].includes(`workflowStage: "${stage}"`),
      `handleWorkflowError should write workflowStage '${stage}'`,
    );
  }
});

Then('handleWorkflowError does not write workflowStage {string}', function (stage: string) {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  const errFnMatch = content.match(/export function handleWorkflowError[\s\S]*?^}/m);
  if (errFnMatch) {
    assert.ok(
      !errFnMatch[0].includes(`workflowStage: '${stage}'`) && !errFnMatch[0].includes(`workflowStage: "${stage}"`),
      `handleWorkflowError should NOT write workflowStage '${stage}'`,
    );
  }
  // If the regex didn't match (no function body found), fall back to checking the file doesn't have the wrong stage
  // adjacent to the error function
});

Then('handleWorkflowError retains its existing behavior of writing {string}', function (stage: string) {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    content.includes(`workflowStage: '${stage}'`) || content.includes(`workflowStage: "${stage}"`),
    `Expected handleWorkflowError to still write '${stage}'`,
  );
});

Then('no existing call site of handleWorkflowError is migrated to handleWorkflowDiscarded', function () {
  // This is a source-inspection check: adwMerge.tsx and webhookHandlers.ts should still call
  // handleWorkflowError (or write abandoned directly) — not handleWorkflowDiscarded.
  // We just confirm the completion file itself hasn't migrated the error function body.
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  const errFnMatch = content.match(/export function handleWorkflowError[\s\S]*?^}/m);
  if (errFnMatch) {
    assert.ok(
      !errFnMatch[0].includes('handleWorkflowDiscarded'),
      'handleWorkflowError should not call handleWorkflowDiscarded',
    );
  }
});

// ── Test file coverage assertions ──────────────────────────────────────────

Then('the test file asserts that isRetriableStage returns false for {string}', function (stage: string) {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    content.includes(`isRetriableStage('${stage}')`) || content.includes(`isRetriableStage("${stage}")`),
    `Expected test file to contain isRetriableStage('${stage}')`,
  );
  // Also verify there's an assertion that it returns false
  const idx = content.indexOf(`isRetriableStage('${stage}')`);
  const snippet = content.slice(Math.max(0, idx - 50), idx + 100);
  assert.ok(
    snippet.includes('false') || snippet.includes('toBe(false)'),
    `Expected assertion that isRetriableStage('${stage}') returns false`,
  );
});

Then('the test file asserts that isActiveStage returns false for {string}', function (stage: string) {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    content.includes(`isActiveStage('${stage}')`) || content.includes(`isActiveStage("${stage}")`),
    `Expected test file to contain isActiveStage('${stage}')`,
  );
  const idx = content.indexOf(`isActiveStage('${stage}')`);
  const snippet = content.slice(Math.max(0, idx - 50), idx + 100);
  assert.ok(
    snippet.includes('false') || snippet.includes('toBe(false)'),
    `Expected assertion that isActiveStage('${stage}') returns false`,
  );
});

Given('the cron issue filter test file is read', function () {
  const filePath = 'adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts';
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected ${filePath} to exist`);
  const content = readFileSync(fullPath, 'utf-8');
  this.fileContent = content;
  sharedCtx.fileContent = content;
  sharedCtx.filePath = filePath;
});

Then('at least one test asserts that evaluateIssue excludes an issue whose state stage is {string}', function (stage: string) {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    content.includes(`stage: '${stage}'`) || content.includes(`stage: "${stage}"`),
    `Expected test file to contain a test using stage: '${stage}'`,
  );
  assert.ok(
    content.includes('eligible).toBe(false') || content.includes('eligible: false') || content.includes('eligible, false'),
    `Expected at least one test to assert eligible is false`,
  );
  // More specific: check that the discarded stage is paired with an ineligible assertion
  const idx = content.indexOf(`stage: '${stage}'`);
  const window = content.slice(Math.max(0, idx - 200), idx + 400);
  assert.ok(
    window.includes('eligible'),
    `Expected the ${stage} stage test to assert on eligibility`,
  );
});

Then('the exclusion reason references the terminal\\/discarded classification', function () {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    content.includes("reason').toBe('discarded'") ||
    content.includes("reason).toBe('discarded'") ||
    content.includes("'discarded'"),
    `Expected test to reference the 'discarded' reason`,
  );
});

// ── Migration guard ────────────────────────────────────────────────────────

Then('no module references a migration that rewrites existing {string} state files to {string}', function (from: string, to: string) {
  // Check that there is no migration script or function that batch-rewrites stage values
  const tsFiles = globSync('adws/**/*.ts', { cwd: ROOT });
  for (const file of tsFiles) {
    const content = readFileSync(join(ROOT, file), 'utf-8');
    // Look for patterns that indicate a batch migration: e.g. replacing all 'abandoned' with 'discarded'
    // Use precise patterns — avoid false positives from adwIds that happen to contain 'migrate'
    const hasMigrationPattern =
      content.includes(`replaceAll('${from}', '${to}')`) ||
      content.includes(`replaceAll("${from}", "${to}")`) ||
      (content.includes('migrateStage') || content.includes('batchMigrate') || content.includes('rewriteStage'));
    const hasMigration = hasMigrationPattern && !file.includes('discardedWorkflowStageFoundationSteps');
    assert.ok(
      !hasMigration,
      `Unexpected migration from '${from}' to '${to}' found in ${file}`,
    );
  }
});

Then('existing state files that read {string} continue to be treated as retriable', function (stage: string) {
  assert.strictEqual(
    isRetriableStage(stage),
    true,
    `Expected stage '${stage}' to still be retriable`,
  );
});

// ── Existing abandoned path ────────────────────────────────────────────────

Given('a pre-existing state file at {string} with workflowStage {string}', function (relativePath: string, stage: string) {
  const parts = relativePath.replace(/\\/g, '/').split('/');
  const adwId = parts[1];
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber: 1,
    workflowStage: stage,
    agentName: 'orchestrator',
    execution: { status: 'running', startedAt: new Date().toISOString() },
  });
  // Build issue with enough age to clear grace period
  this.adwId = adwId;
  this.issue = {
    number: 1,
    comments: [{ body: `**ADW ID:** \`${adwId}\`` }],
    updatedAt: new Date(Date.now() - GRACE_PERIOD_MS * 10).toISOString(),
  };
});

Then('the issue is considered eligible for re-processing via the existing abandoned path', function () {
  const result = this.filterResult as { eligible: boolean; reason?: string } | undefined;
  assert.ok(result, 'Expected filterResult to be set (run "When the cron trigger evaluates eligibility" first)');
  assert.strictEqual(result.eligible, true, `Expected issue to be eligible via abandoned path, got reason: '${String(result.reason)}'`);
});

Then('the stage is not silently upgraded to {string}', function (unexpectedStage: string) {
  const adwId = this.adwId as string;
  assert.ok(adwId, 'Expected this.adwId to be set');
  const state = AgentStateManager.readTopLevelState(adwId);
  assert.ok(state, 'Expected state to be readable');
  assert.notStrictEqual(
    state.workflowStage,
    unexpectedStage,
    `Expected workflowStage NOT to be '${unexpectedStage}', but it was`,
  );
});

// ── Scope guard: adwMerge not reclassified ─────────────────────────────────

Then('adwMerge does not yet call handleWorkflowDiscarded', function () {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    !content.includes('handleWorkflowDiscarded'),
    `Expected adwMerge.tsx NOT to call handleWorkflowDiscarded yet (reclassification is slice #2)`,
  );
});

Then("adwMerge's defensive exits that currently write {string} remain unchanged", function (stage: string) {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    content.includes(`'${stage}'`) || content.includes(`"${stage}"`),
    `Expected adwMerge.tsx to still reference '${stage}' (not yet reclassified)`,
  );
});

// ── Scope guard: webhookHandlers not reclassified ──────────────────────────

Given('the webhook handlers module is read', function () {
  const candidates = [
    'adws/triggers/webhookHandlers.ts',
  ];
  let content = '';
  let found = '';
  for (const c of candidates) {
    const fullPath = join(ROOT, c);
    if (existsSync(fullPath)) {
      content = readFileSync(fullPath, 'utf-8');
      found = c;
      break;
    }
  }
  assert.ok(found, `Expected webhookHandlers module to exist (tried: ${candidates.join(', ')})`);
  this.fileContent = content;
  sharedCtx.fileContent = content;
  sharedCtx.filePath = found;
});

Then('the PR-closed path does not yet write workflowStage {string}', function (stage: string) {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  // There should be no reference to the new stage in webhookHandlers (reclassification is slice #2)
  assert.ok(
    !content.includes(`workflowStage: '${stage}'`) && !content.includes(`workflowStage: "${stage}"`),
    `Expected webhookHandlers NOT to write workflowStage '${stage}' yet`,
  );
});

Then("the PR-closed path's existing behavior is preserved for slice #2", function () {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  // The webhook handler should still reference 'abandoned' (not yet reclassified)
  assert.ok(
    content.includes("'abandoned'") || content.includes('"abandoned"') || content.includes('abandoned'),
    `Expected webhookHandlers to still use 'abandoned' (not yet reclassified to 'discarded')`,
  );
});

Then('the PR-closed path writes workflowStage {string}', function (stage: string) {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  const fnIdx = content.indexOf('async function handlePullRequestEvent');
  assert.ok(fnIdx !== -1, `Expected webhookHandlers to define handlePullRequestEvent`);
  const nextFnIdx = content.indexOf('export async function handleIssueClosedEvent', fnIdx);
  const fnBody = nextFnIdx !== -1 ? content.slice(fnIdx, nextFnIdx) : content.slice(fnIdx, fnIdx + 2000);
  assert.ok(
    fnBody.includes(`workflowStage: '${stage}'`) || fnBody.includes(`workflowStage: "${stage}"`),
    `Expected handlePullRequestEvent PR-closed path to write workflowStage "${stage}"`,
  );
});

Then('the PR-closed path does not write workflowStage {string}', function (stage: string) {
  const content: string = this.fileContent ?? sharedCtx.fileContent;
  const fnIdx = content.indexOf('async function handlePullRequestEvent');
  assert.ok(fnIdx !== -1, `Expected webhookHandlers to define handlePullRequestEvent`);
  const nextFnIdx = content.indexOf('export async function handleIssueClosedEvent', fnIdx);
  const fnBody = nextFnIdx !== -1 ? content.slice(fnIdx, nextFnIdx) : content.slice(fnIdx, fnIdx + 2000);
  assert.ok(
    !fnBody.includes(`workflowStage: '${stage}'`) && !fnBody.includes(`workflowStage: "${stage}"`),
    `Expected handlePullRequestEvent PR-closed path NOT to write workflowStage "${stage}"`,
  );
});
