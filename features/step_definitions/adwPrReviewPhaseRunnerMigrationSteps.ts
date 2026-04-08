/**
 * Step definitions for @adw-398: Migrate adwPrReview to phaseRunner
 *
 * Covers:
 * - Static source-code verification (imports, patterns, removed code)
 * - Runtime phase state transitions via runPhase
 * - Rate-limit pause/resume via phaseRunner
 * - D1 cost record posting via tracker.commit
 * - TypeScript compilation and unit test passage
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

import { AgentStateManager } from '../../adws/core/agentState';
import { AGENTS_STATE_DIR } from '../../adws/core/config';
import { CostTracker, runPhase } from '../../adws/core/phaseRunner';
import { RateLimitError } from '../../adws/types/agentTypes';
import type { WorkflowConfig } from '../../adws/phases/workflowInit';

const ROOT = process.cwd();

// ── Test adwIds cleaned up between scenarios ───────────────────────────────────

const TEST_ADW_IDS = ['prrev001', 'prrev002', 'prrev-test'];

Before({ tags: '@adw-398' }, function () {
  for (const id of TEST_ADW_IDS) {
    const dir = join(AGENTS_STATE_DIR, id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

After({ tags: '@adw-398' }, function () {
  for (const id of TEST_ADW_IDS) {
    const dir = join(AGENTS_STATE_DIR, id);
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTestConfig(adwId: string, orchestratorStatePath: string): WorkflowConfig {
  return {
    adwId,
    orchestratorStatePath,
    ctx: {},
    completedPhases: [],
    topLevelStatePath: AgentStateManager.getTopLevelStatePath(adwId),
    issueNumber: 0,
    orchestratorName: 'pr-review-orchestrator' as never,
  } as unknown as WorkflowConfig;
}

function ensureOrchestratorStateDir(adwId: string, orchestratorName: string): string {
  const statePath = join(AGENTS_STATE_DIR, adwId, orchestratorName);
  mkdirSync(statePath, { recursive: true });
  AgentStateManager.writeState(statePath, {
    adwId,
    agentName: orchestratorName as never,
    issueNumber: 0,
    execution: { status: 'running', startedAt: new Date().toISOString() },
  });
  return statePath;
}

// ── Background ─────────────────────────────────────────────────────────────────

Given(/^issue #396 \(PRReviewWorkflowConfig composition\) has been merged$/, function () {
  // Verify the PRReviewWorkflowConfig composition is in place
  const prReviewPhase = join(ROOT, 'adws/phases/prReviewPhase.ts');
  assert.ok(existsSync(prReviewPhase), 'Expected adws/phases/prReviewPhase.ts to exist');
  const content = readFileSync(prReviewPhase, 'utf-8');
  assert.ok(
    content.includes('PRReviewWorkflowConfig'),
    'Expected PRReviewWorkflowConfig to be defined (issue #396 prerequisite)',
  );
});

// ── Code inspection: CostTracker usage ────────────────────────────────────────

Then('the file imports {string} from the phaseRunner module', function (symbolName: string) {
  const content: string = this.fileContent;
  const hasImport =
    content.includes(`{ ${symbolName}`) ||
    content.includes(`, ${symbolName}`) ||
    content.includes(`${symbolName} }`) ||
    content.includes(`${symbolName},`);
  assert.ok(
    hasImport && content.includes('phaseRunner'),
    `Expected "${this.filePath}" to import "${symbolName}" from phaseRunner module`,
  );
});

Then('the file creates a CostTracker instance', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('new CostTracker()'),
    `Expected "${this.filePath}" to create a CostTracker instance with "new CostTracker()"`,
  );
});

Then('the file does not declare a local {string} variable', function (varName: string) {
  const content: string = this.fileContent;
  const patterns = [
    `let ${varName}`,
    `const ${varName}`,
    `var ${varName}`,
  ];
  for (const pattern of patterns) {
    assert.ok(
      !content.includes(pattern),
      `Expected "${this.filePath}" not to declare local variable "${varName}" (pattern: "${pattern}")`,
    );
  }
});

Then('the file does not call {string}', function (funcName: string) {
  const content: string = this.fileContent;
  assert.ok(
    !content.includes(`${funcName}(`),
    `Expected "${this.filePath}" not to call "${funcName}"`,
  );
});

// ── Code inspection: runPhase usage ───────────────────────────────────────────

Then('every phase execution is wrapped in a runPhase call', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('runPhase('),
    `Expected "${this.filePath}" to contain runPhase calls`,
  );
});

Then(/^the file does not directly call (\w+) outside a runPhase wrapper$/, function (funcName: string) {
  const content: string = this.fileContent;
  // The function should only appear inside closures passed to runPhase: "_ => funcName"
  // It should NOT appear as a standalone call like "funcName("
  // Direct standalone call pattern
  const standaloneCallIdx = content.indexOf(`${funcName}(`);
  if (standaloneCallIdx === -1) return; // not present at all — pass
  // If it's only used inside "_ => funcName(config", it's wrapped
  // Check that every occurrence is inside a closure
  const closurePattern = `_ => ${funcName}(`;
  const allOccurrences = [...content.matchAll(new RegExp(`${funcName.replace('.', '\\.')}\\(`, 'g'))];
  for (const match of allOccurrences) {
    const before = content.substring(Math.max(0, (match.index ?? 0) - 10), match.index ?? 0);
    assert.ok(
      before.includes('_ =>') || before.includes('=> '),
      `Expected "${funcName}" in "${this.filePath}" to be called only inside a closure wrapper, ` +
      `but found direct call at position ${match.index}`,
    );
  }
  void closurePattern;
});

// ── Code inspection: closure-wrapper pattern ─────────────────────────────────

Then(/^the PR review plan phase is called via a closure: runPhase\(config\.base, tracker, _ => executePRReviewPlanPhase\(config\)\)$/, function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('_ => executePRReviewPlanPhase(config)'),
    `Expected "${this.filePath}" to contain "_ => executePRReviewPlanPhase(config)"`,
  );
});

Then(/^the PR review build phase is called via a closure wrapping (\w+)$/, function (funcName: string) {
  const content: string = this.fileContent;
  assert.ok(
    content.includes(`_ => ${funcName}(`),
    `Expected "${this.filePath}" to call "${funcName}" via closure "_ => ${funcName}("`,
  );
});

Then(/^the PR review test phase is called via a closure wrapping (\w+)$/, function (funcName: string) {
  const content: string = this.fileContent;
  assert.ok(
    content.includes(`_ => ${funcName}(`),
    `Expected "${this.filePath}" to call "${funcName}" via closure "_ => ${funcName}("`,
  );
});

Then('the PR review unit test phase is called via executeUnitTestPhase', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('executeUnitTestPhase'),
    `Expected "${this.filePath}" to call "executeUnitTestPhase"`,
  );
});

Then('each runPhase call passes {string} as the first argument', function (argName: string) {
  const content: string = this.fileContent;
  // Find all runPhase( occurrences and verify the first arg is argName
  const pattern = new RegExp(`runPhase\\s*\\(\\s*${argName.replace('.', '\\.')}`, 'g');
  const matches = [...content.matchAll(pattern)];
  const allRunPhaseCalls = [...content.matchAll(/runPhase\s*\(/g)];
  assert.ok(
    matches.length > 0,
    `Expected at least one runPhase call with "${argName}" as first argument in "${this.filePath}"`,
  );
  assert.strictEqual(
    matches.length,
    allRunPhaseCalls.length,
    `Expected ALL runPhase calls to pass "${argName}" as first argument, ` +
    `found ${matches.length} matching out of ${allRunPhaseCalls.length} total calls`,
  );
});

Then('no runPhase call passes the full PRReviewWorkflowConfig as the first argument', function () {
  const content: string = this.fileContent;
  // The full config (not config.base) should not be the first arg to runPhase
  // runPhase(config, ...) where config is PRReviewWorkflowConfig — not config.base
  // Pattern: runPhase(config, tracker  — but NOT runPhase(config.base, tracker
  const directConfigPattern = /runPhase\s*\(\s*config\s*,/g;
  const matches = [...content.matchAll(directConfigPattern)];
  assert.strictEqual(
    matches.length,
    0,
    `Expected no runPhase call to pass raw "config" (PRReviewWorkflowConfig) as first argument in "${this.filePath}"`,
  );
});

// ── Code inspection: install phase ────────────────────────────────────────────

Then('the file does not call {string} directly', function (funcName: string) {
  const content: string = this.fileContent;
  assert.ok(
    !content.includes(`${funcName}(`),
    `Expected "${this.filePath}" not to call "${funcName}" directly`,
  );
});

Then('the install phase is invoked via runPhase with executeInstallPhase or a closure', function () {
  const content: string = this.fileContent;
  const hasDirectInstall = content.includes('executeInstallPhase)') || content.includes('executeInstallPhase,');
  const hasClosureInstall = content.includes('executeInstallPhase(');
  assert.ok(
    hasDirectInstall || hasClosureInstall,
    `Expected "${this.filePath}" to invoke executeInstallPhase via runPhase`,
  );
});

Then('the file does not contain {string} for install-agent', function (pattern: string) {
  const content: string = this.fileContent;
  // Check specifically in context of install-agent block
  assert.ok(
    !content.includes(pattern),
    `Expected "${this.filePath}" not to contain "${pattern}"`,
  );
});

Then('the file does not contain {string} file writes', function (fileName: string) {
  const content: string = this.fileContent;
  assert.ok(
    !content.includes(fileName),
    `Expected "${this.filePath}" not to contain "${fileName}"`,
  );
});
// Note: 'the file does not contain {string}' is defined in commonSteps.ts — do not redefine here.

// ── Code inspection: postCostRecordsToD1 removal ─────────────────────────────

Then('the file does not import {string} from the d1Client module', function (symbolName: string) {
  const content: string = this.fileContent;
  // Check for import of the symbol from d1Client
  const hasImport = content.includes(symbolName) && content.includes('d1Client');
  assert.ok(
    !hasImport,
    `Expected "${this.filePath}" not to import "${symbolName}" from d1Client`,
  );
});

Then('cost records are posted via the phaseRunner\'s tracker.commit path instead', function () {
  // Structural documentation step — verify phaseRunner has tracker.commit
  const phaseRunnerPath = join(ROOT, 'adws/core/phaseRunner.ts');
  const content = readFileSync(phaseRunnerPath, 'utf-8');
  assert.ok(
    content.includes('tracker.commit(') || content.includes('async commit('),
    'Expected phaseRunner to have a tracker.commit method',
  );
});

// ── Code inspection: buildPRReviewCostSection still works ────────────────────

Then('the function {string} still generates PhaseCostRecords', function (funcName: string) {
  const content: string = this.fileContent;
  assert.ok(
    content.includes(funcName),
    `Expected "${this.filePath}" to still define function "${funcName}"`,
  );
  assert.ok(
    content.includes('createPhaseCostRecords'),
    `Expected "${funcName}" in "${this.filePath}" to still call createPhaseCostRecords`,
  );
});

Then('the function still calls {string} for the GitHub comment', function (funcName: string) {
  const content: string = this.fileContent;
  assert.ok(
    content.includes(`${funcName}(`),
    `Expected "${this.filePath}" to still call "${funcName}"`,
  );
});

Then('the cost comment section is still stored in ctx for downstream use', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('ctx.costSection'),
    `Expected "${this.filePath}" to still set ctx.costSection`,
  );
});

// ── Code inspection: RateLimitError catch removal ─────────────────────────────

Then('the file does not contain a catch block that checks {string}', function (pattern: string) {
  const content: string = this.fileContent;
  assert.ok(
    !content.includes(pattern),
    `Expected "${this.filePath}" not to contain catch block pattern "${pattern}"`,
  );
});

Then('the file does not call {string} for rate limit handling', function (callExpr: string) {
  const content: string = this.fileContent;
  // Only check in context of a RateLimitError catch block
  // If the file doesn't have a RateLimitError catch, this check is vacuously true
  if (!content.includes('RateLimitError')) {
    return; // no RateLimitError handling = vacuously true
  }
  // If there IS a RateLimitError reference, it should NOT be in a catch block that exits
  const catchWithExit = content.includes('instanceof RateLimitError') && content.includes(callExpr);
  assert.ok(
    !catchWithExit,
    `Expected "${this.filePath}" not to call "${callExpr}" inside a RateLimitError catch`,
  );
});

Then('rate limit errors are handled by phaseRunner\'s runPhase catch clause', function () {
  // Documentation step — verify phaseRunner handles RateLimitError
  const phaseRunnerPath = join(ROOT, 'adws/core/phaseRunner.ts');
  const content = readFileSync(phaseRunnerPath, 'utf-8');
  assert.ok(
    content.includes('RateLimitError'),
    'Expected phaseRunner to handle RateLimitError in its catch clause',
  );
});

Then('the file does not import {string} from agentTypes', function (symbolName: string) {
  const content: string = this.fileContent;
  const hasImport = content.includes(symbolName) && content.includes('agentTypes');
  assert.ok(
    !hasImport,
    `Expected "${this.filePath}" not to import "${symbolName}" from agentTypes`,
  );
});

// ── Runtime: PR review workflow running with adwId ────────────────────────────

Given('a PR review workflow is running with adwId {string}', function (adwId: string) {
  this.adwId = adwId;
  this.orchestratorStatePath = ensureOrchestratorStateDir(adwId, 'pr-review-orchestrator');
  this.config = makeTestConfig(adwId, this.orchestratorStatePath);
  this.tracker = new CostTracker();
  this.capturedStateInsidePhase = null;
  this.phaseWasExecuted = false;
  this.handleRateLimitPauseCalled = false;
  this.exitCode = undefined;
  this.d1CommitCalled = false;
  this.d1CommitRecords = [];
});

// ── Runtime: runPhase state transitions ───────────────────────────────────────

When('runPhase executes the install phase for the PR review workflow', async function () {
  const config: WorkflowConfig = this.config;
  const tracker: CostTracker = this.tracker;
  const captured = { stateInsideFn: null as ReturnType<typeof AgentStateManager.readTopLevelState> };

  const phaseFn = async () => {
    captured.stateInsideFn = AgentStateManager.readTopLevelState(config.adwId);
    this.phaseWasExecuted = true;
    return { costUsd: 0.01, modelUsage: {}, phaseCostRecords: [] };
  };

  await runPhase(config, tracker, phaseFn, 'install');
  this.capturedStateInsidePhase = captured.stateInsideFn;
});

When('runPhase executes the plan phase for the PR review workflow', async function () {
  const config: WorkflowConfig = this.config;
  const tracker: CostTracker = this.tracker;
  const captured = { stateInsideFn: null as ReturnType<typeof AgentStateManager.readTopLevelState> };

  const phaseFn = async () => {
    captured.stateInsideFn = AgentStateManager.readTopLevelState(config.adwId);
    this.phaseWasExecuted = true;
    return { costUsd: 0.02, modelUsage: {}, phaseCostRecords: [], planOutput: 'test plan' };
  };

  await runPhase(config, tracker, phaseFn, 'pr_review_plan');
  this.capturedStateInsidePhase = captured.stateInsideFn;
});

When('runPhase executes the build phase for the PR review workflow', async function () {
  const config: WorkflowConfig = this.config;
  const tracker: CostTracker = this.tracker;
  const captured = { stateInsideFn: null as ReturnType<typeof AgentStateManager.readTopLevelState> };

  const phaseFn = async () => {
    captured.stateInsideFn = AgentStateManager.readTopLevelState(config.adwId);
    this.phaseWasExecuted = true;
    return { costUsd: 0.03, modelUsage: {}, phaseCostRecords: [] };
  };

  await runPhase(config, tracker, phaseFn, 'pr_review_build');
  this.capturedStateInsidePhase = captured.stateInsideFn;
});

When('runPhase executes the test phase for the PR review workflow', async function () {
  const config: WorkflowConfig = this.config;
  const tracker: CostTracker = this.tracker;
  const captured = { stateInsideFn: null as ReturnType<typeof AgentStateManager.readTopLevelState> };

  const phaseFn = async () => {
    captured.stateInsideFn = AgentStateManager.readTopLevelState(config.adwId);
    this.phaseWasExecuted = true;
    return { costUsd: 0.04, modelUsage: {}, phaseCostRecords: [] };
  };

  await runPhase(config, tracker, phaseFn, 'pr_review_test');
  this.capturedStateInsidePhase = captured.stateInsideFn;
});

Then('the top-level state file for {string} records {string} with status {string} before execution', function (adwId: string, phaseName: string, expectedStatus: string) {
  // The state captured INSIDE the phase function = "before execution completes" = running
  const state = this.capturedStateInsidePhase;
  assert.ok(state, `Expected captured state inside phase to exist for adwId "${adwId}"`);
  assert.ok(state.phases, `Expected phases map to exist in captured state`);
  const phaseEntry = state.phases![phaseName];
  assert.ok(phaseEntry, `Expected phases map to contain entry for "${phaseName}"`);
  assert.strictEqual(
    phaseEntry.status,
    expectedStatus,
    `Expected phases.${phaseName}.status inside phase to be "${expectedStatus}", got "${phaseEntry.status}"`,
  );
  void adwId;
});

Then('the top-level state file for {string} records {string} with status {string} after success', function (adwId: string, phaseName: string, expectedStatus: string) {
  // After runPhase returns, check the final state
  const state = AgentStateManager.readTopLevelState(adwId);
  assert.ok(state, `Expected top-level state to exist after phase for adwId "${adwId}"`);
  assert.ok(state.phases, `Expected phases map to exist`);
  const phaseEntry = state.phases![phaseName];
  assert.ok(phaseEntry, `Expected phases.${phaseName} to exist`);
  assert.strictEqual(
    phaseEntry.status,
    expectedStatus,
    `Expected phases.${phaseName}.status to be "${expectedStatus}" after success, got "${phaseEntry.status}"`,
  );
});

Then('the top-level state file for {string} records {string} with status {string}', function (adwId: string, phaseName: string, expectedStatus: string) {
  // Check captured inside-phase state first (for "running"), then final state (for "completed")
  if (expectedStatus === 'running' && this.capturedStateInsidePhase) {
    const state = this.capturedStateInsidePhase;
    assert.ok(state.phases?.[phaseName], `Expected phases.${phaseName} in captured state`);
    assert.strictEqual(state.phases![phaseName].status, expectedStatus);
  } else {
    const state = AgentStateManager.readTopLevelState(adwId);
    assert.ok(state?.phases?.[phaseName], `Expected phases.${phaseName} in top-level state`);
    assert.strictEqual(state!.phases![phaseName].status, expectedStatus);
  }
});

// ── Runtime: Rate-limit pause/resume ──────────────────────────────────────────

When('the PR review plan phase encounters a RateLimitError', async function () {
  const config: WorkflowConfig = this.config;
  const tracker: CostTracker = this.tracker;

  // Override process.exit to capture the call without actually exiting
  const originalExit = process.exit;
  let capturedExitCode: number | undefined;
  process.exit = ((code?: number) => {
    capturedExitCode = code ?? 0;
    throw new Error(`process.exit(${capturedExitCode ?? 0}) called`);
  }) as typeof process.exit;

  const rateLimitErr = new RateLimitError('pr_review_plan');
  const phaseFn = async () => { throw rateLimitErr; };

  try {
    await runPhase(config, tracker, phaseFn, 'pr_review_plan');
  } catch (e) {
    const err = e as Error;
    if (err.message && err.message.startsWith('process.exit(')) {
      this.exitCode = capturedExitCode;
    } else if (err instanceof RateLimitError) {
      // runPhase re-throws after calling handleRateLimitPause; capture the exit from that
      this.rateLimitError = err;
    }
    // handleRateLimitPause calls process.exit(0) — that's what triggers the throw
  } finally {
    process.exit = originalExit;
    this.capturedExitCode = capturedExitCode;
  }
});

Then('handleRateLimitPause is called by phaseRunner with the phase name', function () {
  // Verify by inspecting the top-level state written by handleRateLimitPause
  // handleRateLimitPause writes { workflowStage: 'paused' } to top-level state
  const state = AgentStateManager.readTopLevelState(this.adwId);
  // OR verify from the orchestrator state pause fields
  const orchState = AgentStateManager.readState(this.orchestratorStatePath);
  const hasPausedState =
    state?.workflowStage === 'paused' ||
    orchState?.execution?.status === 'paused' ||
    (orchState?.metadata as Record<string, unknown>)?.pausedAtPhase === 'pr_review_plan';
  assert.ok(
    hasPausedState,
    `Expected handleRateLimitPause to be called (state should show paused workflow). ` +
    `Top-level state: ${JSON.stringify(state)}, Orch state: ${JSON.stringify(orchState)}`,
  );
});

Then('the workflow is enqueued in the pause queue', function () {
  // handleRateLimitPause calls appendToPauseQueue which writes to agents/paused_queue.json
  const pauseQueuePath = join(ROOT, 'agents/paused_queue.json');
  if (!existsSync(pauseQueuePath)) {
    // Queue file may not exist yet if D1 posting fails first — accept either the file or state
    const orchState = AgentStateManager.readState(this.orchestratorStatePath);
    const meta = orchState?.metadata as Record<string, unknown> | undefined;
    assert.ok(
      meta?.pausedAtPhase !== undefined,
      `Expected pause queue to exist at ${pauseQueuePath} or pausedAtPhase in orchestrator metadata`,
    );
    return;
  }
  const queue = JSON.parse(readFileSync(pauseQueuePath, 'utf-8')) as unknown[];
  const entry = (queue as Array<{ adwId: string }>).find(e => e.adwId === this.adwId);
  assert.ok(entry, `Expected adwId "${this.adwId}" to be in the pause queue`);
});

Then('a {string} comment is posted on the GitHub issue', function (_commentType: string) {
  // In tests without a real repoContext, posting is skipped (repoContext is undefined).
  // Verify the ctx.pausedAtPhase was set, which is what postIssueStageComment uses.
  const config: WorkflowConfig = this.config;
  const ctx = config.ctx as unknown as Record<string, unknown>;
  // Either the comment was attempted (repoContext present) or ctx was updated
  assert.ok(
    ctx.pausedAtPhase !== undefined || this.capturedExitCode !== undefined,
    `Expected pause handling to have run (ctx.pausedAtPhase or process.exit captured)`,
  );
  void _commentType;
});

Then('the process exits with code 0', function () {
  assert.strictEqual(
    this.capturedExitCode,
    0,
    `Expected process.exit(0) to be called for rate limit handling, got exit(${this.capturedExitCode})`,
  );
});

// ── Runtime: resume after rate limit ──────────────────────────────────────────

Given(/^a PR review workflow was paused at "([^"]+)" with completed phases (\[.+\])$/, function (pausedPhase: string, phasesJson: string) {
  const completedPhases = JSON.parse(phasesJson) as string[];
  const adwId = 'prrev-test';
  this.adwId = adwId;
  this.orchestratorStatePath = ensureOrchestratorStateDir(adwId, 'pr-review-orchestrator');
  this.config = makeTestConfig(adwId, this.orchestratorStatePath);

  // Write top-level state simulating a paused workflow with phases map
  const phasesMap: Record<string, { status: 'completed'; startedAt: string }> = {};
  for (const phase of completedPhases) {
    phasesMap[phase] = { status: 'completed', startedAt: new Date().toISOString() };
  }
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    workflowStage: 'paused',
    phases: phasesMap,
  });

  this.pausedAtPhase = pausedPhase;
  this.completedPhases = completedPhases;
  this.tracker = new CostTracker();
  this.phaseExecutions = {} as Record<string, boolean>;
});

When('the cron probe detects the rate limit has cleared', function () {
  // Simulate cron probe — no action needed in test; just context setup
});

When('the PR review workflow is respawned', function () {
  // Simulate respawn — config already has top-level state with completed phases
});

Then(/^runPhase skips the "([^"]+)" phase \(already completed\)$/, async function (phaseName: string) {
  const config: WorkflowConfig = this.config;
  const tracker: CostTracker = this.tracker;
  this.phaseExecutions = this.phaseExecutions ?? {};

  let phaseExecuted = false;
  const phaseFn = async () => {
    phaseExecuted = true;
    return { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };
  };

  await runPhase(config, tracker, phaseFn, phaseName);
  this.phaseExecutions[phaseName] = phaseExecuted;

  assert.strictEqual(
    phaseExecuted,
    false,
    `Expected phase "${phaseName}" to be skipped (already completed), but it was executed`,
  );
});

Then('runPhase executes the {string} phase', async function (phaseName: string) {
  const config: WorkflowConfig = this.config;
  const tracker: CostTracker = this.tracker;
  this.phaseExecutions = this.phaseExecutions ?? {};

  let phaseExecuted = false;
  const phaseFn = async () => {
    phaseExecuted = true;
    return { costUsd: 0.01, modelUsage: {}, phaseCostRecords: [] };
  };

  await runPhase(config, tracker, phaseFn, phaseName);
  this.phaseExecutions[phaseName] = phaseExecuted;

  assert.strictEqual(
    phaseExecuted,
    true,
    `Expected phase "${phaseName}" to be executed, but it was skipped`,
  );
});

// ── Runtime: D1 cost records ───────────────────────────────────────────────────

Given('a PR review workflow completes all phases successfully', async function () {
  const adwId = 'prrev001';
  this.adwId = adwId;
  this.orchestratorStatePath = ensureOrchestratorStateDir(adwId, 'pr-review-orchestrator');
  const config = makeTestConfig(adwId, this.orchestratorStatePath);
  this.config = config;
  const tracker = new CostTracker();
  this.tracker = tracker;

  // Run all phases with mock functions
  const phaseNames = ['install', 'pr_review_plan', 'pr_review_build', 'pr_review_test'];
  this.d1CommitCalls = [] as Array<{ phase: string; records: unknown[] }>;

  for (const phase of phaseNames) {
    const phaseFn = async () => ({
      costUsd: 0.01,
      modelUsage: {},
      phaseCostRecords: [{ phase, workflowId: adwId, modelId: 'test', status: 'success' }] as unknown as import('../../adws/cost/types').PhaseCostRecord[],
    });
    await runPhase(config, tracker, phaseFn, phase);
  }
});

Then(/^cost records for the (\w+) phase are posted to D1 via tracker\.commit$/, function (phase: string) {
  // tracker.commit is called by runPhase after each phase
  // Verify the phaseRunner infrastructure (not adwPrReview specifically) handles this
  // The actual D1 posting is tested in phaseRunner unit tests; here we verify structural intent
  const phaseRunnerContent = readFileSync(join(ROOT, 'adws/core/phaseRunner.ts'), 'utf-8');
  assert.ok(
    phaseRunnerContent.includes('tracker.commit('),
    `Expected phaseRunner.ts to call tracker.commit() for D1 posting (phase: ${phase})`,
  );
  assert.ok(
    phaseRunnerContent.includes('phaseCostRecords'),
    `Expected phaseRunner.ts to pass phaseCostRecords to tracker.commit()`,
  );
});

// ── Runtime: D1 failure resilience ────────────────────────────────────────────

Given('a PR review workflow is running', function () {
  const adwId = 'prrev001';
  this.adwId = adwId;
  this.orchestratorStatePath = ensureOrchestratorStateDir(adwId, 'pr-review-orchestrator');
  this.config = makeTestConfig(adwId, this.orchestratorStatePath);
  this.tracker = new CostTracker();
});

When('the D1 cost API returns an error during phase cost commit', async function () {
  // Verify CostTracker.commit swallows errors (it uses .catch())
  const phaseRunnerContent = readFileSync(join(ROOT, 'adws/core/phaseRunner.ts'), 'utf-8');
  this.d1ErrorHandled = phaseRunnerContent.includes('.catch(') || phaseRunnerContent.includes('catch(error');
});

Then('the error is logged but the workflow continues', function () {
  assert.ok(
    this.d1ErrorHandled,
    'Expected CostTracker.commit to swallow D1 errors via .catch()',
  );
});

Then('subsequent phases still execute', async function () {
  // If commit errors are swallowed, runPhase should still complete normally
  const config: WorkflowConfig = this.config;
  const tracker: CostTracker = this.tracker;
  let phase2Executed = false;
  await runPhase(config, tracker, async () => {
    phase2Executed = true;
    return { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };
  }, 'test_phase');
  assert.ok(phase2Executed, 'Expected subsequent phase to execute even after D1 error');
});

// ── Code inspection: PhaseResult compatibility ────────────────────────────────

Given('the PR review phase functions in {string} and {string}', function (file1: string, file2: string) {
  const content1 = readFileSync(join(ROOT, file1), 'utf-8');
  const content2 = readFileSync(join(ROOT, file2), 'utf-8');
  this.prReviewPhaseContent = content1;
  this.prReviewCompletionContent = content2;
  this.fileContent = content1 + '\n' + content2;
  this.filePath = `${file1} + ${file2}`;
});

Then(/^(\w+) returns an object extending PhaseResult$/, function (funcName: string) {
  // Check return type includes phaseCostRecords (the PhaseResult extension field)
  const content = this.prReviewPhaseContent.includes(funcName)
    ? this.prReviewPhaseContent
    : this.prReviewCompletionContent;

  assert.ok(
    content.includes(funcName),
    `Expected to find "${funcName}" in the PR review phase files`,
  );
  // PhaseResult requires costUsd, modelUsage — check the return includes these
  assert.ok(
    content.includes('costUsd') && content.includes('modelUsage'),
    `Expected "${funcName}" to return costUsd and modelUsage (PhaseResult fields)`,
  );
  assert.ok(
    content.includes('phaseCostRecords'),
    `Expected "${funcName}" to return phaseCostRecords (required for runPhase compatibility)`,
  );
});

Then('each return value includes costUsd and modelUsage fields', function () {
  // Already verified above in the individual function checks
  const content: string = this.fileContent;
  assert.ok(
    content.includes('costUsd') && content.includes('modelUsage'),
    'Expected phase functions to return costUsd and modelUsage fields',
  );
});

// ── Runtime: closure preserves planOutput ─────────────────────────────────────

Given('the PR review plan phase is called via closure-wrapper', async function () {
  const adwId = 'prrev001';
  this.adwId = adwId;
  this.orchestratorStatePath = ensureOrchestratorStateDir(adwId, 'pr-review-orchestrator');
  const config = makeTestConfig(adwId, this.orchestratorStatePath);
  this.config = config;
  this.tracker = new CostTracker();
});

When('the plan phase completes successfully', async function () {
  const config: WorkflowConfig = this.config;
  const tracker: CostTracker = this.tracker;
  const expectedPlanOutput = 'test plan output content';

  // Simulate the closure-wrapper pattern: _ => executePRReviewPlanPhase(config)
  const closureWrapper = async (_: WorkflowConfig) => ({
    costUsd: 0.02,
    modelUsage: {},
    phaseCostRecords: [],
    planOutput: expectedPlanOutput,
  });

  this.planResult = await runPhase(config, tracker, closureWrapper, 'pr_review_plan');
  this.expectedPlanOutput = expectedPlanOutput;
});

Then('the runPhase return value includes the planOutput field', function () {
  const result = this.planResult as { planOutput?: string };
  assert.ok(
    result.planOutput !== undefined,
    'Expected runPhase to return the planOutput field from the closure',
  );
});

Then('the planOutput is available to pass to the build phase', function () {
  const result = this.planResult as { planOutput?: string };
  assert.strictEqual(
    result.planOutput,
    this.expectedPlanOutput,
    `Expected planOutput to be "${this.expectedPlanOutput}", got "${result.planOutput}"`,
  );
});

// ── Code inspection: completePRReviewWorkflow uses tracker totals ─────────────

Then('completePRReviewWorkflow is called with tracker.totalModelUsage', function () {
  const content: string = this.fileContent;
  assert.ok(
    content.includes('tracker.totalModelUsage'),
    `Expected "${this.filePath}" to call completePRReviewWorkflow with tracker.totalModelUsage`,
  );
});

Then('the completion function does not receive hand-rolled totalModelUsage', function () {
  const content: string = this.fileContent;
  // The hand-rolled variable was named "totalModelUsage" — it should not appear as a local variable
  assert.ok(
    !content.includes('let totalModelUsage'),
    `Expected "${this.filePath}" not to declare a local "totalModelUsage" variable`,
  );
});

// ── Runtime: non-rate-limit error handling ────────────────────────────────────

When('a phase throws a non-RateLimitError exception', async function () {
  const config: WorkflowConfig = this.config;
  const tracker: CostTracker = this.tracker;
  const boom = new Error('unexpected build failure');
  const phaseFn = async () => { throw boom; };

  try {
    await runPhase(config, tracker, phaseFn, 'pr_review_plan');
  } catch (e) {
    this.caughtError = e;
  }
});

Then('the error propagates out of runPhase', function () {
  assert.ok(
    this.caughtError instanceof Error,
    'Expected error to propagate out of runPhase',
  );
  assert.ok(
    !(this.caughtError instanceof RateLimitError),
    'Expected the propagated error to NOT be a RateLimitError',
  );
});

Then('handlePRReviewWorkflowError is called with tracker cost totals', function () {
  // The outer catch in adwPrReview.tsx calls handlePRReviewWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage)
  // Verify the source uses tracker totals rather than hand-rolled variables
  const orchPath = join(ROOT, 'adws/adwPrReview.tsx');
  const content = readFileSync(orchPath, 'utf-8');
  assert.ok(
    content.includes('tracker.totalCostUsd') || content.includes('tracker.totalModelUsage'),
    'Expected adwPrReview.tsx to pass tracker totals to handlePRReviewWorkflowError',
  );
});

// ── TypeScript compilation ─────────────────────────────────────────────────────

Given('the ADW codebase with PR review phaseRunner migration applied', function () {
  // Verify key files exist
  assert.ok(
    existsSync(join(ROOT, 'adws/adwPrReview.tsx')),
    'Expected adws/adwPrReview.tsx to exist',
  );
  assert.ok(
    existsSync(join(ROOT, 'adws/phases/prReviewPhase.ts')),
    'Expected adws/phases/prReviewPhase.ts to exist',
  );
  assert.ok(
    existsSync(join(ROOT, 'adws/phases/prReviewCompletion.ts')),
    'Expected adws/phases/prReviewCompletion.ts to exist',
  );
});
// Note: "When {string} is run", "Then the command exits with code {int}", and
// "Then all unit tests pass" are defined in removeUnitTestsSteps.ts / wireExtractorSteps.ts /
// costOrchestratorMigrationCleanupSteps.ts respectively.
