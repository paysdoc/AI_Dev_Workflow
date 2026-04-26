/**
 * Step definitions for @adw-460: reclassify abandoned→discarded at call sites
 *
 * Covers:
 * - adwMerge terminal exits (pr_closed, merge_failed) write 'discarded'
 * - adwMerge transient exits continue writing 'abandoned'
 * - adwMerge imports handleWorkflowDiscarded from workflowCompletion
 * - webhookHandlers PR-closed path writes 'discarded'
 * - Unit test coverage assertions (source inspection)
 * - Cross-module: cron backlog sweeper treats 'discarded' as terminal
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

import { executeMerge, type MergeDeps } from '../../adws/adwMerge';
import { handlePullRequestEvent, type PrClosedDeps } from '../../adws/triggers/webhookHandlers';
import type { AgentState } from '../../adws/types/agentTypes';
import type { RepoInfo } from '../../adws/github/githubApi';
import type { RawPR } from '../../adws/github/prApi';
import type { PullRequestWebhookPayload } from '../../adws/types/issueTypes';
import { AGENTS_STATE_DIR } from '../../adws/core/config';
import { sharedCtx } from './commonSteps.ts';

const TEST_ADW_IDS_460 = ['pr-closed-460', 'merge-failed-460', 'transient-460'];

// ── Cleanup between scenarios ──────────────────────────────────────────────────

Before({ tags: '@adw-460' }, function () {
  for (const id of TEST_ADW_IDS_460) {
    const dir = join(AGENTS_STATE_DIR, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  this.mergeResult = undefined;
  this.mergeDeps = undefined;
  this.webhookResult = undefined;
  this.webhookDeps = undefined;
  this.webhookPayload = undefined;
  this.writeTopLevelStateCalls = [];
  this.closeIssueCalls = [];
});

After({ tags: '@adw-460' }, function () {
  for (const id of TEST_ADW_IDS_460) {
    const dir = join(AGENTS_STATE_DIR, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────

const REPO_INFO: RepoInfo = { owner: 'acme', repo: 'myrepo' };

function makeState460(overrides: Partial<AgentState> = {}): AgentState {
  return {
    adwId: 'test-adw-id',
    issueNumber: 42,
    agentName: 'sdlc-orchestrator',
    execution: { status: 'completed', startedAt: '2024-01-01T00:00:00Z' },
    workflowStage: 'awaiting_merge',
    ...overrides,
  };
}

function makePR460(overrides: Partial<RawPR> = {}): RawPR {
  return {
    number: 7,
    state: 'OPEN',
    headRefName: 'feature-issue-42-abc',
    baseRefName: 'main',
    ...overrides,
  };
}

type WriteCalls = Array<[string, Partial<AgentState>]>;

function makeBaseDeps460(writeCalls: WriteCalls, overrides: Partial<MergeDeps> = {}): MergeDeps {
  return {
    readTopLevelState: () => makeState460(),
    findOrchestratorStatePath: () => '/agents/test-adw-id/sdlc-orchestrator',
    readOrchestratorState: () => makeState460({ branchName: 'feature-issue-42-abc' } as Partial<AgentState>),
    findPRByBranch: () => makePR460(),
    ensureWorktree: () => '/worktrees/feature-issue-42-abc',
    ensureLogsDirectory: () => '/logs/test-adw-id',
    mergeWithConflictResolution: () => Promise.resolve({ success: true }),
    writeTopLevelState: (adwId, state) => { writeCalls.push([adwId, state]); },
    commentOnIssue: (() => undefined) as unknown as MergeDeps['commentOnIssue'],
    commentOnPR: (() => undefined) as unknown as MergeDeps['commentOnPR'],
    getPlanFilePath: (() => '') as unknown as MergeDeps['getPlanFilePath'],
    planFileExists: (() => false) as unknown as MergeDeps['planFileExists'],
    fetchPRApprovalState: (() => true) as unknown as MergeDeps['fetchPRApprovalState'],
    issueHasLabel: (() => false) as unknown as MergeDeps['issueHasLabel'],
    ...overrides,
  };
}

// Lazy-execute executeMerge if not already run (supports "no When" BDD scenarios)
async function ensureMergeExecuted(world: Record<string, unknown>): Promise<void> {
  if (world['mergeResult'] !== undefined) return;
  assert.ok(world['mergeDeps'], 'Expected mergeDeps to be configured via a Given step');
  world['mergeResult'] = await executeMerge(
    42, 'test-adw-id', REPO_INFO, world['mergeDeps'] as MergeDeps,
  );
}

// Lazy-execute handlePullRequestEvent if not already run
async function ensureWebhookExecuted(world: Record<string, unknown>): Promise<void> {
  if (world['webhookResult'] !== undefined) return;
  assert.ok(world['webhookDeps'], 'Expected webhookDeps to be configured via a Given step');
  assert.ok(world['webhookPayload'], 'Expected webhookPayload to be configured via a Given step');
  world['webhookResult'] = await handlePullRequestEvent(
    world['webhookPayload'] as PullRequestWebhookPayload,
    world['webhookDeps'] as PrClosedDeps,
  );
}

// ── Given: executeMerge setup ──────────────────────────────────────────────────

Given('executeMerge is invoked with a PR whose GitHub state is {string}', function (prState: string) {
  const calls: WriteCalls = [];
  this.writeTopLevelStateCalls = calls;
  this.mergeDeps = makeBaseDeps460(calls, {
    findPRByBranch: () => makePR460({ state: prState }),
  });
});

Given('executeMerge is invoked with an open PR', function () {
  const calls: WriteCalls = [];
  this.writeTopLevelStateCalls = calls;
  this.mergeDeps = makeBaseDeps460(calls);
});

Given('mergeWithConflictResolution returns success=false with an error message', function () {
  const deps = this.mergeDeps as MergeDeps;
  this.mergeDeps = {
    ...deps,
    mergeWithConflictResolution: () => Promise.resolve({ success: false, error: 'Conflict detected' }),
  };
});

Given('mergeWithConflictResolution returns success=true', function () {
  const deps = this.mergeDeps as MergeDeps;
  this.mergeDeps = {
    ...deps,
    mergeWithConflictResolution: () => Promise.resolve({ success: true }),
  };
});

Given('executeMerge is invoked with readTopLevelState returning null', function () {
  const calls: WriteCalls = [];
  this.writeTopLevelStateCalls = calls;
  this.mergeDeps = makeBaseDeps460(calls, { readTopLevelState: () => null });
});

Given('executeMerge is invoked with a top-level workflowStage of {string}', function (stage: string) {
  const calls: WriteCalls = [];
  this.writeTopLevelStateCalls = calls;
  this.mergeDeps = makeBaseDeps460(calls, {
    readTopLevelState: () => makeState460({ workflowStage: stage }),
  });
});

Given('executeMerge is invoked with findOrchestratorStatePath returning null', function () {
  const calls: WriteCalls = [];
  this.writeTopLevelStateCalls = calls;
  this.mergeDeps = makeBaseDeps460(calls, { findOrchestratorStatePath: () => null });
});

Given('executeMerge is invoked with orchestrator state lacking branchName', function () {
  const calls: WriteCalls = [];
  this.writeTopLevelStateCalls = calls;
  this.mergeDeps = makeBaseDeps460(calls, {
    readOrchestratorState: () => makeState460(),  // no branchName
  });
});

Given('executeMerge is invoked with findPRByBranch returning null', function () {
  const calls: WriteCalls = [];
  this.writeTopLevelStateCalls = calls;
  this.mergeDeps = makeBaseDeps460(calls, { findPRByBranch: () => null });
});

Given('executeMerge is invoked and ensureWorktree throws an error', function () {
  const calls: WriteCalls = [];
  this.writeTopLevelStateCalls = calls;
  this.mergeDeps = makeBaseDeps460(calls, {
    ensureWorktree: () => { throw new Error('git error'); },
  });
});

// ── When: exit paths (run executeMerge if not already run by Given) ────────────

When(/^the \S+ exit path is taken$/, async function () {
  this.mergeResult = await executeMerge(42, 'test-adw-id', REPO_INFO, this.mergeDeps as MergeDeps);
});

// ── Given/When: webhook handler ────────────────────────────────────────────────

Given('handlePullRequestEvent is invoked with a closed, non-merged PR payload', function () {
  const writeCalls: WriteCalls = [];
  const closeCalls: Array<[number, RepoInfo, string | undefined]> = [];
  this.writeTopLevelStateCalls = writeCalls;
  this.closeIssueCalls = closeCalls;
  this.webhookDeps = {
    fetchIssueComments: () => [],
    writeTopLevelState: (adwId: string, state: Partial<AgentState>) => writeCalls.push([adwId, state]),
    closeIssue: (issueNumber: number, repoInfo: RepoInfo, comment?: string) => {
      closeCalls.push([issueNumber, repoInfo, comment]);
      return Promise.resolve(true);
    },
  } as PrClosedDeps;
  this.webhookPayload = {
    action: 'closed',
    pull_request: {
      number: 10,
      state: 'closed',
      merged: false,
      body: null,
      html_url: 'https://github.com/acme/myrepo/pull/10',
      title: 'Some PR',
      base: { ref: 'main' },
      head: { ref: 'feature/issue-42-some-feature' },
    },
    repository: {
      name: 'myrepo',
      owner: { login: 'acme' },
      full_name: 'acme/myrepo',
    },
  } as PullRequestWebhookPayload;
});

Given("the linked issue's comments contain an adw-id", function () {
  const deps = this.webhookDeps as PrClosedDeps;
  this.webhookDeps = {
    ...deps,
    fetchIssueComments: () => [{ body: '**ADW ID:** `abc123`' }],
  };
});

When('the abandoned PR branch runs', async function () {
  this.webhookResult = await handlePullRequestEvent(
    this.webhookPayload as PullRequestWebhookPayload,
    this.webhookDeps as PrClosedDeps,
  );
});

// ── Then: executeMerge result assertions ───────────────────────────────────────

Then('the result outcome is {string} with reason {string}', async function (outcome: string, reason: string) {
  await ensureMergeExecuted(this as unknown as Record<string, unknown>);
  const result = this.mergeResult as { outcome: string; reason: string };
  assert.strictEqual(result.outcome, outcome, `Expected outcome "${outcome}", got "${result.outcome}"`);
  assert.strictEqual(result.reason, reason, `Expected reason "${reason}", got "${result.reason}"`);
});

Then('the result reason is {string}', async function (reason: string) {
  await ensureMergeExecuted(this as unknown as Record<string, unknown>);
  const result = this.mergeResult as { reason: string };
  assert.strictEqual(result.reason, reason, `Expected reason "${reason}", got "${result.reason}"`);
});

Then('the result reason begins with {string}', async function (prefix: string) {
  await ensureMergeExecuted(this as unknown as Record<string, unknown>);
  const result = this.mergeResult as { reason: string };
  assert.ok(
    result.reason.startsWith(prefix),
    `Expected reason to begin with "${prefix}", got "${result.reason}"`,
  );
});

Then('writeTopLevelState is called with workflowStage {string}', async function (stage: string) {
  if (this.mergeDeps !== undefined && this.mergeResult === undefined) {
    await ensureMergeExecuted(this as unknown as Record<string, unknown>);
  } else if (this.webhookDeps !== undefined && this.webhookResult === undefined) {
    await ensureWebhookExecuted(this as unknown as Record<string, unknown>);
  }
  const calls = this.writeTopLevelStateCalls as WriteCalls;
  const found = calls.some(([, state]) => state.workflowStage === stage);
  assert.ok(found, `Expected writeTopLevelState to be called with workflowStage "${stage}", got: ${JSON.stringify(calls.map(([, s]) => s.workflowStage))}`);
});

Then('writeTopLevelState is not called with workflowStage {string}', async function (stage: string) {
  if (this.mergeDeps !== undefined && this.mergeResult === undefined) {
    await ensureMergeExecuted(this as unknown as Record<string, unknown>);
  } else if (this.webhookDeps !== undefined && this.webhookResult === undefined) {
    await ensureWebhookExecuted(this as unknown as Record<string, unknown>);
  }
  const calls = this.writeTopLevelStateCalls as WriteCalls;
  const found = calls.some(([, state]) => state.workflowStage === stage);
  assert.ok(!found, `Expected writeTopLevelState NOT to be called with workflowStage "${stage}", got: ${JSON.stringify(calls.map(([, s]) => s.workflowStage))}`);
});

Then('writeTopLevelState is not called', async function () {
  await ensureMergeExecuted(this as unknown as Record<string, unknown>);
  const calls = this.writeTopLevelStateCalls as WriteCalls;
  assert.strictEqual(calls.length, 0, `Expected writeTopLevelState NOT to be called, got ${calls.length} call(s)`);
});

// ── Then: source inspection — exit path writes ────────────────────────────────

Then('the pr_closed exit writes workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const closedIdx = content.indexOf("'CLOSED'");
  assert.ok(closedIdx !== -1, `Expected "${sharedCtx.filePath}" to have a CLOSED branch`);
  const window = content.slice(closedIdx, closedIdx + 400);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected pr_closed exit in "${sharedCtx.filePath}" to write workflowStage "${stage}" near the CLOSED branch`,
  );
});

Then('the merge_failed exit writes workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const mergeCheckIdx = content.indexOf('mergeOutcome.success');
  assert.ok(mergeCheckIdx !== -1, `Expected "${sharedCtx.filePath}" to check mergeOutcome.success`);
  const afterCheck = content.slice(mergeCheckIdx);
  const found =
    afterCheck.includes(`workflowStage: '${stage}'`) || afterCheck.includes(`workflowStage: "${stage}"`);
  assert.ok(found, `Expected merge_failed exit in "${sharedCtx.filePath}" to write workflowStage "${stage}" after mergeOutcome.success check`);
});

Then('the unexpected_stage exit writes workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const idx = content.indexOf("'awaiting_merge'");
  assert.ok(idx !== -1, `Expected "${sharedCtx.filePath}" to check for awaiting_merge`);
  const window = content.slice(idx, idx + 400);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected unexpected_stage exit to write workflowStage "${stage}"`,
  );
});

Then('the no_orchestrator_state exit writes workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const idx = content.indexOf('no_orchestrator_state');
  assert.ok(idx !== -1, `Expected "${sharedCtx.filePath}" to handle no_orchestrator_state`);
  const window = content.slice(Math.max(0, idx - 200), idx + 200);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected no_orchestrator_state exit to write workflowStage "${stage}"`,
  );
});

Then('the no_branch_name exit writes workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const idx = content.indexOf('no_branch_name');
  assert.ok(idx !== -1, `Expected "${sharedCtx.filePath}" to handle no_branch_name`);
  const window = content.slice(Math.max(0, idx - 200), idx + 200);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected no_branch_name exit to write workflowStage "${stage}"`,
  );
});

Then('the no_pr_found exit writes workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const idx = content.indexOf('no_pr_found');
  assert.ok(idx !== -1, `Expected "${sharedCtx.filePath}" to handle no_pr_found`);
  const window = content.slice(Math.max(0, idx - 200), idx + 200);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected no_pr_found exit to write workflowStage "${stage}"`,
  );
});

Then('the worktree_error exit writes workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const idx = content.indexOf('worktree_error');
  assert.ok(idx !== -1, `Expected "${sharedCtx.filePath}" to handle worktree_error`);
  const window = content.slice(Math.max(0, idx - 200), idx + 200);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected worktree_error exit to write workflowStage "${stage}"`,
  );
});

Then('the no_state_file exit does not call writeTopLevelState', function () {
  const content: string = sharedCtx.fileContent;
  const idx = content.indexOf('no_state_file');
  assert.ok(idx !== -1, `Expected "${sharedCtx.filePath}" to handle no_state_file`);
  const window = content.slice(Math.max(0, idx - 200), idx + 200);
  assert.ok(
    !window.includes('writeTopLevelState'),
    `Expected no_state_file exit NOT to call writeTopLevelState in "${sharedCtx.filePath}"`,
  );
});

// ── Then: unit test file assertions ───────────────────────────────────────────

Then('the pr_closed test asserts writeTopLevelState was called with workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const describeIdx = content.indexOf('executeMerge — closed PR');
  assert.ok(describeIdx !== -1, `Expected test file to contain "executeMerge — closed PR" describe block`);
  const window = content.slice(describeIdx, describeIdx + 800);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected pr_closed test to assert writeTopLevelState with workflowStage "${stage}"`,
  );
});

Then('the merge_failed test asserts writeTopLevelState was called with workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const describeIdx = content.indexOf('executeMerge — failed merge');
  assert.ok(describeIdx !== -1, `Expected test file to contain "executeMerge — failed merge" describe block`);
  const window = content.slice(describeIdx, describeIdx + 800);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected merge_failed test to assert writeTopLevelState with workflowStage "${stage}"`,
  );
});

Then('the unexpected_stage test asserts writeTopLevelState was called with workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const idx = content.indexOf('unexpected_stage');
  assert.ok(idx !== -1, `Expected test file to contain unexpected_stage test`);
  const window = content.slice(idx, idx + 400);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected unexpected_stage test to assert workflowStage "${stage}"`,
  );
});

Then('the no_orchestrator_state test asserts writeTopLevelState was called with workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const idx = content.indexOf('no_orchestrator_state');
  assert.ok(idx !== -1, `Expected test file to contain no_orchestrator_state test`);
  const window = content.slice(idx, idx + 400);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected no_orchestrator_state test to assert workflowStage "${stage}"`,
  );
});

Then('the no_branch_name test asserts writeTopLevelState was called with workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const idx = content.indexOf('no_branch_name');
  assert.ok(idx !== -1, `Expected test file to contain no_branch_name test`);
  const window = content.slice(idx, idx + 400);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected no_branch_name test to assert workflowStage "${stage}"`,
  );
});

Then('the no_pr_found test asserts writeTopLevelState was called with workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const idx = content.indexOf('no_pr_found');
  assert.ok(idx !== -1, `Expected test file to contain no_pr_found test`);
  const window = content.slice(idx, idx + 400);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected no_pr_found test to assert workflowStage "${stage}"`,
  );
});

Then('the worktree_error test asserts writeTopLevelState was called with workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const idx = content.indexOf('worktree_error');
  assert.ok(idx !== -1, `Expected test file to contain worktree_error test`);
  const window = content.slice(idx, idx + 400);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected worktree_error test to assert workflowStage "${stage}"`,
  );
});

Then('the no_state_file test asserts writeTopLevelState was not called', function () {
  const content: string = sharedCtx.fileContent;
  const idx = content.indexOf('no_state_file');
  assert.ok(idx !== -1, `Expected test file to contain no_state_file test`);
  const window = content.slice(idx, idx + 400);
  assert.ok(
    window.includes('.not.toHaveBeenCalled()') || window.includes('not.toHaveBeenCalled'),
    `Expected no_state_file test to assert writeTopLevelState was not called`,
  );
});

Then('the already_merged test asserts writeTopLevelState was called with workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const describeIdx = content.indexOf('already merged PR');
  assert.ok(describeIdx !== -1, `Expected test file to contain "already merged PR" describe block`);
  const window = content.slice(describeIdx, describeIdx + 600);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected already_merged test to assert workflowStage "${stage}"`,
  );
});

Then('the merged test asserts writeTopLevelState was called with workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const describeIdx = content.indexOf('successful merge');
  assert.ok(describeIdx !== -1, `Expected test file to contain "successful merge" describe block`);
  const window = content.slice(describeIdx, describeIdx + 1000);
  assert.ok(
    window.includes(`workflowStage: '${stage}'`) || window.includes(`workflowStage: "${stage}"`),
    `Expected merged test to assert workflowStage "${stage}"`,
  );
});

// ── Then: webhookHandlers source assertions ────────────────────────────────────

Then('the handlePullRequestEvent body writes workflowStage {string} to the top-level state', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const fnIdx = content.indexOf('async function handlePullRequestEvent');
  assert.ok(fnIdx !== -1, `Expected "${sharedCtx.filePath}" to define handlePullRequestEvent`);
  const nextFnIdx = content.indexOf('export async function handleIssueClosedEvent', fnIdx);
  const fnBody = nextFnIdx !== -1 ? content.slice(fnIdx, nextFnIdx) : content.slice(fnIdx, fnIdx + 2000);
  assert.ok(
    fnBody.includes(`workflowStage: '${stage}'`) || fnBody.includes(`workflowStage: "${stage}"`),
    `Expected handlePullRequestEvent in "${sharedCtx.filePath}" to write workflowStage "${stage}"`,
  );
});

Then('the handlePullRequestEvent body does not write workflowStage {string} to the top-level state', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const fnIdx = content.indexOf('async function handlePullRequestEvent');
  assert.ok(fnIdx !== -1, `Expected "${sharedCtx.filePath}" to define handlePullRequestEvent`);
  const nextFnIdx = content.indexOf('export async function handleIssueClosedEvent', fnIdx);
  const fnBody = nextFnIdx !== -1 ? content.slice(fnIdx, nextFnIdx) : content.slice(fnIdx, fnIdx + 2000);
  assert.ok(
    !fnBody.includes(`workflowStage: '${stage}'`) && !fnBody.includes(`workflowStage: "${stage}"`),
    `Expected handlePullRequestEvent in "${sharedCtx.filePath}" NOT to write workflowStage "${stage}"`,
  );
});

// ── Then: webhookHandlers.test.ts assertions ──────────────────────────────────

Then('at least one handlePullRequestEvent test asserts writeTopLevelState was called with workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  // Find the describe blocks for handlePullRequestEvent (not the import mentions)
  const prDescribeIdx = content.indexOf("describe('handlePullRequestEvent");
  assert.ok(prDescribeIdx !== -1, `Expected test file to contain a describe block for handlePullRequestEvent`);
  // Find where handleIssueClosedEvent describe blocks start
  const issueDescribeIdx = content.indexOf("describe('handleIssueClosedEvent");
  const scope = issueDescribeIdx > prDescribeIdx
    ? content.slice(prDescribeIdx, issueDescribeIdx)
    : content.slice(prDescribeIdx, prDescribeIdx + 3000);
  assert.ok(
    scope.includes(`workflowStage: '${stage}'`) || scope.includes(`workflowStage: "${stage}"`),
    `Expected at least one handlePullRequestEvent test to assert workflowStage "${stage}"`,
  );
});

Then('no handlePullRequestEvent test asserts writeTopLevelState was called with workflowStage {string}', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const prDescribeIdx = content.indexOf("describe('handlePullRequestEvent");
  assert.ok(prDescribeIdx !== -1, `Expected test file to contain a describe block for handlePullRequestEvent`);
  const issueDescribeIdx = content.indexOf("describe('handleIssueClosedEvent");
  const scope = issueDescribeIdx > prDescribeIdx
    ? content.slice(prDescribeIdx, issueDescribeIdx)
    : content.slice(prDescribeIdx, prDescribeIdx + 3000);
  assert.ok(
    !scope.includes(`workflowStage: '${stage}'`) && !scope.includes(`workflowStage: "${stage}"`),
    `Expected NO handlePullRequestEvent test to assert workflowStage "${stage}" in describe blocks`,
  );
});

// ── Then: webhook handler runtime ─────────────────────────────────────────────

Then('closeIssue is called with the linked issue number', async function () {
  await ensureWebhookExecuted(this as unknown as Record<string, unknown>);
  const calls = this.closeIssueCalls as Array<[number, RepoInfo, string | undefined]>;
  assert.ok(calls.length > 0, 'Expected closeIssue to be called');
  assert.strictEqual(calls[0][0], 42, `Expected closeIssue called with #42, got #${calls[0][0]}`);
});

Then('the comment posted on the closed issue explains that the PR was closed without merging', async function () {
  await ensureWebhookExecuted(this as unknown as Record<string, unknown>);
  const calls = this.closeIssueCalls as Array<[number, RepoInfo, string | undefined]>;
  assert.ok(calls.length > 0, 'Expected closeIssue to be called');
  const comment = calls[0][2] ?? '';
  assert.ok(
    comment.toLowerCase().includes('closed') || comment.includes('Abandoned') || comment.includes('abandoned'),
    `Expected comment to reference PR closure, got: ${comment.substring(0, 200)}`,
  );
});

// ── Then: simplifyWebhookHandlers compatibility ───────────────────────────────

Then('handlePullRequestEvent does not write workflowStage {string} in the PR-closed path', function (stage: string) {
  const content: string = sharedCtx.fileContent;
  const fnIdx = content.indexOf('async function handlePullRequestEvent');
  assert.ok(fnIdx !== -1, `Expected "${sharedCtx.filePath}" to define handlePullRequestEvent`);
  const nextFnIdx = content.indexOf('export async function handleIssueClosedEvent', fnIdx);
  const fnBody = nextFnIdx !== -1 ? content.slice(fnIdx, nextFnIdx) : content.slice(fnIdx, fnIdx + 2000);
  assert.ok(
    !fnBody.includes(`workflowStage: '${stage}'`) && !fnBody.includes(`workflowStage: "${stage}"`),
    `Expected handlePullRequestEvent NOT to write workflowStage "${stage}" in the PR-closed path`,
  );
});

// ── Then: cross-module filter reason assertions ───────────────────────────────

Then('the filter reason identifies the issue as terminally discarded', function () {
  const result = this.filterResult as { eligible: boolean; reason?: string } | undefined;
  assert.ok(result, 'Expected filterResult to be set by "When the cron trigger evaluates eligibility"');
  assert.strictEqual(result.eligible, false, `Expected issue to be ineligible`);
  assert.strictEqual(
    result.reason,
    'discarded',
    `Expected reason "discarded", got "${String(result.reason)}"`,
  );
});

Then('the issue is considered eligible via the retriable abandoned path', function () {
  const result = this.filterResult as { eligible: boolean; reason?: string } | undefined;
  assert.ok(result, 'Expected filterResult to be set by "When the cron trigger evaluates eligibility"');
  assert.ok(result.eligible, `Expected issue to be eligible (retriable abandoned path), got reason: "${String(result.reason)}"`);
});
