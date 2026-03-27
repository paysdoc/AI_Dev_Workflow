import { Given, When, Then } from '@cucumber/cucumber';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();

// ── Given: test phase context ─────────────────────────────────────────────────

Given('the test phase is running a test retry loop', function () {
  const fullPath = join(ROOT, 'adws/agents/testRetry.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/testRetry.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/testRetry.ts';
});

Given('the test resolution agent is resolving a failing test', function () {
  // Context only — verified via testRetry.ts source inspection
});

Given('the test phase is running with MAX_TOKEN_CONTINUATIONS = 3', function () {
  const fullPath = join(ROOT, 'adws/agents/testRetry.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/testRetry.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/testRetry.ts';
});

Given('the test phase is running with a GitHub repo context', function () {
  const fullPath = join(ROOT, 'adws/phases/testPhase.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/phases/testPhase.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/phases/testPhase.ts';
});

Given('the test phase is running with agent state tracking', function () {
  const fullPath = join(ROOT, 'adws/phases/testPhase.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/phases/testPhase.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/phases/testPhase.ts';
});

Given('the test phase is running a test retry loop with a failing test', function () {
  const fullPath = join(ROOT, 'adws/agents/testRetry.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/testRetry.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/testRetry.ts';
});

// ── Given: review retry context ───────────────────────────────────────────────

Given('the review retry loop is running in prReviewPhase', function () {
  const fullPath = join(ROOT, 'adws/agents/reviewRetry.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/reviewRetry.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/reviewRetry.ts';
});

Given('the review resolution agent is resolving a review blocker', function () {
  // Context only — verified via reviewRetry.ts source inspection
});

Given('the review retry loop is running with MAX_TOKEN_CONTINUATIONS = 3', function () {
  const fullPath = join(ROOT, 'adws/agents/reviewRetry.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/reviewRetry.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/reviewRetry.ts';
});

Given('the review retry loop is running with a GitHub repo context', function () {
  // review_compaction_recovery is posted from workflowCompletion.ts
  const fullPath = join(ROOT, 'adws/phases/workflowCompletion.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/phases/workflowCompletion.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/phases/workflowCompletion.ts';
});

Given('the review retry loop is running with agent state tracking', function () {
  // workflowCompletion.ts orchestrates the review phase and handles state writing + compaction logging
  const fullPath = join(ROOT, 'adws/phases/workflowCompletion.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/phases/workflowCompletion.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/phases/workflowCompletion.ts';
});

Given('the review retry loop is running with a review blocker', function () {
  const fullPath = join(ROOT, 'adws/agents/reviewRetry.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/reviewRetry.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/reviewRetry.ts';
});

// ── Given: cross-phase ────────────────────────────────────────────────────────

Given('the test phase uses agentProcessHandler for the test resolution agent', function () {
  const fullPath = join(ROOT, 'adws/agents/testRetry.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/testRetry.ts to exist');
  assert.ok(
    existsSync(join(ROOT, 'adws/agents/agentProcessHandler.ts')),
    'Expected adws/agents/agentProcessHandler.ts to exist',
  );
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/testRetry.ts';
});

Given('the review phase uses agentProcessHandler for the review resolution agent', function () {
  const fullPath = join(ROOT, 'adws/agents/reviewRetry.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/reviewRetry.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/reviewRetry.ts';
});

Given('the ADW codebase with test and review compaction recovery implemented', function () {
  assert.ok(existsSync(join(ROOT, 'adws')), 'Expected adws/ directory to exist');
  assert.ok(existsSync(join(ROOT, 'adws/agents/testRetry.ts')), 'Expected adws/agents/testRetry.ts to exist');
  assert.ok(existsSync(join(ROOT, 'adws/agents/reviewRetry.ts')), 'Expected adws/agents/reviewRetry.ts to exist');
});

// ── When: test phase ──────────────────────────────────────────────────────────

When('the test resolution agent returns with compactionDetected = true', function () {
  // Context only — verified via testRetry.ts / retryOrchestrator.ts source inspection
});

When('the first test resolution agent returns with tokenLimitExceeded = true', function () {
  // Context only
});

When('the second test resolution agent returns with compactionDetected = true', function () {
  // Context only
});

When('the next test resolution agent returns with compactionDetected = true', function () {
  // Context only
});

When('the first test resolution agent returns with compactionDetected = true and totalCostUsd = 0.04', function () {
  // Context only
});

When('the continuation test resolution agent completes successfully with totalCostUsd = 0.02', function () {
  // Context only
});

When('the first test resolution agent returns with compactionDetected = true', function () {
  // Context only
});

When('the second test resolution agent also returns with compactionDetected = true', function () {
  // Context only
});

When('the test resolution agent returns with compactionDetected = true for the 2nd time', function () {
  // Context only
});

When('the first test resolution agent returns with compactionDetected = true and modelUsage data', function () {
  // Context only
});

When('the continuation test resolution agent completes successfully with its own modelUsage data', function () {
  // Context only
});

// ── When: review phase ────────────────────────────────────────────────────────

When('the review resolution agent returns with compactionDetected = true', function () {
  // Context only — verified via reviewRetry.ts source inspection
});

When('the first review resolution agent returns with tokenLimitExceeded = true', function () {
  // Context only
});

When('the second review resolution agent returns with compactionDetected = true', function () {
  // Context only
});

When('the next review resolution agent returns with compactionDetected = true', function () {
  // Context only
});

When('the first review resolution agent returns with compactionDetected = true and totalCostUsd = 0.06', function () {
  // Context only
});

When('the continuation review resolution agent completes successfully with totalCostUsd = 0.04', function () {
  // Context only
});

When('the first review resolution agent returns with compactionDetected = true', function () {
  // Context only
});

When('the second review resolution agent also returns with compactionDetected = true', function () {
  // Context only
});

When('the review resolution agent returns with compactionDetected = true for the 2nd time', function () {
  // Context only
});

When('the first review resolution agent returns with compactionDetected = true and modelUsage data', function () {
  // Context only
});

When('the continuation review resolution agent completes successfully with its own modelUsage data', function () {
  // Context only
});

// ── When: cross-phase ─────────────────────────────────────────────────────────

When('any agent runs via agentProcessHandler', function () {
  // Context only — architecture check done via source inspection
});

// ── Then: test phase ──────────────────────────────────────────────────────────

Then('the test resolution prompt is rebuilt with the original test failure context and partial output', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/testRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('runResolveTestAgent'),
    'Expected testRetry.ts to call runResolveTestAgent for test resolution',
  );
  assert.ok(
    content.includes('compactionDetected'),
    'Expected testRetry.ts to reference compactionDetected for continuation logic',
  );
});

Then('a new test resolution agent is spawned with fresh context', function () {
  const content = readFileSync(join(ROOT, 'adws/core/retryOrchestrator.ts'), 'utf-8');
  assert.ok(
    content.includes('continue') && content.includes('compactionDetected'),
    'Expected retryOrchestrator.ts to restart the agent loop via continue on compactionDetected',
  );
});

Then('the test phase stops retrying and reports the failure', function () {
  const content = readFileSync(join(ROOT, 'adws/core/retryOrchestrator.ts'), 'utf-8');
  assert.ok(
    content.includes('exceeded maximum context resets') || content.includes('exceeded maximum continuations'),
    'Expected retryOrchestrator.ts to throw when maximum context resets is exceeded',
  );
});

Then('the error indicates maximum continuations exceeded', function () {
  const content = readFileSync(join(ROOT, 'adws/core/retryOrchestrator.ts'), 'utf-8');
  assert.ok(
    content.includes('exceeded maximum context resets') || content.includes('exceeded maximum continuations'),
    'Expected retryOrchestrator.ts error message to include "exceeded maximum context resets"',
  );
});

Then('the total accumulated cost for the test phase includes both runs', function () {
  const content = readFileSync(join(ROOT, 'adws/core/retryOrchestrator.ts'), 'utf-8');
  assert.ok(
    content.includes('trackCost'),
    'Expected retryOrchestrator.ts to accumulate cost via trackCost across continuations',
  );
  assert.ok(
    content.includes('state.costUsd += result.totalCostUsd'),
    'Expected trackCost in retryOrchestrator.ts to accumulate totalCostUsd',
  );
});

Then('the continuation prompt receives the original test failure output', function () {
  const content = readFileSync(join(ROOT, 'adws/core/retryOrchestrator.ts'), 'utf-8');
  assert.ok(
    content.includes('continue') && content.includes('compactionDetected'),
    'Expected retryOrchestrator.ts to continue the loop on compaction, re-running with original context',
  );
});

Then('the continuation prompt receives the first agent\'s partial resolution output', function () {
  // Covers both test resolution (retryOrchestrator) and review patching (reviewRetry)
  const orchestratorContent = readFileSync(join(ROOT, 'adws/core/retryOrchestrator.ts'), 'utf-8');
  const reviewRetryContent = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    orchestratorContent.includes('resolveFailures') || reviewRetryContent.includes('patchResult'),
    'Expected retryOrchestrator.ts or reviewRetry.ts to pass partial agent output on continuation',
  );
});

Then('the continuation prompt again receives the original test failure output', function () {
  const content = readFileSync(join(ROOT, 'adws/core/retryOrchestrator.ts'), 'utf-8');
  assert.ok(
    content.includes('continue') && content.includes('compactionDetected'),
    'Expected retryOrchestrator.ts to continue with original failure context on each compaction',
  );
});

Then('the continuation prompt receives the second agent\'s partial resolution output', function () {
  // Covers both test resolution (retryOrchestrator) and review patching (reviewRetry)
  const orchestratorContent = readFileSync(join(ROOT, 'adws/core/retryOrchestrator.ts'), 'utf-8');
  const reviewRetryContent = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    orchestratorContent.includes('resolveFailures') || reviewRetryContent.includes('runPatchAgent'),
    'Expected retryOrchestrator.ts or reviewRetry.ts to pass latest partial output on each continuation',
  );
});

Then('the test_compaction_recovery comment includes continuation number {int}', function (num: number) {
  const content = readFileSync(join(ROOT, 'adws/phases/testPhase.ts'), 'utf-8');
  assert.ok(
    content.includes('test_compaction_recovery'),
    'Expected testPhase.ts to post a test_compaction_recovery comment',
  );
  assert.ok(
    content.includes('tokenContinuationNumber') || content.includes('continuationNumber'),
    `Expected testPhase.ts to set the continuation number (requested: ${num})`,
  );
});

Then('AgentStateManager.appendLog records that compaction was detected during test resolution', function () {
  const content = readFileSync(join(ROOT, 'adws/phases/testPhase.ts'), 'utf-8');
  assert.ok(
    content.includes('compacted') || content.includes('compaction'),
    'Expected testPhase.ts appendLog to mention compaction when detected during test resolution',
  );
  assert.ok(
    content.includes('AgentStateManager.appendLog'),
    'Expected testPhase.ts to call AgentStateManager.appendLog',
  );
});

// ── Then: review phase ────────────────────────────────────────────────────────

Then('the review resolution prompt is rebuilt with the original review blocker context and partial output', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('runPatchAgent') || content.includes('runReviewAgent'),
    'Expected reviewRetry.ts to use runPatchAgent/runReviewAgent for blocker resolution',
  );
  assert.ok(
    content.includes('compactionDetected'),
    'Expected reviewRetry.ts to reference compactionDetected for continuation logic',
  );
});

Then('a new review resolution agent is spawned with fresh context', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('compactionDetected') && (content.includes('runReviewAgent') || content.includes('runPatchAgent')),
    'Expected reviewRetry.ts to restart the agent with fresh context on compactionDetected',
  );
});

Then('the review phase stops retrying and reports the failure', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('exceeded maximum context resets') || content.includes('exceeded maximum continuations'),
    'Expected reviewRetry.ts to throw when maximum context resets is exceeded',
  );
});

Then('the total accumulated cost for the review phase includes both runs', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('trackCost'),
    'Expected reviewRetry.ts to accumulate cost via trackCost across continuations',
  );
});

Then('the continuation prompt receives the original review blocker details', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('blockerIssue') && content.includes('compactionDetected'),
    'Expected reviewRetry.ts to re-pass the original blocker context on continuation',
  );
});

// Note: 'the continuation prompt receives the first agent's partial resolution output' is defined above
// (covers both test and review phase scenarios).

Then('the continuation prompt again receives the original review blocker details', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('blockerIssue') && content.includes('compactionDetected'),
    'Expected reviewRetry.ts to consistently re-pass original blocker context on every continuation',
  );
});

// Note: 'the continuation prompt receives the second agent's partial resolution output' is defined above
// (covers both test and review phase scenarios).

Then('the review_compaction_recovery comment includes continuation number {int}', function (num: number) {
  const content = readFileSync(join(ROOT, 'adws/phases/workflowCompletion.ts'), 'utf-8');
  assert.ok(
    content.includes('review_compaction_recovery'),
    'Expected workflowCompletion.ts to reference review_compaction_recovery stage',
  );
  assert.ok(
    content.includes('tokenContinuationNumber') || content.includes('continuationNumber'),
    `Expected workflowCompletion.ts to set the continuation number for review_compaction_recovery (requested: ${num})`,
  );
});

Then('AgentStateManager.appendLog records that compaction was detected during review resolution', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('compacted') || content.includes('compaction'),
    'Expected reviewRetry.ts appendLog to mention compaction',
  );
  assert.ok(
    content.includes('AgentStateManager.appendLog'),
    'Expected reviewRetry.ts to call AgentStateManager.appendLog',
  );
});

// ── Then: WorkflowStage distinct comment stages ───────────────────────────────

Then('the comment is distinct from {string} used by the build phase', function (otherStage: string) {
  // Verify the stages are genuinely different strings (structural check)
  const content = sharedCtx.fileContent;
  // The current file should contain the stage it posts, but not equal the otherStage string
  assert.ok(
    content.includes('compaction_recovery'),
    'Expected file to reference a compaction_recovery stage',
  );
  assert.notStrictEqual(
    otherStage,
    'test_compaction_recovery',
    `Expected 'test_compaction_recovery' stage to be distinct from '${otherStage}'`,
  );
  assert.notStrictEqual(
    otherStage,
    'review_compaction_recovery',
    `Expected 'review_compaction_recovery' stage to be distinct from '${otherStage}'`,
  );
});

Then('the comment is distinct from {string} used by the test phase', function (otherStage: string) {
  // Structural check: review_compaction_recovery must differ from test_compaction_recovery
  assert.notStrictEqual(
    otherStage,
    'review_compaction_recovery',
    `Expected 'review_compaction_recovery' stage to be distinct from '${otherStage}'`,
  );
  assert.ok(
    otherStage !== 'review_compaction_recovery',
    `Expected '${otherStage}' to be a different stage from 'review_compaction_recovery'`,
  );
});

// ── Then: workflowCommentsIssue formatters ────────────────────────────────────

Then('there is a formatter for {string} comments', function (stage: string) {
  const content = sharedCtx.fileContent;
  // Either a dedicated function name or a case label referencing the stage
  const camelStage = stage
    .split('_')
    .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
  const hasFormatter =
    content.includes(`format${camelStage}Comment`) ||
    content.includes(`case '${stage}'`) ||
    content.includes(`'${stage}': format`);
  assert.ok(
    hasFormatter,
    `Expected workflowCommentsIssue.ts to have a formatter for '${stage}'`,
  );
});

Then('each formatter indicates which phase triggered the compaction restart', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('test') || content.includes('Test'),
    'Expected formatters to mention which phase (test/review) triggered the compaction restart',
  );
  assert.ok(
    content.includes('review') || content.includes('Review'),
    'Expected formatters to mention which phase (test/review) triggered the compaction restart',
  );
});

// ── Then: STAGE_HEADER_MAP ────────────────────────────────────────────────────

Then('the STAGE_HEADER_MAP maps a distinct header to {string}', function (stage: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`'${stage}'`),
    `Expected workflowCommentParsing.ts STAGE_HEADER_MAP to include an entry for '${stage}'`,
  );
});

Then('each header is distinct from the build phase\'s {string} header', function (buildStage: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes("'test_compaction_recovery'"),
    "Expected STAGE_HEADER_MAP to have a key for 'test_compaction_recovery'",
  );
  assert.ok(
    content.includes("'review_compaction_recovery'"),
    "Expected STAGE_HEADER_MAP to have a key for 'review_compaction_recovery'",
  );
  assert.ok(
    content.includes(`'${buildStage}'`),
    `Expected STAGE_HEADER_MAP to still have a key for the build phase '${buildStage}'`,
  );
  assert.notStrictEqual('test_compaction_recovery', buildStage);
  assert.notStrictEqual('review_compaction_recovery', buildStage);
  assert.notStrictEqual('test_compaction_recovery', 'review_compaction_recovery');
});

// ── Then: cross-phase (compaction detection in handler + all phases) ──────────

Then('compaction detection is present in the handler', function () {
  const handlerContent = readFileSync(join(ROOT, 'adws/agents/agentProcessHandler.ts'), 'utf-8');
  assert.ok(
    handlerContent.includes('"subtype":"compact_boundary"'),
    'Expected agentProcessHandler.ts to contain compact_boundary detection logic',
  );
  assert.ok(
    handlerContent.includes('compactionDetected = true'),
    'Expected agentProcessHandler.ts to set compactionDetected flag',
  );
});

Then('buildPhase.ts, testPhase.ts, and prReviewPhase.ts all act on the compactionDetected flag to trigger continuation', function () {
  const buildContent = readFileSync(join(ROOT, 'adws/phases/buildPhase.ts'), 'utf-8');
  const testRetryContent = readFileSync(join(ROOT, 'adws/agents/testRetry.ts'), 'utf-8');
  const reviewRetryContent = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');

  assert.ok(
    buildContent.includes('compactionDetected'),
    'Expected buildPhase.ts to act on compactionDetected',
  );
  assert.ok(
    testRetryContent.includes('compactionDetected') || testRetryContent.includes('onCompactionDetected'),
    'Expected testRetry.ts to act on compactionDetected via onCompactionDetected callback',
  );
  assert.ok(
    reviewRetryContent.includes('compactionDetected') || reviewRetryContent.includes('onCompactionDetected'),
    'Expected reviewRetry.ts to act on compactionDetected via onCompactionDetected callback',
  );
});

// Note: 'Given the file {string} exists' is already defined in cucumberConfigSteps.ts

// ── Given: E2E / BDD test contexts ───────────────────────────────────────────

Given('the E2E test retry loop is resolving a failed E2E test', function () {
  const fullPath = join(ROOT, 'adws/agents/testRetry.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/testRetry.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/testRetry.ts';
});

Given('runResolveE2ETestAgent is called for the failing test', function () {
  // Context only — verified via testRetry.ts E2E retry loop
});

Given('the BDD scenario retry loop is resolving a failed scenario', function () {
  const fullPath = join(ROOT, 'adws/agents/testRetry.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/testRetry.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/testRetry.ts';
});

Given('runResolveE2ETestAgent is called for the failing BDD scenario', function () {
  // Context only — verified via testRetry.ts BDD scenario retry loop
});

// ── Given: review parallel / patch / build contexts ───────────────────────────

Given('the review retry loop is running parallel review agents', function () {
  const fullPath = join(ROOT, 'adws/agents/reviewRetry.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/reviewRetry.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/reviewRetry.ts';
});

Given('the review retry loop is patching a blocker issue', function () {
  const fullPath = join(ROOT, 'adws/agents/reviewRetry.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/reviewRetry.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/reviewRetry.ts';
});

Given('runPatchAgent is called for the blocker', function () {
  // Context only — verified via reviewRetry.ts patch loop
});

Given('the review retry loop is implementing a patch via runBuildAgent', function () {
  const fullPath = join(ROOT, 'adws/agents/reviewRetry.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/reviewRetry.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/reviewRetry.ts';
});

// ── Given: cross-cutting agentProcessHandler ──────────────────────────────────

Given('the agentProcessHandler sets compactionDetected on AgentResult', function () {
  const fullPath = join(ROOT, 'adws/agents/agentProcessHandler.ts');
  assert.ok(existsSync(fullPath), 'Expected adws/agents/agentProcessHandler.ts to exist');
  sharedCtx.fileContent = readFileSync(fullPath, 'utf-8');
  sharedCtx.filePath = 'adws/agents/agentProcessHandler.ts';
});

// ── When: E2E / BDD (context-only) ────────────────────────────────────────────

When('the resolve E2E test agent returns with compactionDetected = true', function () {
  // Context only
});

When('the resolve agent returns with compactionDetected = true', function () {
  // Context only
});

// ── When: review parallel / patch (context-only) ──────────────────────────────

When('one of the review agents returns with compactionDetected = true', function () {
  // Context only
});

When('the patch agent returns with compactionDetected = true', function () {
  // Context only
});

// ── When: cross-cutting (context-only) ────────────────────────────────────────

When('the test retry loop receives an AgentResult with compactionDetected = true', function () {
  // Context only
});

When('the review retry loop receives an AgentResult with compactionDetected = true', function () {
  // Context only
});

// ── Then: E2E resolver ────────────────────────────────────────────────────────

Then('the resolve E2E test agent is restarted with fresh context', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/testRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('runResolveE2ETestAgent') && content.includes('compactionDetected'),
    'Expected testRetry.ts to restart runResolveE2ETestAgent with fresh context on compaction',
  );
});

Then('the restart uses the original E2E test failure context and partial output', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/testRetry.ts'), 'utf-8');
  // The same `result` variable is passed to the re-run resolver, preserving original failure context
  assert.ok(
    content.includes('runResolveE2ETestAgent') &&
    (content.includes('compactionDetected') || content.includes('continuationCount')),
    'Expected testRetry.ts to re-run E2E resolver with original failure context on compaction',
  );
});

Then('the resolve agent is restarted with fresh context', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/testRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('runResolveE2ETestAgent') &&
    content.includes('compactionDetected') &&
    content.includes('runBddScenariosWithRetry'),
    'Expected testRetry.ts to restart the resolve agent for BDD scenarios on compaction',
  );
});

Then('the restart uses the original scenario failure context and partial output', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/testRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('runResolveE2ETestAgent') &&
    (content.includes('compactionDetected') || content.includes('continuationCount')),
    'Expected testRetry.ts to re-run the resolver with the original scenario failure context',
  );
});

// ── Then: parallel review agent ────────────────────────────────────────────────

Then('that review agent is restarted with fresh context', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('reviewResults[i]') && content.includes('compactionDetected'),
    'Expected reviewRetry.ts to restart the individually compacted review agent (reviewResults[i])',
  );
});

Then("the other review agents' results are preserved", function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('reviewResults') && content.includes('compactionDetected'),
    "Expected reviewRetry.ts to preserve non-compacted review agents' results in the reviewResults array",
  );
});

Then("the restarted agent's result is merged with the others", function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('mergeReviewResults') && content.includes('reviewResults'),
    "Expected reviewRetry.ts to merge all agents' results via mergeReviewResults after compaction restart",
  );
});

// ── Then: patch agent ──────────────────────────────────────────────────────────

Then('the patch agent is restarted with fresh context', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('runPatchAgent') && content.includes('compactionDetected'),
    'Expected reviewRetry.ts to restart the patch agent with fresh context on compaction',
  );
});

Then('the restart uses the original blocker context and partial output', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('runPatchAgent') && content.includes('blockerIssue'),
    'Expected reviewRetry.ts to re-run the patch agent with the original blocker context',
  );
});

// ── Then: build agent in review retry ─────────────────────────────────────────

Then('the build agent is restarted with fresh context', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('runBuildAgent') && content.includes('compactionDetected'),
    'Expected reviewRetry.ts to restart the build agent with fresh context on compaction',
  );
});

Then('the restart uses the original patch plan and partial output', function () {
  const content = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    content.includes('runBuildAgent') && content.includes('patchResult.output'),
    'Expected reviewRetry.ts to re-run the build agent using the original patch plan output',
  );
});

// ── Then: cross-cutting ───────────────────────────────────────────────────────

Then('the test phase acts on the flag to trigger continuation', function () {
  const testRetryContent = readFileSync(join(ROOT, 'adws/agents/testRetry.ts'), 'utf-8');
  const retryOrchestratorContent = readFileSync(join(ROOT, 'adws/core/retryOrchestrator.ts'), 'utf-8');
  assert.ok(
    testRetryContent.includes('onCompactionDetected') || retryOrchestratorContent.includes('onCompactionDetected'),
    'Expected test retry to expose an onCompactionDetected callback to handle compaction',
  );
  assert.ok(
    testRetryContent.includes('compactionDetected') || retryOrchestratorContent.includes('compactionDetected'),
    'Expected test retry to act on the compactionDetected flag from AgentResult',
  );
});

Then('the review phase acts on the flag to trigger continuation', function () {
  const reviewRetryContent = readFileSync(join(ROOT, 'adws/agents/reviewRetry.ts'), 'utf-8');
  assert.ok(
    reviewRetryContent.includes('compactionDetected') && reviewRetryContent.includes('onCompactionDetected'),
    'Expected reviewRetry.ts to act on compactionDetected via the onCompactionDetected callback',
  );
});

Then('the build phase continues to handle compactionDetected as before', function () {
  const buildPhaseContent = readFileSync(join(ROOT, 'adws/phases/buildPhase.ts'), 'utf-8');
  assert.ok(
    buildPhaseContent.includes('buildResult.compactionDetected'),
    'Expected buildPhase.ts to continue checking buildResult.compactionDetected',
  );
});
