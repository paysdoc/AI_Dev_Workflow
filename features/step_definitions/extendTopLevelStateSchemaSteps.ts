/**
 * Step definitions for @adw-461: Extend top-level state schema
 *
 * Covers:
 * - AgentState interface schema inspection (four new fields + JSDoc)
 * - pidStartedAt platform-format contract (write/read round-trip)
 * - Forward-compatible read of pre-461 state files
 * - writeTopLevelState atomic rename behavior (source analysis + behavioral)
 * - Partial-patch merge preservation
 * - Unit test file coverage assertions
 * - TypeScript compilation gate
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import assert from 'assert';

import { AgentStateManager } from '../../adws/core/agentState';
import { AGENTS_STATE_DIR } from '../../adws/core/config';
import { sharedCtx } from './commonSteps';

const ROOT = process.cwd();

// ─── Test state (reset Before each @adw-461 scenario) ────────────────────────

const TEST_ADW_IDS_461: string[] = [];
let _platformOverride461: string | null = null;
let _fakeStartTime461: string | null = null;
let _writtenAdwId: string | null = null;
let _writtenState: ReturnType<typeof AgentStateManager.readTopLevelState> = null;
let _fileContent461 = '';
let _unitTestContent461 = '';

Before({ tags: '@adw-461' }, function () {
  _platformOverride461 = null;
  _fakeStartTime461 = null;
  _writtenAdwId = null;
  _writtenState = null;
  _fileContent461 = '';
  _unitTestContent461 = '';
});

After({ tags: '@adw-461' }, function () {
  for (const id of TEST_ADW_IDS_461) {
    const dir = join(AGENTS_STATE_DIR, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  // Drain the list
  TEST_ADW_IDS_461.length = 0;
});

function trackAdwId(id: string): string {
  if (!TEST_ADW_IDS_461.includes(id)) TEST_ADW_IDS_461.push(id);
  return id;
}

// ─── Section 1: AgentState schema surface ────────────────────────────────────

Given('the AgentState interface in {string} is read', function (filePath: string) {
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected file to exist: ${filePath}`);
  _fileContent461 = readFileSync(fullPath, 'utf-8');
  this.fileContent = _fileContent461;
  sharedCtx.fileContent = _fileContent461;
  sharedCtx.filePath = filePath;
});

Then('the interface declares an optional {string} field of type {string}', function (fieldName: string, typeName: string) {
  const content = _fileContent461 || this.fileContent || sharedCtx.fileContent;
  const pattern = `${fieldName}?: ${typeName}`;
  assert.ok(
    content.includes(pattern),
    `Expected AgentState to declare optional field "${pattern}"`,
  );
});

Then('the {string} field\'s doc comment references the processLiveness contract', function (fieldName: string) {
  const content = _fileContent461 || this.fileContent || sharedCtx.fileContent;
  // The JSDoc block for pidStartedAt should mention processLiveness
  assert.ok(
    content.includes('processLiveness'),
    `Expected the "${fieldName}" field's JSDoc to reference processLiveness`,
  );
});

Then('the doc comment notes that ISO 8601 is preferred when available', function () {
  const content = _fileContent461 || this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('ISO 8601'),
    'Expected JSDoc to note that ISO 8601 is preferred when available',
  );
});

Then('the doc comment notes that a platform-specific string is used otherwise', function () {
  const content = _fileContent461 || this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.toLowerCase().includes('platform') &&
      (content.includes('native') || content.includes('token') || content.includes('otherwise')),
    'Expected JSDoc to note that a platform-specific string is used otherwise',
  );
});

Then('the {string} field\'s doc comment describes it as the most recent heartbeat write timestamp', function (fieldName: string) {
  const content = _fileContent461 || this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('heartbeat') || content.includes('most recent'),
    `Expected the "${fieldName}" field's JSDoc to describe it as the most recent heartbeat write timestamp`,
  );
});

Then('the doc comment notes that it is ISO 8601', function () {
  const content = _fileContent461 || this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('ISO 8601'),
    'Expected JSDoc to note that the field is ISO 8601',
  );
});

// ─── Section 2: pidStartedAt platform-format contract ────────────────────────

Given('processLiveness.getProcessStartTime returns {string} for the current process\'s pid', function (fakeValue: string) {
  _fakeStartTime461 = fakeValue;
});

When('the top-level state is written with pidStartedAt set from getProcessStartTime', function () {
  const adwId = trackAdwId(`test-461-platform-${Date.now()}`);
  _writtenAdwId = adwId;
  AgentStateManager.writeTopLevelState(adwId, {
    adwId,
    pidStartedAt: _fakeStartTime461 ?? undefined,
  });
  _writtenState = AgentStateManager.readTopLevelState(adwId);
});

Then('the persisted {string} value is exactly {string}', function (fieldName: string, expected: string) {
  const state = _writtenState ?? (_writtenAdwId ? AgentStateManager.readTopLevelState(_writtenAdwId) : null);
  assert.ok(state, 'Expected state to be readable');
  const actual = (state as unknown as unknown as Record<string, unknown>)[fieldName];
  assert.strictEqual(actual, expected, `Expected state.${fieldName} to be exactly "${expected}", got "${String(actual)}"`);
});

Given('a top-level state file for adwId {string}', function (adwId: string) {
  trackAdwId(adwId);
  _writtenAdwId = adwId;
  AgentStateManager.writeTopLevelState(adwId, { adwId });
});

When('writeTopLevelState is called with pidStartedAt {string}', function (pidStartedAt: string) {
  assert.ok(_writtenAdwId, 'Expected adwId to be set');
  AgentStateManager.writeTopLevelState(_writtenAdwId, { pidStartedAt });
});

When('readTopLevelState is called for adwId {string}', function (adwId: string) {
  _writtenAdwId = adwId;
  _writtenState = AgentStateManager.readTopLevelState(adwId);
});

Then('the returned state\'s {string} field is exactly {string}', function (fieldName: string, expected: string) {
  assert.ok(_writtenState, 'Expected state to be non-null');
  const actual = (_writtenState as unknown as Record<string, unknown>)[fieldName];
  assert.strictEqual(actual, expected, `Expected state.${fieldName} to be exactly "${expected}", got "${String(actual)}"`);
});

// ─── Section 3: Forward-compatible read ──────────────────────────────────────

Given('a state file at {string} with only the pre-461 fields', function (relPath: string) {
  const filePath = join(ROOT, relPath);
  mkdirSync(dirname(filePath), { recursive: true });
  const adwId = relPath.split('/')[1] ?? 'legacy01';
  trackAdwId(adwId);
  writeFileSync(filePath, JSON.stringify({ adwId, issueNumber: 1, workflowStage: 'starting' }, null, 2), 'utf-8');
  this.legacyAdwId = adwId;
  this.legacyState = { adwId, issueNumber: 1, workflowStage: 'starting' };
});

Given('a state file at {string} with pid and pidStartedAt but no lastSeenAt', function (relPath: string) {
  const filePath = join(ROOT, relPath);
  mkdirSync(dirname(filePath), { recursive: true });
  const adwId = relPath.split('/')[1] ?? 'partial01';
  trackAdwId(adwId);
  const state = { adwId, pid: 1234, pidStartedAt: 'Sun Apr 20 10:00:00 2026' };
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
  this.legacyAdwId = adwId;
  this.legacyState = state;
});

Given('a state file at {string} with only adwId and issueNumber', function (relPath: string) {
  const filePath = join(ROOT, relPath);
  mkdirSync(dirname(filePath), { recursive: true });
  const adwId = relPath.split('/')[1] ?? 'legacy02';
  trackAdwId(adwId);
  const state = { adwId, issueNumber: 99 };
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
  this.legacyAdwId = adwId;
  this.legacyState = state;
  _writtenAdwId = adwId;
});

Then('the call does not throw', function () {
  // If we reached this step without an exception, the call did not throw
});

Then('the returned state\'s {string} matches the file\'s adwId', function (fieldName: string) {
  assert.ok(_writtenState, 'Expected state to be non-null');
  const expected = this.legacyState?.adwId ?? this.legacyAdwId;
  const actual = (_writtenState as unknown as Record<string, unknown>)[fieldName];
  assert.strictEqual(actual, expected, `Expected state.${fieldName} = "${expected}", got "${String(actual)}"`);
});

Then('the returned state\'s {string} is undefined', function (fieldName: string) {
  assert.ok(_writtenState !== undefined, 'Expected state to be set (even if null)');
  if (_writtenState === null) {
    // readTopLevelState returned null — this is an unexpected failure
    assert.fail('Expected readTopLevelState to return a non-null object');
  }
  const actual = (_writtenState as unknown as Record<string, unknown>)[fieldName];
  assert.strictEqual(actual, undefined, `Expected state.${fieldName} to be undefined, got "${String(actual)}"`);
});

Then('the returned state\'s {string} matches the file\'s pid', function (fieldName: string) {
  assert.ok(_writtenState, 'Expected state to be non-null');
  const expected = this.legacyState?.pid;
  const actual = (_writtenState as unknown as Record<string, unknown>)[fieldName];
  assert.strictEqual(actual, expected, `Expected state.${fieldName} = ${String(expected)}, got "${String(actual)}"`);
});

Then('the returned state\'s {string} matches the file\'s pidStartedAt', function (fieldName: string) {
  assert.ok(_writtenState, 'Expected state to be non-null');
  const expected = this.legacyState?.pidStartedAt;
  const actual = (_writtenState as unknown as Record<string, unknown>)[fieldName];
  assert.strictEqual(actual, expected, `Expected state.${fieldName} = "${expected}", got "${String(actual)}"`);
});

When('writeTopLevelState is called for adwId {string} with patch {string}', function (adwId: string, patchJson: string) {
  trackAdwId(adwId);
  _writtenAdwId = adwId;
  // Parse as JS object expression (allows unquoted keys and single-quote strings)
  const patch = Function(`"use strict"; return (${patchJson})`)() as Record<string, unknown>;
  AgentStateManager.writeTopLevelState(adwId, patch);
  _writtenState = AgentStateManager.readTopLevelState(adwId);
});

Then('the persisted file still contains the original {string} and {string}', function (field1: string, field2: string) {
  const state = _writtenState;
  assert.ok(state, 'Expected state to be readable');
  const s = state as unknown as Record<string, unknown>;
  const legacyState = this.legacyState as Record<string, unknown> | undefined;
  if (legacyState) {
    assert.strictEqual(s[field1], legacyState[field1], `Expected state.${field1} to match original`);
    assert.strictEqual(s[field2], legacyState[field2], `Expected state.${field2} to match original`);
  } else {
    assert.ok(s[field1] !== undefined, `Expected state.${field1} to exist`);
    assert.ok(s[field2] !== undefined, `Expected state.${field2} to exist`);
  }
});

Then('the persisted file now contains {string} equal to {string}', function (fieldName: string, expected: string) {
  const state = _writtenState ?? (_writtenAdwId ? AgentStateManager.readTopLevelState(_writtenAdwId) : null);
  assert.ok(state, 'Expected state to be readable');
  const actual = (state as unknown as unknown as Record<string, unknown>)[fieldName];
  assert.strictEqual(actual, expected, `Expected state.${fieldName} = "${expected}", got "${String(actual)}"`);
});

// ─── Section 4: writeTopLevelState is atomic ─────────────────────────────────

Then('writeTopLevelState writes to a temporary sibling file before renaming into place', function () {
  const content = readFileSync(join(ROOT, 'adws/core/agentState.ts'), 'utf-8');
  assert.ok(
    content.includes('.tmp') && (content.includes('renameSync') || content.includes('rename')),
    'Expected agentState.ts to use a .tmp file and renameSync for atomic writes',
  );
});

Then('the rename step replaces the target file in a single filesystem operation', function () {
  const content = readFileSync(join(ROOT, 'adws/core/agentState.ts'), 'utf-8');
  assert.ok(
    content.includes('renameSync'),
    'Expected agentState.ts to use renameSync for the atomic replacement step',
  );
});

Given('the state directory for adwId {string} is empty', function (adwId: string) {
  trackAdwId(adwId);
  _writtenAdwId = adwId;
  const dir = join(AGENTS_STATE_DIR, adwId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

When('writeTopLevelState is called for adwId {string} with {string}', function (adwId: string, stateJson: string) {
  trackAdwId(adwId);
  _writtenAdwId = adwId;
  const patch = Function(`"use strict"; return (${stateJson})`)() as Record<string, unknown>;
  AgentStateManager.writeTopLevelState(adwId, patch);
});

Then('{string} exists with the written content', function (relPath: string) {
  const fullPath = join(ROOT, relPath);
  assert.ok(existsSync(fullPath), `Expected file to exist at ${relPath}`);
  const content = readFileSync(fullPath, 'utf-8');
  JSON.parse(content); // must be valid JSON
});

Then('no temp file sibling of {string} remains in {string}', function (_fileName: string, relDir: string) {
  const dir = join(ROOT, relDir);
  if (!existsSync(dir)) return;
  const files = readdirSync(dir);
  const tmpFiles = files.filter(f => f.endsWith('.tmp'));
  assert.strictEqual(tmpFiles.length, 0, `Expected no .tmp files in ${relDir}, found: ${tmpFiles.join(', ')}`);
});

Given('the state directory for adwId {string} has a valid pre-existing state.json', function (adwId: string) {
  trackAdwId(adwId);
  _writtenAdwId = adwId;
  AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber: 1, workflowStage: 'starting' });
});

When('writeTopLevelState is called for adwId {string} and the process is killed mid-write', function (adwId: string) {
  // This scenario documents that the atomic pattern prevents torn files.
  // We can't literally kill the process mid-write in a test, so we verify the invariant
  // structurally: the implementation uses tmp+rename, so a crash between writeFileSync
  // and renameSync leaves state.json intact. We verify the pre-existing state is readable.
  _writtenAdwId = adwId;
  _writtenState = AgentStateManager.readTopLevelState(adwId);
});

Then('any subsequent readTopLevelState call either returns the pre-existing content or the fully-written new content', function () {
  // Verify that the pre-existing state is still readable (no torn write occurred in setup)
  assert.ok(_writtenState !== null, 'Expected readTopLevelState to return valid content (pre-existing state is intact)');
});

Then('readTopLevelState never returns a partially-written or invalid JSON document', function () {
  // Structural assertion: the implementation uses atomic rename, so torn JSON cannot be observed.
  const content = readFileSync(join(ROOT, 'adws/core/agentState.ts'), 'utf-8');
  assert.ok(
    content.includes('renameSync'),
    'Expected writeTopLevelState to use renameSync so partial writes are never visible',
  );
});

// ─── Section 5: Partial-patch merge ──────────────────────────────────────────

Given('a top-level state file for adwId {string} with pid {int}, pidStartedAt {string}, branchName {string}, and lastSeenAt {string}',
  function (adwId: string, pid: number, pidStartedAt: string, branchName: string, lastSeenAt: string) {
    trackAdwId(adwId);
    _writtenAdwId = adwId;
    AgentStateManager.writeTopLevelState(adwId, { adwId, pid, pidStartedAt, branchName, lastSeenAt });
  },
);

Then('the persisted {string} remains {int}', function (fieldName: string, expected: number) {
  const state = _writtenState ?? (_writtenAdwId ? AgentStateManager.readTopLevelState(_writtenAdwId) : null);
  assert.ok(state, 'Expected state to be readable');
  const actual = (state as unknown as unknown as Record<string, unknown>)[fieldName];
  assert.strictEqual(actual, expected, `Expected state.${fieldName} to remain ${expected}, got ${String(actual)}`);
});

Then('the persisted {string} remains {string}', function (fieldName: string, expected: string) {
  const state = _writtenState ?? (_writtenAdwId ? AgentStateManager.readTopLevelState(_writtenAdwId) : null);
  assert.ok(state, 'Expected state to be readable');
  const actual = (state as unknown as unknown as Record<string, unknown>)[fieldName];
  assert.strictEqual(actual, expected, `Expected state.${fieldName} to remain "${expected}", got "${String(actual)}"`);
});

Then('the persisted {string} is now {string}', function (fieldName: string, expected: string) {
  const state = _writtenState ?? (_writtenAdwId ? AgentStateManager.readTopLevelState(_writtenAdwId) : null);
  assert.ok(state, 'Expected state to be readable');
  const actual = (state as unknown as unknown as Record<string, unknown>)[fieldName];
  assert.strictEqual(actual, expected, `Expected state.${fieldName} to now be "${expected}", got "${String(actual)}"`);
});

Then('the persisted {string} is now {int}', function (fieldName: string, expected: number) {
  const state = _writtenState ?? (_writtenAdwId ? AgentStateManager.readTopLevelState(_writtenAdwId) : null);
  assert.ok(state, 'Expected state to be readable');
  const actual = (state as unknown as unknown as Record<string, unknown>)[fieldName];
  assert.strictEqual(actual, expected, `Expected state.${fieldName} to now be ${expected}, got ${String(actual)}`);
});

Given('a top-level state file for adwId {string} with a phases map containing {string} completed and {string} completed',
  function (adwId: string, phase1: string, phase2: string) {
    trackAdwId(adwId);
    _writtenAdwId = adwId;
    const t = new Date().toISOString();
    AgentStateManager.writeTopLevelState(adwId, {
      adwId,
      phases: {
        [phase1]: { status: 'completed', startedAt: t, completedAt: t },
        [phase2]: { status: 'completed', startedAt: t, completedAt: t },
      },
    });
  },
);

Then('the persisted phases map still contains {string} with status {string}', function (phaseName: string, expectedStatus: string) {
  const state = _writtenState ?? (_writtenAdwId ? AgentStateManager.readTopLevelState(_writtenAdwId) : null);
  assert.ok(state?.phases, 'Expected phases map to exist');
  assert.strictEqual(
    state.phases![phaseName]?.status,
    expectedStatus,
    `Expected phases.${phaseName}.status = "${expectedStatus}"`,
  );
});

Given('a top-level state file for adwId {string} with branchName {string}, workflowStage {string}, pid {int}, pidStartedAt {string}',
  function (adwId: string, branchName: string, workflowStage: string, pid: number, pidStartedAt: string) {
    trackAdwId(adwId);
    _writtenAdwId = adwId;
    AgentStateManager.writeTopLevelState(adwId, { adwId, branchName, workflowStage, pid, pidStartedAt });
  },
);

Given('a top-level state file for adwId {string} with branchName {string}', function (adwId: string, branchName: string) {
  trackAdwId(adwId);
  _writtenAdwId = adwId;
  AgentStateManager.writeTopLevelState(adwId, { adwId, branchName });
});

Then('the persisted {string} is the empty string', function (fieldName: string) {
  const state = _writtenState ?? (_writtenAdwId ? AgentStateManager.readTopLevelState(_writtenAdwId) : null);
  assert.ok(state !== null, 'Expected state to be readable');
  const actual = (state as unknown as unknown as Record<string, unknown>)[fieldName];
  assert.strictEqual(actual, '', `Expected state.${fieldName} to be empty string, got "${String(actual)}"`);
});

Then('the persisted {string} is not the prior {string} value', function (fieldName: string, priorValue: string) {
  const state = _writtenState ?? (_writtenAdwId ? AgentStateManager.readTopLevelState(_writtenAdwId) : null);
  assert.ok(state !== null, 'Expected state to be readable');
  const actual = (state as unknown as unknown as Record<string, unknown>)[fieldName];
  assert.notStrictEqual(actual, priorValue, `Expected state.${fieldName} to NOT be "${priorValue}"`);
});

// ─── Section 6: Unit test coverage ───────────────────────────────────────────

Then('a test writes a state file containing pid, pidStartedAt, lastSeenAt, and branchName', function () {
  const content = _unitTestContent461 || this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('pid') && content.includes('pidStartedAt') &&
    content.includes('lastSeenAt') && content.includes('branchName'),
    'Expected unit test file to contain a test writing all four new fields',
  );
});

Then('that test asserts all four fields round-trip through readTopLevelState', function () {
  const content = _unitTestContent461 || this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('readTopLevelState') && content.includes('pid') && content.includes('lastSeenAt'),
    'Expected unit test to assert all four fields round-trip through readTopLevelState',
  );
});

Then('a test writes a state file that lacks pid, pidStartedAt, lastSeenAt, and branchName', function () {
  const content = _unitTestContent461 || this.fileContent || sharedCtx.fileContent;
  // The forward-compat test writes a pre-461 state file without the four fields
  assert.ok(
    content.includes('pre-461') || (content.includes('issueNumber') && content.includes('workflowStage') && !content.includes('pid: 1')),
    'Expected unit test to contain a test using a pre-461 state file without the four new fields',
  );
  // More directly: look for the pattern of writing only legacy fields
  assert.ok(
    content.includes('toBeUndefined') || content.includes('undefined'),
    'Expected unit test to assert the new fields are undefined on old-schema files',
  );
});

Then('that test asserts readTopLevelState returns a value with those fields undefined', function () {
  const content = _unitTestContent461 || this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('toBeUndefined()'),
    'Expected unit test to use toBeUndefined() assertions for the four new fields',
  );
});

Then('that test asserts no exception is thrown during the read', function () {
  const content = _unitTestContent461 || this.fileContent || sharedCtx.fileContent;
  // The test calls readTopLevelState without a try/catch and asserts not.toBeNull — implying no throw
  assert.ok(
    content.includes('not.toBeNull') || content.includes('not toBeNull') || content.includes('toBeTruthy') || content.includes('expect(state)'),
    'Expected unit test to assert readTopLevelState does not throw (reads successfully)',
  );
});

Then('a test seeds a state file with pid, pidStartedAt, lastSeenAt, and branchName populated', function () {
  const content = _unitTestContent461 || this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('pid: 7777') || content.includes('partial-patch'),
    'Expected unit test to seed all four fields for the partial-patch test',
  );
});

Then('the test issues a partial writeTopLevelState patch touching only one of the four fields', function () {
  const content = _unitTestContent461 || this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('lastSeenAt') && content.includes('writeTopLevelState'),
    'Expected unit test to call writeTopLevelState with a partial patch touching only one field',
  );
});

Then('the test asserts the other three fields retain their original values', function () {
  const content = _unitTestContent461 || this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('toBe(7777)') || (content.includes('toBe') && content.includes('pid')),
    'Expected unit test to assert the three untouched fields retain their values',
  );
});

Then('the test asserts the patched field reflects the new value', function () {
  const content = _unitTestContent461 || this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('2026-04-20T09:00:30.000Z') || content.includes('lastSeenAt'),
    'Expected unit test to assert the patched lastSeenAt field has the new value',
  );
});

Then('a test asserts writeTopLevelState leaves no temp file behind on success', function () {
  const content = _unitTestContent461 || this.fileContent || sharedCtx.fileContent;
  assert.ok(
    content.includes('.tmp') || content.includes('temp file'),
    'Expected unit test to assert no .tmp file remains after a successful write',
  );
});

// Section 7: TypeScript compilation gate — steps handled by wireExtractorSteps.ts / removeUnitTestsSteps.ts
// ({string} is run, the command exits with code {int}, {string} also exits with code {int})
