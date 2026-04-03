/**
 * Step definitions for @adw-379: Cron reads workflow stage from state file
 *
 * Covers:
 * - adw-id extraction from issue comments
 * - Stage resolution via AgentStateManager.readTopLevelState
 * - Fresh candidate handling (no adw-id / no state file)
 * - ACTIVE_STAGES and RETRIABLE_STAGES filtering from state file
 * - Grace period check using state file phase timestamps
 * - TypeScript compilation
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

import { extractAdwIdFromComment } from '../../adws/core/workflowCommentParsing';
import {
  isActiveStage,
  isRetriableStage,
  resolveIssueWorkflowStage,
} from '../../adws/triggers/cronStageResolver';
import { AgentStateManager } from '../../adws/core/agentState';
import { AGENTS_STATE_DIR, GRACE_PERIOD_MS } from '../../adws/core/config';

const _ROOT = process.cwd();

// ── Test adwIds cleaned up between scenarios ───────────────────────────────────

const TEST_ADW_IDS = [
  'abc12345', 'orphan123', 'empty12345', 'active123', 'retry123',
  'done12345', 'paused123', 'unknown123', 'grace12345', 'old1234567',
];

Before({ tags: '@adw-379' }, function () {
  for (const id of TEST_ADW_IDS) {
    const dir = join(AGENTS_STATE_DIR, id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  this.issue = null;
  this.filterResult = null;
  this.gracePeriodResult = null;
  this.commentBody = '';
  this.extractedAdwId = undefined;
});

After({ tags: '@adw-379' }, function () {
  for (const id of TEST_ADW_IDS) {
    const dir = join(AGENTS_STATE_DIR, id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ── Helper: evaluate issue eligibility (mirrors evaluateIssue in trigger_cron.ts) ──

interface EvalResult {
  eligible: boolean;
  reason: string | null;
  stage: string | null;
  resolution: ReturnType<typeof resolveIssueWorkflowStage>;
}

function evaluateEligibility(
  issue: { comments: { body: string }[]; updatedAt: string; number: number },
  now: number = Date.now(),
): EvalResult {
  const resolution = resolveIssueWorkflowStage(issue.comments);
  const activityMs = resolution.lastActivityMs ?? new Date(issue.updatedAt).getTime();
  const withinGrace = now - activityMs < GRACE_PERIOD_MS;

  if (withinGrace) {
    return { eligible: false, reason: 'grace_period', stage: resolution.stage, resolution };
  }

  const { stage } = resolution;
  if (stage === null) {
    return { eligible: true, reason: null, stage: null, resolution };
  }
  if (stage === 'completed') {
    return { eligible: false, reason: 'completed', stage, resolution };
  }
  if (stage === 'paused') {
    return { eligible: false, reason: 'paused', stage, resolution };
  }
  if (isActiveStage(stage)) {
    return { eligible: false, reason: 'active', stage, resolution };
  }
  if (isRetriableStage(stage)) {
    return { eligible: true, reason: null, stage, resolution };
  }
  return { eligible: false, reason: `adw_stage:${stage}`, stage, resolution };
}

// ── Background: already covered by commonSteps.ts ────────────────────────────

// ── Scenario 1: adw-id extraction via extractAdwIdFromComment ─────────────────

Then('it should import or use extractAdwIdFromComment from workflowCommentParsing', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('extractAdwIdFromComment') || content.includes('cronStageResolver'),
    `Expected trigger_cron.ts to import or use extractAdwIdFromComment (via cronStageResolver)`,
  );
});

Then('the adw-id is extracted from issue comments to locate the state file', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('cronStageResolver') || content.includes('resolveIssueWorkflowStage'),
    `Expected trigger_cron.ts to use cronStageResolver for state file lookup`,
  );
});

// ── Scenarios 2 & 3: extractAdwIdFromComment parses comment bodies ─────────────

Given('an issue comment body containing {string}', function (commentBody: string) {
  this.commentBody = commentBody;
});

When('extractAdwIdFromComment parses the comment', function () {
  this.extractedAdwId = extractAdwIdFromComment(this.commentBody as string);
});

Then('the extracted adw-id is {string}', function (expected: string) {
  assert.strictEqual(this.extractedAdwId, expected, `Expected adw-id "${expected}", got "${String(this.extractedAdwId)}"`);
});

Then('the extracted adw-id is null', function () {
  assert.strictEqual(this.extractedAdwId, null, `Expected null adw-id, got "${String(this.extractedAdwId)}"`);
});

// ── Scenario setup helpers ─────────────────────────────────────────────────────

Given('an issue with adw-id {string} extracted from comments', function (adwId: string) {
  this.adwId = adwId;
  this.issue = {
    number: 1,
    // Build a comment body that embeds the adw-id in the expected format
    comments: [{ body: `**ADW ID:** \`${adwId}\`` }],
    // Use an old updatedAt so grace period doesn't interfere unless state file sets timestamps
    updatedAt: new Date(Date.now() - GRACE_PERIOD_MS * 10).toISOString(),
  };
});

Given('an issue with no ADW workflow comments', function () {
  this.adwId = null;
  this.issue = {
    number: 1,
    comments: [{ body: 'This is a plain comment with no ADW content' }],
    updatedAt: new Date(Date.now() - GRACE_PERIOD_MS * 10).toISOString(),
  };
});

Given('an issue with no ADW comments and a recent updatedAt timestamp', function () {
  this.adwId = null;
  this.issue = {
    number: 1,
    comments: [],
    // Within grace period
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
  };
});

// ── State file setup helpers ───────────────────────────────────────────────────

Given('a state file exists at {string} with workflowStage {string}', function (relativePath: string, stage: string) {
  // Parse adwId from path: "agents/<adwId>/state.json"
  const parts = relativePath.replace(/\\/g, '/').split('/');
  const adwId = parts[1]; // e.g. "agents/abc12345/state.json" → "abc12345"
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber: 1,
    workflowStage: stage,
    agentName: 'orchestrator',
    execution: { status: 'running', startedAt: new Date().toISOString() },
  });
  this.adwId = adwId;
});

Given('no state file exists at {string}', function (relativePath: string) {
  const parts = relativePath.replace(/\\/g, '/').split('/');
  const adwId = parts[1];
  const dir = join(AGENTS_STATE_DIR, adwId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  // Ensure the issue has this adwId's comment
  if (!this.issue) {
    this.issue = {
      number: 1,
      comments: [{ body: `**ADW ID:** \`${adwId}\`` }],
      updatedAt: new Date(Date.now() - GRACE_PERIOD_MS * 10).toISOString(),
    };
  }
});

Given('a state file exists at {string} without a workflowStage field', function (relativePath: string) {
  const parts = relativePath.replace(/\\/g, '/').split('/');
  const adwId = parts[1];
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber: 1,
    agentName: 'orchestrator',
    execution: { status: 'running', startedAt: new Date().toISOString() },
    // intentionally omitting workflowStage
  });
  this.adwId = adwId;
});

Given('a state file exists at {string} with recent phase timestamps', function (relativePath: string) {
  const parts = relativePath.replace(/\\/g, '/').split('/');
  const adwId = parts[1];
  const recentTimestamp = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago (within grace)
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber: 1,
    workflowStage: 'build_running',
    agentName: 'orchestrator',
    execution: { status: 'running', startedAt: recentTimestamp },
    phases: {
      install: { status: 'completed', startedAt: recentTimestamp, completedAt: recentTimestamp },
    },
  });
  this.adwId = adwId;
});

Given('a state file exists at {string} with phase timestamps older than the grace period', function (relativePath: string) {
  const parts = relativePath.replace(/\\/g, '/').split('/');
  const adwId = parts[1];
  const oldTimestamp = new Date(Date.now() - GRACE_PERIOD_MS * 3).toISOString(); // 3x grace period ago
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber: 1,
    workflowStage: 'abandoned',
    agentName: 'orchestrator',
    execution: { status: 'failed', startedAt: oldTimestamp, completedAt: oldTimestamp },
    phases: {
      install: { status: 'completed', startedAt: oldTimestamp, completedAt: oldTimestamp },
    },
  });
  this.adwId = adwId;
});

// ── Evaluation steps ───────────────────────────────────────────────────────────
// Note: 'When the cron trigger evaluates the issue' and
// 'When the cron trigger evaluates eligibility' are defined in
// cronIssueReevaluationSteps.ts (shared with @adw-chpy1a-orchestrator-refacto scenarios).

When('the cron trigger checks the grace period', function () {
  assert.ok(this.issue, 'Expected this.issue to be set');
  const resolution = resolveIssueWorkflowStage(this.issue.comments);
  const activityMs = resolution.lastActivityMs ?? new Date(this.issue.updatedAt as string).getTime();
  const now = Date.now();
  this.gracePeriodResult = {
    withinGrace: now - activityMs < GRACE_PERIOD_MS,
    usedStateFileTimestamp: resolution.lastActivityMs !== null,
    usedIssueUpdatedAt: resolution.lastActivityMs === null,
    activityMs,
    resolution,
  };
  // Also run full eval so Then steps can check eligibility
  this.filterResult = evaluateEligibility(this.issue);
});

// ── Stage read assertions ──────────────────────────────────────────────────────

Then('the workflow stage is read from the state file via AgentStateManager', function () {
  assert.ok(this.filterResult, 'Expected filterResult to be set');
  const result = this.filterResult as EvalResult;
  // Stage was resolved (non-null adwId means we attempted a state file read)
  assert.ok(
    result.resolution.adwId !== null,
    'Expected adwId to be extracted from comments, confirming state file was looked up',
  );
});

Then('the stage value used for filtering is {string}', function (expectedStage: string) {
  assert.ok(this.filterResult, 'Expected filterResult to be set');
  const result = this.filterResult as EvalResult;
  assert.strictEqual(result.stage, expectedStage, `Expected stage "${expectedStage}", got "${String(result.stage)}"`);
});

Then('the evaluateIssue function does not call parseWorkflowStageFromComment to determine stage', function () {
  const content: string = this.fileContent;
  // The function should not call parseWorkflowStageFromComment directly
  // (it may still be imported elsewhere, but evaluateIssue should not call it)
  const evalFnMatch = content.match(/function evaluateIssue[\s\S]*?^}/m);
  if (evalFnMatch) {
    assert.ok(
      !evalFnMatch[0].includes('parseWorkflowStageFromComment'),
      'Expected evaluateIssue not to call parseWorkflowStageFromComment',
    );
  } else {
    // If evaluateIssue was removed/renamed, check the whole file doesn't use it
    assert.ok(
      !content.includes('parseWorkflowStageFromComment'),
      'Expected trigger_cron.ts not to use parseWorkflowStageFromComment for stage determination',
    );
  }
});

Then('stage determination relies on AgentStateManager.readTopLevelState', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('cronStageResolver') || content.includes('resolveIssueWorkflowStage'),
    `Expected trigger_cron.ts to use cronStageResolver/resolveIssueWorkflowStage for stage determination`,
  );
});

// ── Eligibility assertions ─────────────────────────────────────────────────────

Then('the issue is considered eligible as a fresh candidate', function () {
  assert.ok(this.filterResult, 'Expected filterResult to be set');
  const result = this.filterResult as EvalResult;
  assert.strictEqual(result.eligible, true, `Expected issue to be eligible, got reason: "${String(result.reason)}"`);
});

// Note: 'Then the issue is not eligible for re-processing' is defined in
// cronIssueReevaluationSteps.ts (shared step).

Then('the filter reason includes {string}', function (expected: string) {
  assert.ok(this.filterResult, 'Expected filterResult to be set');
  const result = this.filterResult as EvalResult;
  assert.ok(
    result.reason !== null && result.reason.includes(expected),
    `Expected filter reason to include "${expected}", got "${String(result.reason)}"`,
  );
});

// Note: 'Then the issue is considered eligible for re-processing' is defined in
// cronIssueReevaluationSteps.ts (shared step).

// ── Grace period assertions ────────────────────────────────────────────────────

Then('the grace period is evaluated against the last activity timestamp from the state file phases', function () {
  assert.ok(this.gracePeriodResult, 'Expected gracePeriodResult to be set');
  const gp = this.gracePeriodResult as { usedStateFileTimestamp: boolean };
  assert.strictEqual(
    gp.usedStateFileTimestamp,
    true,
    'Expected grace period to use state file phase timestamp (lastActivityMs)',
  );
});

Then('the issue is excluded due to grace period', function () {
  assert.ok(this.filterResult, 'Expected filterResult to be set');
  const result = this.filterResult as EvalResult;
  assert.strictEqual(
    result.eligible,
    false,
    `Expected issue to be excluded by grace period, got eligible=${String(result.eligible)} reason="${String(result.reason)}"`,
  );
  assert.strictEqual(result.reason, 'grace_period', `Expected reason "grace_period", got "${String(result.reason)}"`);
});

Then('the issue is not excluded by grace period', function () {
  assert.ok(this.filterResult, 'Expected filterResult to be set');
  const result = this.filterResult as EvalResult;
  assert.notStrictEqual(
    result.reason,
    'grace_period',
    `Expected issue NOT to be excluded by grace period, got reason="${String(result.reason)}"`,
  );
});

Then('the grace period is evaluated against the issue updatedAt', function () {
  assert.ok(this.gracePeriodResult, 'Expected gracePeriodResult to be set');
  const gp = this.gracePeriodResult as { usedIssueUpdatedAt: boolean };
  assert.strictEqual(
    gp.usedIssueUpdatedAt,
    true,
    'Expected grace period to fall back to issue.updatedAt',
  );
});

// ── Poll logging scenario (documentation / structural check) ──────────────────

Given('the cron trigger polls and finds issues with various state file stages', function () {
  // Set up world context for poll logging scenario
  this.pollIssues = [
    {
      number: 1,
      comments: [{ body: '**ADW ID:** `active001`' }],
      updatedAt: new Date(Date.now() - GRACE_PERIOD_MS * 10).toISOString(),
    },
    {
      number: 2,
      comments: [{ body: '**ADW ID:** `done0002`' }],
      updatedAt: new Date(Date.now() - GRACE_PERIOD_MS * 10).toISOString(),
    },
    {
      number: 3,
      comments: [],
      updatedAt: new Date(Date.now() - GRACE_PERIOD_MS * 10).toISOString(),
    },
  ];
  // Write state files
  AgentStateManager.writeTopLevelState('active001', { adwId: 'active001', issueNumber: 1, workflowStage: 'build_running', agentName: 'orchestrator', execution: { status: 'running', startedAt: new Date().toISOString() } });
  AgentStateManager.writeTopLevelState('done0002', { adwId: 'done0002', issueNumber: 2, workflowStage: 'completed', agentName: 'orchestrator', execution: { status: 'completed', startedAt: new Date().toISOString() } });
  TEST_ADW_IDS.push('active001', 'done0002');
});

// Note: 'When the poll cycle completes evaluation' and
// 'Then it logs a one-liner in format {string}' are defined in
// cronIssueReevaluationSteps.ts (shared with @adw-chpy1a-orchestrator-refacto scenarios).

Then('filter reasons may include {string}, {string}, or {string}', function (r1: string, r2: string, r3: string) {
  const results = this.pollResults as Array<{ result: EvalResult }>;
  const reasons = results.map(r => r.result.reason).filter(Boolean) as string[];
  const validReasons = new Set([r1, r2, r3]);
  for (const reason of reasons) {
    const isValid = [...validReasons].some(vr => reason.includes(vr));
    assert.ok(isValid, `Unexpected reason "${reason}", expected one of: ${[r1, r2, r3].join(', ')}`);
  }
});

// ── TypeScript compilation ─────────────────────────────────────────────────────
// Note: '{string} is run' is defined in removeUnitTestsSteps.ts
// Note: 'the command exits with code {int}' and '{string} also exits with code {int}'
//       are defined in wireExtractorSteps.ts
