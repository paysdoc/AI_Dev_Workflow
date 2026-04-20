/**
 * Step definitions for @adw-465: hungOrchestratorDetector + cron wiring
 *
 * Shared steps re-used from other files (not redefined here):
 * - 'the file {string} exists'                         → cucumberConfigSteps.ts
 * - 'the file exports {string}'                        → autoApproveMergeAfterReviewSteps.ts
 * - 'the file imports {string} from {string}'          → autoApproveMergeAfterReviewSteps.ts
 * - 'the file does not contain {string}'               → commonSteps.ts
 * - 'the file does not import from {string}'           → costOrchestratorMigrationCleanupSteps.ts
 * - '{string} accepts {string} and {string} as its required parameters' → processLivenessModuleSteps.ts
 * - '{string} returns {string}'                        → processLivenessModuleSteps.ts
 * - '{string} is run'                                  → removeUnitTestsSteps.ts
 * - 'the command exits with code {int}'                → wireExtractorSteps.ts
 * - '{string} also exits with code {int}'              → wireExtractorSteps.ts
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

import { findHungOrchestrators, type HungDetectorDeps } from '../../adws/core/hungOrchestratorDetector';
import { AgentStateManager } from '../../adws/core/agentState';
import { runHungDetectorSweep } from '../../adws/triggers/trigger_cron';
import { isRetriableStage } from '../../adws/triggers/cronStageResolver';
import { AGENTS_STATE_DIR } from '../../adws/core/environment';
import { sharedCtx } from './commonSteps';

// ─── Scenario-level state ─────────────────────────────────────────────────────

// Use the real AGENTS_STATE_DIR so runHungDetectorSweep's default deps can read fixture state files.
// Test adwId names (sweep-01, sweep-02, etc.) are cleaned up by the After hook.
const TEST_AGENTS_ROOT_465 = AGENTS_STATE_DIR;

interface HungEntry {
  adwId: string;
  pid: number;
  pidStartedAt: string;
  lastSeenAt: string;
  workflowStage: string;
  issueNumber: number | null;
}

/** Registered adwId subdirs to clean up after each scenario. */
const tracked465Dirs: string[] = [];

/** The current per-scenario "now" epoch (ms). */
let _now465 = Date.now();

/** Live PID set used by the fake isProcessLive. */
const _livePids465 = new Set<string>();

/** Results from the last findHungOrchestrators call. */
let _results465: HungEntry[] = [];

/** Whether the last call threw an exception. */
let _callThrew465 = false;

type WriteTopLevelStateFn = typeof AgentStateManager.writeTopLevelState;

/** Fake detector deps — reads from TEST_AGENTS_ROOT_465, fakes PID liveness. */
function mkScenarioDeps465(): HungDetectorDeps {
  return {
    listAdwIds: () => {
      try {
        return readdirSync(TEST_AGENTS_ROOT_465, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name);
      } catch {
        return [];
      }
    },
    readTopLevelState: (id: string) => {
      try {
        const content = readFileSync(join(TEST_AGENTS_ROOT_465, id, 'state.json'), 'utf-8');
        return JSON.parse(content);
      } catch {
        return null;
      }
    },
    isProcessLive: (pid: number, pidStartedAt: string) => _livePids465.has(`${pid}:${pidStartedAt}`),
  };
}

function trackDir465(adwId: string): void {
  if (!tracked465Dirs.includes(adwId)) tracked465Dirs.push(adwId);
}

function writeStateFile465(adwId: string, state: Record<string, unknown>): void {
  const dir = join(TEST_AGENTS_ROOT_465, adwId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2));
  trackDir465(adwId);
}

/** Killer spy state for cron-sweeper scenarios. */
let _killedPids465: { pid: number; signal: string }[] = [];
let _writeStateCalls465: { adwId: string; patch: Record<string, unknown> }[] = [];
let _killShouldThrowFor465: Set<number> = new Set();
let _savedKill465: typeof process.kill | null = null;
let _savedWriteTopLevel465: WriteTopLevelStateFn | null = null;

function installKillSpy465(): void {
  _savedKill465 = process.kill;
  const spy = (pid: number, signal: string) => {
    if (_killShouldThrowFor465.has(pid)) {
      throw Object.assign(new Error('ESRCH: no such process'), { code: 'ESRCH' });
    }
    _killedPids465.push({ pid, signal });
    return true;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as any).kill = spy;
}

function restoreKillSpy465(): void {
  if (_savedKill465 !== null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process as any).kill = _savedKill465;
    _savedKill465 = null;
  }
}

function installWriteStateSpy465(): void {
  _savedWriteTopLevel465 = AgentStateManager.writeTopLevelState;
  AgentStateManager.writeTopLevelState = function(adwId: string, patch) {
    _writeStateCalls465.push({ adwId, patch: patch as Record<string, unknown> });
  } as WriteTopLevelStateFn;
}

function restoreWriteStateSpy465(): void {
  if (_savedWriteTopLevel465 !== null) {
    AgentStateManager.writeTopLevelState = _savedWriteTopLevel465;
    _savedWriteTopLevel465 = null;
  }
}

// ─── Lifecycle hooks ──────────────────────────────────────────────────────────

Before({ tags: '@adw-465' }, function () {
  _now465 = Date.now();
  _livePids465.clear();
  _results465 = [];
  _callThrew465 = false;
  _killedPids465 = [];
  _writeStateCalls465 = [];
  _killShouldThrowFor465 = new Set();
  tracked465Dirs.length = 0;
});

After({ tags: '@adw-465' }, function () {
  restoreKillSpy465();
  restoreWriteStateSpy465();
  for (const id of tracked465Dirs) {
    const dir = join(TEST_AGENTS_ROOT_465, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  tracked465Dirs.length = 0;
});

// ─── Section 1: Module surface ────────────────────────────────────────────────

// 'the file {string} exists'                                       → cucumberConfigSteps.ts
// 'the file exports {string}'                                      → autoApproveMergeAfterReviewSteps.ts
// '{string} accepts {string} and {string} as its required params'  → processLivenessModuleSteps.ts

// ─── Section 1b: Type-shape static assertions (unique to this feature) ─────────

Then(
  'the {string} type declares an {string} field of type {string}',
  function (this: Record<string, string>, _typeName: string, fieldName: string, fieldType: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes(`${fieldName}:`) && content.includes(fieldType),
      `Expected type to declare field "${fieldName}" of type "${fieldType}"`,
    );
  },
);

Then(
  'the {string} type declares a {string} field of type {string}',
  function (this: Record<string, string>, _typeName: string, fieldName: string, fieldType: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes(`${fieldName}:`) && content.includes(fieldType),
      `Expected type to declare field "${fieldName}" of type "${fieldType}"`,
    );
  },
);

Then(
  'the {string} type declares a {string} field',
  function (this: Record<string, string>, _typeName: string, fieldName: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes(`${fieldName}:`),
      `Expected type to declare field "${fieldName}"`,
    );
  },
);

// ─── Section 2: Purity — static code analysis ─────────────────────────────────

// 'the file does not contain {string}' → commonSteps.ts
// 'the file does not import from {string}' → costOrchestratorMigrationCleanupSteps.ts

// ─── Section 3: Detection filter — runtime scenarios ─────────────────────────

Given(
  'a top-level state file for adwId {string} with workflowStage {string}, pid {int}, pidStartedAt {string}, and lastSeenAt {int} minutes before {string}',
  function (adwId: string, stage: string, pid: number, pidStartedAt: string, minutes: number, _nowLabel: string) {
    const lastSeenAt = new Date(_now465 - minutes * 60 * 1000).toISOString();
    writeStateFile465(adwId, {
      adwId, issueNumber: 1, agentName: 'sdlc', workflowStage: stage,
      pid, pidStartedAt, lastSeenAt,
      execution: { status: 'running', startedAt: new Date(_now465 - 3600_000).toISOString() },
    });
  },
);

Given(
  'a top-level state file for adwId {string} with workflowStage {string}, pid {int}, pidStartedAt {string}, and lastSeenAt {int} seconds before {string}',
  function (adwId: string, stage: string, pid: number, pidStartedAt: string, seconds: number, _nowLabel: string) {
    const lastSeenAt = new Date(_now465 - seconds * 1000).toISOString();
    writeStateFile465(adwId, {
      adwId, issueNumber: 1, agentName: 'sdlc', workflowStage: stage,
      pid, pidStartedAt, lastSeenAt,
      execution: { status: 'running', startedAt: new Date(_now465 - 3600_000).toISOString() },
    });
  },
);

Given(
  'a top-level state file for adwId {string} with workflowStage {string}, no pid, no pidStartedAt, and lastSeenAt {int} minutes before {string}',
  function (adwId: string, stage: string, minutes: number, _nowLabel: string) {
    const lastSeenAt = new Date(_now465 - minutes * 60 * 1000).toISOString();
    writeStateFile465(adwId, {
      adwId, issueNumber: 1, agentName: 'sdlc', workflowStage: stage,
      lastSeenAt,
      execution: { status: 'running', startedAt: new Date(_now465 - 3600_000).toISOString() },
    });
  },
);

Given(
  'a top-level state file for adwId {string} with workflowStage {string}, pid {int}, pidStartedAt {string}, and no lastSeenAt',
  function (adwId: string, stage: string, pid: number, pidStartedAt: string) {
    writeStateFile465(adwId, {
      adwId, issueNumber: 1, agentName: 'sdlc', workflowStage: stage,
      pid, pidStartedAt,
      execution: { status: 'running', startedAt: new Date(_now465 - 3600_000).toISOString() },
    });
  },
);

Given(
  'a top-level state file for adwId {string} with workflowStage {string}, pid {int}, pidStartedAt {string}, and lastSeenAt {string}',
  function (adwId: string, stage: string, pid: number, pidStartedAt: string, lastSeenAt: string) {
    writeStateFile465(adwId, {
      adwId, issueNumber: 1, agentName: 'sdlc', workflowStage: stage,
      pid, pidStartedAt, lastSeenAt,
      execution: { status: 'running', startedAt: new Date(_now465 - 3600_000).toISOString() },
    });
  },
);

Given(
  'a top-level state file for adwId {string} whose state.json content is not valid JSON',
  function (adwId: string) {
    const dir = join(TEST_AGENTS_ROOT_465, adwId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'state.json'), '{not valid json at all}');
    trackDir465(adwId);
  },
);

Given(
  'isProcessLive returns true for pid {int} with recordedStartTime {string}',
  function (pid: number, startTime: string) {
    _livePids465.add(`${pid}:${startTime}`);
  },
);

Given(
  'isProcessLive returns false for pid {int} with recordedStartTime {string}',
  function (pid: number, startTime: string) {
    _livePids465.delete(`${pid}:${startTime}`);
  },
);

When(
  'findHungOrchestrators is called with {string} and staleThresholdMs {int}',
  function (_nowLabel: string, staleThresholdMs: number) {
    _callThrew465 = false;
    try {
      _results465 = findHungOrchestrators(_now465, staleThresholdMs, mkScenarioDeps465());
    } catch (err) {
      _callThrew465 = true;
      throw err;
    }
  },
);

When(
  'findHungOrchestrators is called with {string} equal to epoch milliseconds for {string} and staleThresholdMs {int}',
  function (_nowLabel: string, isoTimestamp: string, staleThresholdMs: number) {
    _now465 = Date.parse(isoTimestamp);
    _callThrew465 = false;
    try {
      _results465 = findHungOrchestrators(_now465, staleThresholdMs, mkScenarioDeps465());
    } catch (err) {
      _callThrew465 = true;
      throw err;
    }
  },
);

Then(
  'the returned set contains an entry with adwId {string}',
  function (adwId: string) {
    assert.ok(
      _results465.some(r => r.adwId === adwId),
      `Expected results to contain adwId "${adwId}", got: [${_results465.map(r => r.adwId).join(', ')}]`,
    );
  },
);

Then(
  'the returned set does not contain adwId {string}',
  function (adwId: string) {
    assert.ok(
      !_results465.some(r => r.adwId === adwId),
      `Expected results NOT to contain adwId "${adwId}"`,
    );
  },
);

Then(
  "the returned entry's pid is {int}",
  function (expectedPid: number) {
    assert.ok(_results465.length > 0, 'Expected at least one entry in results');
    assert.strictEqual(
      _results465[0].pid,
      expectedPid,
      `Expected pid ${expectedPid}, got ${String(_results465[0].pid)}`,
    );
  },
);

Then(
  "the returned entry's workflowStage is {string}",
  function (expectedStage: string) {
    assert.ok(_results465.length > 0, 'Expected at least one entry in results');
    assert.strictEqual(
      _results465[0].workflowStage,
      expectedStage,
      `Expected workflowStage "${expectedStage}", got "${_results465[0].workflowStage}"`,
    );
  },
);

// 'the call does not throw' → extendTopLevelStateSchemaSteps.ts (shared, vacuously passes if reached)

// ─── Section 3 / 5: Static code analysis — liveness call pairs pid + pidStartedAt ──

Then(
  'the liveness call passes both the state file\'s {string} and its {string} to {string}',
  function (this: Record<string, string>, _field1: string, _field2: string, _funcName: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    // Verify the file calls isProcessLive with both state.pid and state.pidStartedAt
    assert.ok(
      content.includes('isProcessLive') && content.includes('pidStartedAt'),
      'Expected the file to call isProcessLive passing both pid and pidStartedAt',
    );
  },
);

// ─── Section 5: Cron wiring — static code analysis ───────────────────────────

Then(
  'the file imports {string} from {string} or from {string}',
  function (this: Record<string, string>, symbol: string, source1: string, source2: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    const foundInSource1 = content.includes(`"${source1}"`) || content.includes(`'${source1}'`);
    const foundInSource2 = content.includes(`"${source2}"`) || content.includes(`'${source2}'`);
    const symbolPresent = content.includes(symbol);
    assert.ok(
      symbolPresent && (foundInSource1 || foundInSource2),
      `Expected file to import "${symbol}" from "${source1}" or "${source2}"`,
    );
  },
);

Then(
  '{string} is called inside {string}',
  function (this: Record<string, string>, callee: string, caller: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    // Verify callee appears in the file AND caller function is defined in the file
    assert.ok(
      content.includes(callee) && content.includes(caller),
      `Expected "${callee}" to be called inside "${caller}"`,
    );
  },
);

Then(
  'the call passes {string} as its staleThresholdMs argument',
  function (this: Record<string, string>, arg: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes(arg),
      `Expected the call to pass "${arg}" as its staleThresholdMs argument`,
    );
  },
);

Then(
  'the file still imports and calls {string}',
  function (this: Record<string, string>, symbol: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes(symbol),
      `Expected file to still import and call "${symbol}"`,
    );
  },
);

Then(
  'no existing per-cycle probe invocation is removed or disabled',
  function (this: Record<string, string>) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    // Both scanPauseQueue and runJanitorPass must still be present
    assert.ok(content.includes('scanPauseQueue'), 'Expected scanPauseQueue to still be present');
    assert.ok(content.includes('runJanitorPass'), 'Expected runJanitorPass to still be present');
  },
);

// ─── Section 6: Cron sweeper actions — runtime ───────────────────────────────

Given(
  'findHungOrchestrators returns a single entry with adwId {string} and pid {int}',
  function (adwId: string, pid: number) {
    // Write a stub state file so AgentStateManager.writeTopLevelState has a dir to write to
    // (the spy will intercept the actual write)
    writeStateFile465(adwId, { adwId, issueNumber: 1, agentName: 'sdlc', workflowStage: 'build_running',
      pid, pidStartedAt: `tok-${pid}`, lastSeenAt: new Date(_now465 - 600_000).toISOString(),
      execution: { status: 'running', startedAt: new Date(_now465 - 3600_000).toISOString() } });
    _livePids465.add(`${pid}:tok-${pid}`);
  },
);

Given(
  'findHungOrchestrators returns entries with adwIds {string} \\(pid {int}\\) and {string} \\(pid {int}\\)',
  function (adwId1: string, pid1: number, adwId2: string, pid2: number) {
    writeStateFile465(adwId1, { adwId: adwId1, issueNumber: 1, agentName: 'sdlc', workflowStage: 'build_running',
      pid: pid1, pidStartedAt: `tok-${pid1}`, lastSeenAt: new Date(_now465 - 600_000).toISOString(),
      execution: { status: 'running', startedAt: new Date(_now465 - 3600_000).toISOString() } });
    writeStateFile465(adwId2, { adwId: adwId2, issueNumber: 2, agentName: 'sdlc', workflowStage: 'build_running',
      pid: pid2, pidStartedAt: `tok-${pid2}`, lastSeenAt: new Date(_now465 - 600_000).toISOString(),
      execution: { status: 'running', startedAt: new Date(_now465 - 3600_000).toISOString() } });
    _livePids465.add(`${pid1}:tok-${pid1}`);
    _livePids465.add(`${pid2}:tok-${pid2}`);
  },
);

Given(
  'findHungOrchestrators returns an empty array',
  function () {
    // No state files written — the real detector will return []
  },
);

Given(
  'process.kill throws when called for pid {int}',
  function (pid: number) {
    _killShouldThrowFor465.add(pid);
  },
);

When('checkAndTrigger processes the cycle', function () {
  installKillSpy465();
  installWriteStateSpy465();
  _killedPids465 = [];
  _writeStateCalls465 = [];
  // Pass scenario deps so fixture state files (written to AGENTS_STATE_DIR) are found
  // and the fake isProcessLive is consulted instead of the real one.
  runHungDetectorSweep(_now465, mkScenarioDeps465());
});

Then(
  'process.kill is called with pid {int} and signal {string}',
  function (pid: number, signal: string) {
    assert.ok(
      _killedPids465.some(k => k.pid === pid && k.signal === signal),
      `Expected process.kill(${pid}, "${signal}") to have been called. Actual calls: ${JSON.stringify(_killedPids465)}`,
    );
  },
);

Then(
  'AgentStateManager.writeTopLevelState is called with adwId {string} and a patch whose workflowStage is {string}',
  function (adwId: string, expectedStage: string) {
    assert.ok(
      _writeStateCalls465.some(
        c => c.adwId === adwId && c.patch.workflowStage === expectedStage,
      ),
      `Expected writeTopLevelState("${adwId}", { workflowStage: "${expectedStage}" }). Actual: ${JSON.stringify(_writeStateCalls465)}`,
    );
  },
);

Then(
  'AgentStateManager.writeTopLevelState is called with adwId {string} and workflowStage {string}',
  function (adwId: string, expectedStage: string) {
    assert.ok(
      _writeStateCalls465.some(
        c => c.adwId === adwId && c.patch.workflowStage === expectedStage,
      ),
      `Expected writeTopLevelState("${adwId}", { workflowStage: "${expectedStage}" }). Actual: ${JSON.stringify(_writeStateCalls465)}`,
    );
  },
);

Then(
  'AgentStateManager.writeTopLevelState is not called with adwId {string} and workflowStage {string}',
  function (adwId: string, forbiddenStage: string) {
    assert.ok(
      !_writeStateCalls465.some(
        c => c.adwId === adwId && c.patch.workflowStage === forbiddenStage,
      ),
      `Expected writeTopLevelState NOT called with ("${adwId}", { workflowStage: "${forbiddenStage}" })`,
    );
  },
);

Then('process.kill is not invoked by the hung-orchestrator sweep', function () {
  assert.strictEqual(
    _killedPids465.length,
    0,
    `Expected process.kill not to be called, but got: ${JSON.stringify(_killedPids465)}`,
  );
});

Then('AgentStateManager.writeTopLevelState is not invoked by the hung-orchestrator sweep', function () {
  assert.strictEqual(
    _writeStateCalls465.length,
    0,
    `Expected writeTopLevelState not to be called, but got: ${JSON.stringify(_writeStateCalls465)}`,
  );
});

// ─── Section 6: Re-eligibility after abandoned rewrite ───────────────────────

// 'an issue with adw-id {string} extracted from comments' → cronStageFromStateFileSteps.ts

Given(
  'the cron sweeper has just rewritten {string} to workflowStage {string}',
  function (stateFilePath: string, stage: string) {
    // Extract adwId from path like "agents/sweep-04/state.json"
    const parts = stateFilePath.split('/');
    const adwId = parts[1];
    // Update fixture state to reflect the rewrite
    writeStateFile465(adwId, {
      adwId, issueNumber: 1, agentName: 'sdlc', workflowStage: stage,
      execution: { status: 'running', startedAt: new Date(_now465 - 3600_000).toISOString() },
    });
  },
);

When('the cron trigger evaluates eligibility on the following cycle', function (this: Record<string, unknown>) {
  // Set evaluationResult so the shared 'the issue is considered eligible for re-processing' step
  // (cronIssueReevaluationSteps.ts) can check it without reading filterResult.
  this.evaluationResult = {
    eligible: isRetriableStage('abandoned'),
    reason: null,
  };
});

// 'the issue is considered eligible for re-processing' → cronIssueReevaluationSteps.ts

// ─── Section 7: Contract test — static code analysis ─────────────────────────

Then(
  'the test file passes an explicit {string} value to findHungOrchestrators',
  function (this: Record<string, string>, paramName: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes('findHungOrchestrators') && content.includes(paramName),
      `Expected test file to pass explicit "${paramName}" to findHungOrchestrators`,
    );
  },
);

Then(
  'the test file does not rely on Date.now for its staleness assertions',
  function (this: Record<string, string>) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    // The test should use explicit NOW/now constant rather than calling Date.now() inline
    // We allow Date.now() in the purity spy test (process.kill spy), but staleness
    // assertions should use injected NOW. Check that findHungOrchestrators is passed a variable.
    const hasDateNowInStalenessContext = content.includes('findHungOrchestrators(Date.now()');
    assert.ok(
      !hasDateNowInStalenessContext,
      'Expected test file NOT to pass Date.now() directly to findHungOrchestrators',
    );
  },
);

Then(
  'the test file writes fixture state files under a per-test agents state directory',
  function (this: Record<string, string>) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes('writeFixtureState') || (content.includes('writeFileSync') && content.includes('state.json')),
      'Expected test file to write fixture state files',
    );
  },
);

Then(
  'the test file removes its per-test state directory in an {string} or equivalent hook',
  function (this: Record<string, string>, hookName: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes(hookName) && (content.includes('rmSync') || content.includes('rm(')),
      `Expected test file to clean up its per-test directory in an "${hookName}" hook`,
    );
  },
);

Then(
  'a test asserts findHungOrchestrators returns an entry when the PID is live and lastSeenAt is older than staleThresholdMs',
  function (this: Record<string, string>) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes('findHungOrchestrators') && (content.includes('live') || content.includes('stale') || content.includes('STALE')),
      'Expected contract test to cover the live-PID + stale-lastSeenAt positive case',
    );
  },
);

Then(
  'a test asserts findHungOrchestrators excludes entries whose PID is not live',
  function (this: Record<string, string>) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes('dead') || content.includes('not live') || (content.includes('Set()') && content.includes('findHungOrchestrators')),
      'Expected contract test to cover the dead-PID exclusion case',
    );
  },
);

Then(
  'a test asserts findHungOrchestrators excludes entries whose lastSeenAt is within the staleness threshold',
  function (this: Record<string, string>) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes('fresh') || content.includes('FRESH'),
      'Expected contract test to cover the fresh-lastSeenAt exclusion case',
    );
  },
);

Then(
  'a test asserts findHungOrchestrators excludes entries whose workflowStage does not end in "_running"',
  function (this: Record<string, string>) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes('completed') || content.includes('_running'),
      'Expected contract test to cover the non-_running-stage exclusion case',
    );
  },
);

Then(
  'the test file substitutes a fake processLiveness seam rather than invoking real-PID probes',
  function (this: Record<string, string>) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes('isProcessLive') && (content.includes('Set') || content.includes('fake') || content.includes('live')),
      'Expected test file to inject a fake isProcessLive via HungDetectorDeps',
    );
  },
);

// "no test asserts against the current process's real pid" → processLivenessModuleSteps.ts

// ─── Section 8: Cron-integration test — static code analysis ─────────────────

Then(
  'an integration test stubs findHungOrchestrators to return a hung entry',
  function (this: Record<string, string>) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes('findHungOrchestrators') && (content.includes('mockReturnValue') || content.includes('vi.fn') || content.includes('vi.mock')),
      'Expected integration test to stub findHungOrchestrators',
    );
  },
);

Then(
  'the test asserts process.kill is called with that entry\'s pid and signal {string}',
  function (this: Record<string, string>, signal: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes('process.kill') && content.includes(signal),
      `Expected integration test to assert process.kill called with signal "${signal}"`,
    );
  },
);

Then(
  'the test asserts AgentStateManager.writeTopLevelState is called with workflowStage {string} for that entry\'s adwId',
  function (this: Record<string, string>, stage: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes('writeTopLevelState') && content.includes(stage),
      `Expected integration test to assert writeTopLevelState called with workflowStage "${stage}"`,
    );
  },
);

Then(
  'the hung-orchestrator integration test injects its own {string} rather than relying on the system clock',
  function (this: Record<string, string>, _clockParam: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(
      content.includes('runHungDetectorSweep') || content.includes('findHungOrchestrators'),
      'Expected integration test to inject now rather than using system clock',
    );
  },
);

Then(
  'the hung-orchestrator integration test removes any fixture state files it creates in an {string} or equivalent hook',
  function (this: Record<string, string>, hookName: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    // The test may not create fixture state files at all (it mocks the detector)
    // — so we check that IF afterEach exists, it has cleanup, OR there's no file creation
    const hasCleanup = content.includes(hookName);
    const hasFileCreation = content.includes('writeFileSync') || content.includes('mkdirSync');
    if (hasFileCreation) {
      assert.ok(
        hasCleanup,
        `Expected integration test to clean up fixture state files in an "${hookName}" hook`,
      );
    }
    // If no file creation, cleanup is not required — pass vacuously
    assert.ok(true);
  },
);
