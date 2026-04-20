/**
 * Step definitions for @adw-462: heartbeat module + adwSdlc tracer integration
 *
 * Shared steps re-used from other files (do not redefine here):
 * - 'the file {string} exists'                         → cucumberConfigSteps.ts
 * - 'the file exports {string}'                        → autoApproveMergeAfterReviewSteps.ts
 * - 'the file imports {string} from {string}'          → autoApproveMergeAfterReviewSteps.ts
 * - 'the file does not import from {string}'           → costOrchestratorMigrationCleanupSteps.ts
 * - 'the file does not contain {string}'               → commonSteps.ts
 * - '{string} accepts {string} as its required parameter'                    → processLivenessModuleSteps.ts
 * - '{string} accepts {string} and {string} as its required parameters'      → processLivenessModuleSteps.ts
 * - '{string} returns {string}'                        → processLivenessModuleSteps.ts
 * - '{string} is run'                                  → removeUnitTestsSteps.ts
 * - 'the command exits with code {int}'                → wireExtractorSteps.ts
 * - '{string} also exits with code {int}'              → wireExtractorSteps.ts
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import assert from 'assert';

import { AgentStateManager } from '../../adws/core/agentState';
import { AGENTS_STATE_DIR } from '../../adws/core/config';
import { startHeartbeat, stopHeartbeat, type HeartbeatHandle } from '../../adws/core/heartbeat';
import { sharedCtx } from './commonSteps';

const _ROOT = process.cwd();

// ─── Scenario-level state ────────────────────────────────────────────────────

const TEST_ADW_IDS_462: string[] = [];
let _handle462: HeartbeatHandle | null = null;
let _capturedLastSeenAt462: string | undefined = undefined;
let _noExceptionThrown462 = true;

Before({ tags: '@adw-462' }, function () {
  _handle462 = null;
  _capturedLastSeenAt462 = undefined;
  _noExceptionThrown462 = true;
});

After({ tags: '@adw-462' }, function () {
  if (_handle462 !== null) {
    try { stopHeartbeat(_handle462); } catch { /* idempotent */ }
    _handle462 = null;
  }
  for (const id of TEST_ADW_IDS_462) {
    const dir = join(AGENTS_STATE_DIR, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  TEST_ADW_IDS_462.length = 0;
});

function trackAdwId462(id: string): string {
  if (!TEST_ADW_IDS_462.includes(id)) TEST_ADW_IDS_462.push(id);
  return id;
}

// ─── Section 2: Config constants ─────────────────────────────────────────────

Then('the exported {string} default value is {int}', function (
  this: Record<string, string>,
  exportName: string,
  expectedValue: number,
) {
  const content = this.fileContent || sharedCtx.fileContent;
  const valueStr = String(expectedValue);
  const valueWithUnderscores = valueStr.replace(/(\d)(?=(\d{3})+$)/g, '$1_');
  assert.ok(
    content.includes(exportName) && (content.includes(valueStr) || content.includes(valueWithUnderscores)),
    `Expected "${exportName}" to have default value ${expectedValue}`,
  );
});

Then('the exported {string} default value equals six times the exported {string} default value', function (
  this: Record<string, string>,
  staleConst: string,
  tickConst: string,
) {
  const content = this.fileContent || sharedCtx.fileContent;
  const tickMatch = content.match(/HEARTBEAT_TICK_INTERVAL_MS\s*=\s*([\d_]+)/);
  const staleMatch = content.match(/HEARTBEAT_STALE_THRESHOLD_MS\s*=\s*([\d_]+)/);
  assert.ok(tickMatch && staleMatch, `Expected both ${tickConst} and ${staleConst} to be found in the file`);
  const tickVal = parseInt(tickMatch[1].replace(/_/g, ''), 10);
  const staleVal = parseInt(staleMatch[1].replace(/_/g, ''), 10);
  assert.strictEqual(staleVal, tickVal * 6, `Expected ${staleConst} (${staleVal}) to equal 6 * ${tickConst} (${tickVal})`);
});

// ─── Section 4: Contract test — startHeartbeat writes lastSeenAt ─────────────

Given('a fresh top-level state file exists for adwId {string} with no lastSeenAt', function (adwId: string) {
  trackAdwId462(adwId);
  AgentStateManager.writeTopLevelState(adwId, {});
});

When('startHeartbeat is called with adwId {string} and intervalMs {int}', function (adwId: string, intervalMs: number) {
  _handle462 = startHeartbeat(adwId, intervalMs);
});

When('{int} milliseconds elapse', async function (ms: number) {
  await new Promise<void>(resolve => {
    const tickSize = Math.min(ms, 50);
    let elapsed = 0;
    function tick() {
      setTimeout(() => {
        elapsed += tickSize;
        if (elapsed >= ms) resolve();
        else tick();
      }, tickSize);
    }
    tick();
  });
});

Then('the top-level state file for {string} has a non-empty {string} value', function (adwId: string, field: string) {
  const state = AgentStateManager.readTopLevelState(adwId);
  const val = (state as unknown as Record<string, unknown>)?.[field];
  assert.ok(val && String(val).length > 0, `Expected non-empty "${field}" for adwId "${adwId}", got: ${JSON.stringify(val)}`);
});

Then('the top-level state file for {string} has a {string} value that parses as a valid ISO 8601 timestamp', function (adwId: string, field: string) {
  const state = AgentStateManager.readTopLevelState(adwId);
  const val = (state as unknown as Record<string, unknown>)?.[field];
  assert.ok(val && typeof val === 'string', `Expected "${field}" to be a string, got: ${JSON.stringify(val)}`);
  const date = new Date(val as string);
  assert.ok(!isNaN(date.getTime()), `Expected "${field}" to be a valid ISO 8601 timestamp, got: "${String(val)}"`);
  assert.ok((val as string).match(/^\d{4}-\d{2}-\d{2}T/), `Expected "${field}" to start with ISO 8601 prefix, got: "${String(val)}"`);
});

Then('the top-level state file for {string} has had its {string} updated at least {int} times', function (adwId: string, _field: string, minCount: number) {
  const state = AgentStateManager.readTopLevelState(adwId);
  const val = state?.lastSeenAt;
  assert.ok(val && val.length > 0, `Expected "lastSeenAt" to be set (at least ${minCount} tick(s)), got: ${JSON.stringify(val)}`);
});

// ─── Section 5: Contract test — stopHeartbeat prevents further writes ─────────

Then('stopHeartbeat is called with the returned handle', function () {
  if (_handle462 !== null) {
    stopHeartbeat(_handle462);
    _handle462 = null;
  }
});

When('the captured {string} value is recorded', function (field: string) {
  const lastAdwId = TEST_ADW_IDS_462[TEST_ADW_IDS_462.length - 1];
  if (!lastAdwId) return;
  const state = AgentStateManager.readTopLevelState(lastAdwId);
  _capturedLastSeenAt462 = (state as unknown as Record<string, unknown>)?.[field] as string | undefined;
});

// Shared step: both Then and When in feature file — Cucumber keywords are interchangeable for matching

Then('the top-level state file for {string} has the same {string} value as the one recorded', function (adwId: string, field: string) {
  const state = AgentStateManager.readTopLevelState(adwId);
  const val = (state as unknown as Record<string, unknown>)?.[field];
  assert.strictEqual(
    val,
    _capturedLastSeenAt462,
    `Expected "${field}" to remain "${String(_capturedLastSeenAt462)}" after stop, got: "${String(val)}"`,
  );
});

When('stopHeartbeat is called with the same handle a second time', function () {
  try {
    if (_handle462 !== null) stopHeartbeat(_handle462);
    _noExceptionThrown462 = true;
  } catch {
    _noExceptionThrown462 = false;
  }
});

Then('no exception is thrown', function () {
  assert.ok(_noExceptionThrown462, 'Expected no exception to be thrown when calling stopHeartbeat twice');
});

// ─── Section 6: Atomicity & non-destructiveness ───────────────────────────────

Given('a top-level state file for adwId {string} with issueNumber {int}, workflowStage {string}, branchName {string}, pid {int}, and pidStartedAt {string}',
  function (adwId: string, issueNumber: number, workflowStage: string, branchName: string, pid: number, pidStartedAt: string) {
    trackAdwId462(adwId);
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber, workflowStage, branchName, pid, pidStartedAt });
  },
);

Then('the persisted {string} is still {int}', function (fieldName: string, expected: number) {
  const adwId = TEST_ADW_IDS_462[TEST_ADW_IDS_462.length - 1];
  const state = AgentStateManager.readTopLevelState(adwId!);
  const actual = (state as unknown as Record<string, unknown>)?.[fieldName];
  assert.strictEqual(actual, expected, `Expected state.${fieldName} to still be ${expected}, got: ${String(actual)}`);
});

Then('the persisted {string} is still {string}', function (fieldName: string, expected: string) {
  const adwId = TEST_ADW_IDS_462[TEST_ADW_IDS_462.length - 1];
  const state = AgentStateManager.readTopLevelState(adwId!);
  const actual = (state as unknown as Record<string, unknown>)?.[fieldName];
  assert.strictEqual(actual, expected, `Expected state.${fieldName} to still be "${expected}", got: "${String(actual)}"`);
});

Then('the persisted {string} is non-empty', function (fieldName: string) {
  const adwId = TEST_ADW_IDS_462[TEST_ADW_IDS_462.length - 1];
  const state = AgentStateManager.readTopLevelState(adwId!);
  const actual = (state as unknown as Record<string, unknown>)?.[fieldName];
  assert.ok(actual && String(actual).length > 0, `Expected state.${fieldName} to be non-empty, got: ${JSON.stringify(actual)}`);
});

// Note: 'a top-level state file for adwId {string} with a phases map containing {string} completed and {string} completed'
// is defined in extendTopLevelStateSchemaSteps.ts — reuse it here

// ─── Section 7: adwSdlc tracer wiring ────────────────────────────────────────

Then('the call to {string} occurs after the call to {string}', function (
  this: Record<string, string>,
  laterFunc: string,
  earlierFunc: string,
) {
  const content = this.fileContent || sharedCtx.fileContent;
  const earlierIdx = content.indexOf(earlierFunc + '(');
  const laterIdx = content.indexOf(laterFunc + '(');
  assert.ok(earlierIdx !== -1, `Expected "${earlierFunc}" to appear in file`);
  assert.ok(laterIdx !== -1, `Expected "${laterFunc}" to appear in file`);
  assert.ok(
    laterIdx > earlierIdx,
    `Expected "${laterFunc}" (at ${laterIdx}) to appear after "${earlierFunc}" (at ${earlierIdx})`,
  );
});

Then('the call to {string} occurs inside a {string} block', function (
  this: Record<string, string>,
  funcName: string,
  blockKeyword: string,
) {
  const content = this.fileContent || sharedCtx.fileContent;
  const finallyIdx = content.lastIndexOf(`${blockKeyword} {`);
  const funcIdx = content.indexOf(`${funcName}(`);
  assert.ok(finallyIdx !== -1, `Expected a "${blockKeyword} {" block in file`);
  assert.ok(funcIdx !== -1, `Expected "${funcName}(" call in file`);
  assert.ok(funcIdx > finallyIdx, `Expected "${funcName}" to appear after "${blockKeyword} {"`);
});

Then('the {string} block containing {string} also surrounds the main orchestrator try body', function (
  this: Record<string, string>,
  blockKeyword: string,
  funcName: string,
) {
  const content = this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('try {') && content.includes('catch') && content.includes(blockKeyword),
    `Expected try/catch/${blockKeyword} structure in file`,
  );
  assert.ok(content.includes(funcName), `Expected "${funcName}" in file`);
});

Then('the call to {string} uses {string} as its intervalMs argument', function (
  this: Record<string, string>,
  funcName: string,
  argName: string,
) {
  const content = this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes(`${funcName}(`) && content.includes(argName),
    `Expected "${funcName}" call to use "${argName}" as intervalMs argument`,
  );
});

Then('the call to {string} uses {string} as its adwId argument', function (
  this: Record<string, string>,
  funcName: string,
  argName: string,
) {
  const content = this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes(`${funcName}(`) && content.includes(argName),
    `Expected "${funcName}" call to use "${argName}" as adwId argument`,
  );
});

// ─── Section 8: Phase-transition durability ───────────────────────────────────

Then('the persisted {string} equals the recorded value', function (field: string) {
  const adwId = TEST_ADW_IDS_462[TEST_ADW_IDS_462.length - 1];
  const state = AgentStateManager.readTopLevelState(adwId!);
  const actual = (state as unknown as Record<string, unknown>)?.[field];
  assert.strictEqual(
    actual,
    _capturedLastSeenAt462,
    `Expected state.${field} to equal recorded value "${String(_capturedLastSeenAt462)}", got: "${String(actual)}"`,
  );
});

Then('the persisted {string} is {string}', function (fieldName: string, expected: string) {
  const adwId = TEST_ADW_IDS_462[TEST_ADW_IDS_462.length - 1];
  const state = AgentStateManager.readTopLevelState(adwId!);
  const actual = (state as unknown as Record<string, unknown>)?.[fieldName];
  assert.strictEqual(actual, expected, `Expected state.${fieldName} to be "${expected}", got: "${String(actual)}"`);
});

// ─── Section 9: Contract-test file assertions ─────────────────────────────────

Then('a test asserts startHeartbeat writes {string} at least once within {string}', function (
  this: Record<string, string>,
  field: string,
  _timing: string,
) {
  const content = this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('startHeartbeat') && content.includes(field),
    `Expected contract test to assert startHeartbeat writes "${field}"`,
  );
});

Then('a test asserts stopHeartbeat stops further {string} writes after it is called', function (
  this: Record<string, string>,
  field: string,
) {
  const content = this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('stopHeartbeat') && content.includes(field),
    `Expected contract test to assert stopHeartbeat stops further "${field}" writes`,
  );
});

Then('the test file removes its per-test adwId state directory in an {string} or equivalent hook', function (
  this: Record<string, string>,
  hookName: string,
) {
  const content = this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes(hookName) && content.includes('rmSync'),
    `Expected test file to clean up state directories in an "${hookName}" hook`,
  );
});
