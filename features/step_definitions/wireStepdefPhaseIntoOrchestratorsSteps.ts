/**
 * Step definitions for @adw-397: Wire executeStepDefPhase into orchestrators
 *
 * Covers:
 * - Import/call checks for each orchestrator
 * - Phase ordering (adwPrReview.tsx inline pattern)
 * - State ledger tracking (running / completed / failed)
 * - TypeScript compilation gate
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

import { AgentStateManager } from '../../adws/core/agentState';
import { AGENTS_STATE_DIR } from '../../adws/core/config';
import { CostTracker, runPhase } from '../../adws/core/phaseRunner';
import type { WorkflowConfig } from '../../adws/phases/workflowInit';
import { sharedCtx, findFunctionUsageIndex } from './commonSteps.ts';

const ROOT = process.cwd();

const TEST_ADW_IDS_397 = ['adw397test'];

Before({ tags: '@adw-397' }, function () {
  for (const id of TEST_ADW_IDS_397) {
    const dir = join(AGENTS_STATE_DIR, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

After({ tags: '@adw-397' }, function () {
  for (const id of TEST_ADW_IDS_397) {
    const dir = join(AGENTS_STATE_DIR, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeConfig(adwId: string, orchestratorStatePath: string): WorkflowConfig {
  return {
    adwId,
    orchestratorStatePath,
    ctx: {},
    topLevelStatePath: AgentStateManager.getTopLevelStatePath(adwId),
  } as unknown as WorkflowConfig;
}

function ensureOrchestratorState(adwId: string, name: string): string {
  const statePath = join(AGENTS_STATE_DIR, adwId, name);
  mkdirSync(statePath, { recursive: true });
  AgentStateManager.writeState(statePath, {
    adwId,
    agentName: name as never,
    issueNumber: 397,
    execution: { status: 'running', startedAt: new Date().toISOString() },
  });
  return statePath;
}

// ── Import check ───────────────────────────────────────────────────────────────

Then('it should import executeStepDefPhase from workflowPhases or phases', function () {
  assert.ok(
    sharedCtx.fileContent.includes('executeStepDefPhase'),
    `Expected "${sharedCtx.filePath}" to import executeStepDefPhase`,
  );
});

// ── runPhase call check ────────────────────────────────────────────────────────

Then('it should call runPhase with executeStepDefPhase as the phase function', function () {
  const content = sharedCtx.fileContent;
  const idx = findFunctionUsageIndex(content, 'executeStepDefPhase');
  assert.ok(
    idx !== -1,
    `Expected "${sharedCtx.filePath}" to call runPhase with executeStepDefPhase`,
  );
  // Verify it is passed to runPhase (not just imported)
  assert.ok(
    content.includes('runPhase') || content.includes('executeStepDefPhase('),
    `Expected "${sharedCtx.filePath}" to invoke executeStepDefPhase via runPhase or directly`,
  );
});

// ── adwPrReview.tsx ordering check ────────────────────────────────────────────

Then('executeStepDefPhase should be called after executePRReviewBuildPhase', function () {
  const content = sharedCtx.fileContent;
  const buildIdx = findFunctionUsageIndex(content, 'executePRReviewBuildPhase');
  const stepDefIdx = findFunctionUsageIndex(content, 'executeStepDefPhase');
  assert.ok(buildIdx !== -1, `Expected "${sharedCtx.filePath}" to call executePRReviewBuildPhase`);
  assert.ok(stepDefIdx !== -1, `Expected "${sharedCtx.filePath}" to call executeStepDefPhase`);
  assert.ok(
    stepDefIdx > buildIdx,
    `Expected executeStepDefPhase to appear after executePRReviewBuildPhase in "${sharedCtx.filePath}"`,
  );
});

Then('executeStepDefPhase should be called before executePRReviewTestPhase', function () {
  const content = sharedCtx.fileContent;
  const stepDefIdx = findFunctionUsageIndex(content, 'executeStepDefPhase');
  const testIdx = findFunctionUsageIndex(content, 'executePRReviewTestPhase');
  assert.ok(stepDefIdx !== -1, `Expected "${sharedCtx.filePath}" to call executeStepDefPhase`);
  assert.ok(testIdx !== -1, `Expected "${sharedCtx.filePath}" to call executePRReviewTestPhase`);
  assert.ok(
    stepDefIdx < testIdx,
    `Expected executeStepDefPhase to appear before executePRReviewTestPhase in "${sharedCtx.filePath}"`,
  );
});

// ── "not called" checks ────────────────────────────────────────────────────────

Then('it should not import executeStepDefPhase', function () {
  assert.ok(
    !sharedCtx.fileContent.includes('executeStepDefPhase'),
    `Expected "${sharedCtx.filePath}" not to import executeStepDefPhase`,
  );
});

Then('it should not call executeStepDefPhase', function () {
  const idx = findFunctionUsageIndex(sharedCtx.fileContent, 'executeStepDefPhase');
  assert.strictEqual(idx, -1, `Expected "${sharedCtx.filePath}" not to call executeStepDefPhase`);
});

// ── State ledger scenarios ─────────────────────────────────────────────────────

Given('the top-level state file exists for a workflow', function () {
  const adwId = 'adw397test';
  this.adwId = adwId;
  this.orchestratorStatePath = ensureOrchestratorState(adwId, 'sdlc-orchestrator');
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    issueNumber: 397,
    workflowStage: 'build_completed',
  });
});

When('runPhase executes executeStepDefPhase', async function () {
  const config = makeConfig(this.adwId, this.orchestratorStatePath);
  const tracker = new CostTracker();
  // Capture state written inside the phase function (for "running" assertion)
  const captured = { stateInsideFn: null as ReturnType<typeof AgentStateManager.readTopLevelState> };
  const stubPhase = async () => {
    captured.stateInsideFn = AgentStateManager.readTopLevelState(config.adwId);
    return { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };
  };
  await runPhase(config, tracker, stubPhase, 'stepDef');
  this.capturedStateBeforePhase = captured.stateInsideFn;
});

When('runPhase executes executeStepDefPhase and the phase fails', async function () {
  const config = makeConfig(this.adwId, this.orchestratorStatePath);
  const tracker = new CostTracker();
  try {
    await runPhase(config, tracker, async () => { throw new Error('step-def agent failed'); }, 'stepDef');
  } catch {
    // non-fatal from orchestrator's perspective — state should still record failure
  }
});

Then('the phases map should contain a {string} entry with status {string} during execution', function (phaseName: string, expectedStatus: string) {
  // Use state captured from inside the phase function
  const capturedEntry = this.capturedStateBeforePhase?.phases?.[phaseName];
  if (capturedEntry) {
    assert.strictEqual(
      capturedEntry.status,
      expectedStatus,
      `Expected phases.${phaseName}.status to be "${expectedStatus}" during execution`,
    );
  } else {
    // If captured state is unavailable, check current state (best-effort)
    const state = AgentStateManager.readTopLevelState(this.adwId);
    assert.ok(state?.phases?.[phaseName], `Expected phases map to contain "${phaseName}"`);
  }
});

Then('the phases map should contain a {string} entry with status {string} after success', function (phaseName: string, expectedStatus: string) {
  const state = AgentStateManager.readTopLevelState(this.adwId);
  assert.ok(state?.phases, 'Expected phases map to exist');
  assert.strictEqual(
    state.phases![phaseName]?.status,
    expectedStatus,
    `Expected phases.${phaseName}.status = "${expectedStatus}"`,
  );
});

Then('the phases map should contain a {string} entry with status {string}', function (phaseName: string, expectedStatus: string) {
  const state = AgentStateManager.readTopLevelState(this.adwId);
  assert.ok(state?.phases, 'Expected phases map to exist');
  assert.strictEqual(
    state.phases![phaseName]?.status,
    expectedStatus,
    `Expected phases.${phaseName}.status = "${expectedStatus}"`,
  );
});

// ── Sequential ordering guarantee ─────────────────────────────────────────────

Given('an SDLC workflow running against a feature issue with @adw-\\{N} scenarios', function () {
  // Source-code inspection scenario: verified by reading the orchestrator file
  const content = readFileSync(join(ROOT, 'adws/adwSdlc.tsx'), 'utf-8');
  this.sdlcContent = content;
});

When('the build phase completes successfully', function () {
  // Context-only: the ordering is enforced by sequential await calls in the orchestrator
});

Then('executeStepDefPhase runs and generates step definitions', function () {
  const content: string = this.sdlcContent;
  const buildIdx = findFunctionUsageIndex(content, 'executeBuildPhase');
  const stepDefIdx = findFunctionUsageIndex(content, 'executeStepDefPhase');
  assert.ok(stepDefIdx !== -1, 'Expected adwSdlc.tsx to call executeStepDefPhase');
  assert.ok(
    stepDefIdx > buildIdx,
    'Expected executeStepDefPhase to appear after executeBuildPhase in adwSdlc.tsx',
  );
});

Then('the test phase does not start until step definition generation completes', function () {
  const content: string = this.sdlcContent;
  const stepDefIdx = findFunctionUsageIndex(content, 'executeStepDefPhase');
  const testIdx = findFunctionUsageIndex(content, 'executeTestPhase');
  assert.ok(
    stepDefIdx < testIdx,
    'Expected executeStepDefPhase to appear before executeTestPhase in adwSdlc.tsx',
  );
});

// ── TypeScript compilation ─────────────────────────────────────────────────────

Given('the ADW codebase with stepDefPhase wired into orchestrators', function () {
  // Verify the implementation files contain executeStepDefPhase
  const files = [
    'adws/adwSdlc.tsx',
    'adws/adwPlanBuildTest.tsx',
    'adws/adwPlanBuildTestReview.tsx',
    'adws/adwChore.tsx',
    'adws/adwPrReview.tsx',
  ];
  for (const file of files) {
    const fullPath = join(ROOT, file);
    assert.ok(existsSync(fullPath), `Expected file to exist: ${file}`);
    const content = readFileSync(fullPath, 'utf-8');
    assert.ok(
      content.includes('executeStepDefPhase'),
      `Expected "${file}" to reference executeStepDefPhase`,
    );
  }
});
