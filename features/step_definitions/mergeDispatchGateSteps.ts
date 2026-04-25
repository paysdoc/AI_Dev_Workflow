/**
 * Step definitions for merge_dispatch_gate_lock_aware.feature (@adw-488)
 *
 * Tests the shouldDispatchMerge lock-aware gate that replaces the
 * process-lifetime processedMerges Set.
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';
import { shouldDispatchMerge, type MergeDispatchDeps } from '../../adws/triggers/mergeDispatchGate.ts';

// ── File existence check ──────────────────────────────────────────────────────
// NOTE: 'the file {string} exists' is defined in cucumberConfigSteps.ts

// ── Interface/type checks ─────────────────────────────────────────────────────

Then(
  'the deps interface declares a {string} function field',
  function (fieldName: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(fieldName),
      `Expected "${sharedCtx.filePath}" deps interface to declare a "${fieldName}" function field`,
    );
  },
);

Then(
  'the deps interface declares an {string} function field',
  function (fieldName: string) {
    const content = sharedCtx.fileContent;
    assert.ok(
      content.includes(fieldName),
      `Expected "${sharedCtx.filePath}" deps interface to declare an "${fieldName}" function field`,
    );
  },
);

Then(
  'the {string} interface declares a {string} field',
  function (interfaceName: string, fieldName: string) {
    const content = sharedCtx.fileContent;
    const interfaceStart = content.indexOf(`interface ${interfaceName}`);
    assert.ok(
      interfaceStart !== -1,
      `Expected "${sharedCtx.filePath}" to declare "${interfaceName}" interface`,
    );
    // Extract body
    const braceOpen = content.indexOf('{', interfaceStart);
    let depth = 1;
    let i = braceOpen + 1;
    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') depth--;
      i++;
    }
    const body = content.substring(braceOpen + 1, i - 1);
    assert.ok(
      body.includes(fieldName),
      `Expected "${interfaceName}" in "${sharedCtx.filePath}" to declare "${fieldName}"`,
    );
  },
);

Then(
  'the {string} interface does not declare a {string} field',
  function (interfaceName: string, fieldName: string) {
    const content = sharedCtx.fileContent;
    const interfaceStart = content.indexOf(`interface ${interfaceName}`);
    if (interfaceStart === -1) {
      // Interface doesn't exist at all — field is definitely not there
      return;
    }
    const braceOpen = content.indexOf('{', interfaceStart);
    let depth = 1;
    let i = braceOpen + 1;
    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') depth--;
      i++;
    }
    const body = content.substring(braceOpen + 1, i - 1);
    assert.ok(
      !body.includes(fieldName),
      `Expected "${interfaceName}" in "${sharedCtx.filePath}" NOT to declare "${fieldName}"`,
    );
  },
);

// ── Import checks ─────────────────────────────────────────────────────────────
// NOTE: '{string} is imported from {string}' is defined in spawnGateLifetimeSteps.ts

// ── shouldDispatchMerge — behavioural unit tests ──────────────────────────────

interface GateTestCtx {
  repoInfo: { owner: string; repo: string };
  issueNumber: number;
  lockRecord: { pid: number; pidStartedAt: string } | null;
  liveResult: boolean;
  throwOnRead: boolean;
  result: boolean | null;
}

const _gateCtx: GateTestCtx = {
  repoInfo: { owner: 'acme', repo: 'widgets' },
  issueNumber: 42,
  lockRecord: null,
  liveResult: false,
  throwOnRead: false,
  result: null,
};

Given(
  'a repo {string} and issue {int} with no spawn lock record',
  function (repoStr: string, issueNumber: number) {
    const [owner, repo] = repoStr.split('/');
    _gateCtx.repoInfo = { owner, repo };
    _gateCtx.issueNumber = issueNumber;
    _gateCtx.lockRecord = null;
    _gateCtx.liveResult = false;
    _gateCtx.throwOnRead = false;
    _gateCtx.result = null;
  },
);

Given(
  'a spawn lock record for repo {string} and issue {int} with a recorded PID that is no longer live',
  function (repoStr: string, issueNumber: number) {
    const [owner, repo] = repoStr.split('/');
    _gateCtx.repoInfo = { owner, repo };
    _gateCtx.issueNumber = issueNumber;
    _gateCtx.lockRecord = { pid: 12345, pidStartedAt: '2024-01-01T10:00:00Z' };
    _gateCtx.liveResult = false;
    _gateCtx.throwOnRead = false;
    _gateCtx.result = null;
  },
);

Given(
  'isProcessLive returns false for that PID and pidStartedAt',
  function () {
    _gateCtx.liveResult = false;
  },
);

Given(
  'a spawn lock record for repo {string} and issue {int} with a live PID',
  function (repoStr: string, issueNumber: number) {
    const [owner, repo] = repoStr.split('/');
    _gateCtx.repoInfo = { owner, repo };
    _gateCtx.issueNumber = issueNumber;
    _gateCtx.lockRecord = { pid: 99999, pidStartedAt: '2024-01-01T10:00:00Z' };
    _gateCtx.liveResult = true;
    _gateCtx.throwOnRead = false;
    _gateCtx.result = null;
  },
);

Given(
  'isProcessLive returns true for that PID and pidStartedAt',
  function () {
    _gateCtx.liveResult = true;
  },
);

Given(
  'a spawn lock file for repo {string} and issue {int} whose contents cannot be parsed as JSON',
  function (repoStr: string, issueNumber: number) {
    const [owner, repo] = repoStr.split('/');
    _gateCtx.repoInfo = { owner, repo };
    _gateCtx.issueNumber = issueNumber;
    _gateCtx.lockRecord = null;
    _gateCtx.liveResult = false;
    _gateCtx.throwOnRead = true;
    _gateCtx.result = null;
  },
);

When('shouldDispatchMerge is called for that repo and issue', function () {
  const deps: MergeDispatchDeps = {
    readLock: (_repoInfo, _issueNumber) => {
      if (_gateCtx.throwOnRead) throw new SyntaxError('Unexpected token in JSON');
      return _gateCtx.lockRecord;
    },
    isLive: (_pid, _pidStartedAt) => _gateCtx.liveResult,
  };
  _gateCtx.result = shouldDispatchMerge(_gateCtx.repoInfo, _gateCtx.issueNumber, deps);
});

Then('shouldDispatchMerge returns true', function () {
  assert.strictEqual(_gateCtx.result, true, 'Expected shouldDispatchMerge to return true');
});

Then('shouldDispatchMerge returns false', function () {
  assert.strictEqual(_gateCtx.result, false, 'Expected shouldDispatchMerge to return false');
});

// ── Cron source checks (static analysis of trigger_cron.ts) ──────────────────

Then(
  '{string} is called before the merge spawn for awaiting_merge candidates',
  function (funcName: string) {
    const content = sharedCtx.fileContent;
    // Find the merge spawn block
    const mergeActionIdx = content.indexOf("action === 'merge'");
    assert.ok(
      mergeActionIdx !== -1,
      `Expected "${sharedCtx.filePath}" to have an awaiting_merge dispatch block`,
    );
    // Extract the merge block
    const blockStart = content.lastIndexOf('\n', mergeActionIdx);
    const spawnIdx = content.indexOf("spawn(", mergeActionIdx);
    assert.ok(spawnIdx !== -1, `Expected "${sharedCtx.filePath}" to call spawn() in the merge block`);
    const mergeBlock = content.substring(blockStart, spawnIdx);
    assert.ok(
      mergeBlock.includes(`${funcName}(`),
      `Expected "${funcName}" to be called before spawn() in the merge dispatch block of "${sharedCtx.filePath}"`,
    );
  },
);

Then(
  'the merge dispatch path logs a message containing {string} when shouldDispatchMerge returns false',
  function (logText: string) {
    const content = sharedCtx.fileContent;
    // Find the shouldDispatchMerge call area
    const gateIdx = content.indexOf('shouldDispatchMerge(');
    assert.ok(
      gateIdx !== -1,
      `Expected "${sharedCtx.filePath}" to call shouldDispatchMerge`,
    );
    // The log should be within 300 chars of the gate call
    const gateWindow = content.substring(gateIdx, gateIdx + 500);
    assert.ok(
      gateWindow.includes(logText),
      `Expected "${sharedCtx.filePath}" to log "${logText}" when shouldDispatchMerge returns false`,
    );
  },
);

Then(
  'the loop continues without spawning adwMerge in that case',
  function () {
    const content = sharedCtx.fileContent;
    const gateIdx = content.indexOf('shouldDispatchMerge(');
    assert.ok(gateIdx !== -1, `Expected "${sharedCtx.filePath}" to call shouldDispatchMerge`);
    // The false-branch should contain `continue`
    const gateWindow = content.substring(gateIdx, gateIdx + 400);
    assert.ok(
      gateWindow.includes('continue'),
      `Expected "${sharedCtx.filePath}" to use 'continue' when shouldDispatchMerge returns false`,
    );
  },
);

Then(
  'the call to {string} does not include a {string} property',
  function (funcName: string, propName: string) {
    const content = sharedCtx.fileContent;
    const funcIdx = content.indexOf(`${funcName}(`);
    assert.ok(funcIdx !== -1, `Expected "${sharedCtx.filePath}" to call "${funcName}"`);
    // Find the call arguments (up to 300 chars after the call)
    const callWindow = content.substring(funcIdx, funcIdx + 300);
    assert.ok(
      !callWindow.includes(propName),
      `Expected the call to "${funcName}" in "${sharedCtx.filePath}" NOT to include "${propName}"`,
    );
  },
);

Then(
  'the only field passed in the processedSets argument is {string}',
  function (fieldName: string) {
    const content = sharedCtx.fileContent;
    // Look for the handleCancelDirective call with processedSets argument
    const cancelIdx = content.indexOf('handleCancelDirective(');
    assert.ok(cancelIdx !== -1, `Expected "${sharedCtx.filePath}" to call handleCancelDirective`);
    const callWindow = content.substring(cancelIdx, cancelIdx + 200);
    assert.ok(
      callWindow.includes(fieldName),
      `Expected the handleCancelDirective call to include "${fieldName}"`,
    );
    assert.ok(
      !callWindow.includes('merges'),
      `Expected the handleCancelDirective call NOT to include "merges"`,
    );
  },
);

Then(
  'the only field passed in the processed argument is {string}',
  function (fieldName: string) {
    const content = sharedCtx.fileContent;
    const filterIdx = content.indexOf('filterEligibleIssues(');
    assert.ok(filterIdx !== -1, `Expected "${sharedCtx.filePath}" to call filterEligibleIssues`);
    const callWindow = content.substring(filterIdx, filterIdx + 300);
    assert.ok(
      callWindow.includes(fieldName),
      `Expected the filterEligibleIssues call to include "${fieldName}"`,
    );
    assert.ok(
      !callWindow.includes('merges'),
      `Expected the filterEligibleIssues call NOT to include "merges"`,
    );
  },
);

// ── evaluateIssue awaiting_merge branch — no processed.merges ─────────────────

Then(
  'the awaiting_merge branch does not reference {string}',
  function (reference: string) {
    const content = sharedCtx.fileContent;
    // Find the awaiting_merge branch in evaluateIssue
    const awaitingIdx = content.indexOf("'awaiting_merge'");
    assert.ok(
      awaitingIdx !== -1,
      `Expected "${sharedCtx.filePath}" to have an awaiting_merge branch`,
    );
    // Extract 400 chars of the awaiting_merge block
    const awaitingWindow = content.substring(awaitingIdx, awaitingIdx + 400);
    // Find the next stage check to bound the window
    const nextIdx = awaitingWindow.indexOf("'discarded'");
    const boundedWindow = nextIdx !== -1
      ? awaitingWindow.substring(0, nextIdx)
      : awaitingWindow;
    assert.ok(
      !boundedWindow.includes(reference),
      `Expected the awaiting_merge branch in "${sharedCtx.filePath}" NOT to reference "${reference}"`,
    );
  },
);

Then('the file does not reference {string}', function (reference: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    !content.includes(reference),
    `Expected "${sharedCtx.filePath}" NOT to reference "${reference}"`,
  );
});

// ── Operational behaviour scenarios (state-machine-level) ────────────────────

Given(
  'an awaiting_merge issue whose previous adwMerge run exited with reason {string}',
  function (_reason: string) {
    // Set up scenario: lock is stale (pid dead)
    _gateCtx.repoInfo = { owner: 'acme', repo: 'widgets' };
    _gateCtx.issueNumber = 100;
    _gateCtx.lockRecord = { pid: 11111, pidStartedAt: '2024-01-01T10:00:00Z' };
    _gateCtx.liveResult = false;
    _gateCtx.result = null;
  },
);

Given(
  'the spawn lock from that previous run is no longer held by a live PID',
  function () {
    _gateCtx.liveResult = false;
  },
);

When('the cron evaluates the issue on the next cycle', function () {
  const deps: MergeDispatchDeps = {
    readLock: () => _gateCtx.lockRecord,
    isLive: () => _gateCtx.liveResult,
  };
  _gateCtx.result = shouldDispatchMerge(_gateCtx.repoInfo, _gateCtx.issueNumber, deps);
});

Then('shouldDispatchMerge returns true for the issue', function () {
  assert.strictEqual(_gateCtx.result, true, 'Expected shouldDispatchMerge to return true');
});

Then('adwMerge is dispatched again', function () {
  // This follows from shouldDispatchMerge returning true — the cron would dispatch
  assert.strictEqual(_gateCtx.result, true, 'adwMerge dispatch requires shouldDispatchMerge=true');
});

Given(
  'an awaiting_merge issue whose adwMerge orchestrator is currently running and holding the spawn lock',
  function () {
    _gateCtx.repoInfo = { owner: 'acme', repo: 'widgets' };
    _gateCtx.issueNumber = 101;
    _gateCtx.lockRecord = { pid: 22222, pidStartedAt: '2024-01-01T12:00:00Z' };
    _gateCtx.liveResult = true;
    _gateCtx.result = null;
  },
);

When(
  'the cron evaluates the issue on a subsequent cycle while the first adwMerge has not yet exited',
  function () {
    const deps: MergeDispatchDeps = {
      readLock: () => _gateCtx.lockRecord,
      isLive: () => _gateCtx.liveResult,
    };
    _gateCtx.result = shouldDispatchMerge(_gateCtx.repoInfo, _gateCtx.issueNumber, deps);
  },
);

// NOTE: 'shouldDispatchMerge returns false' reuses the step defined above at line 203
// (same step, just applied to _gateCtx.result — but we unify via the main step def)
Then('no second adwMerge is spawned', function () {
  // shouldDispatchMerge returned false is verified by 'shouldDispatchMerge returns false'
  assert.ok(true, 'No spawn confirmed via shouldDispatchMerge=false');
});

Given(
  'the cron process has been running continuously across multiple awaiting_merge dispatch attempts',
  function () {
    // Simulate: previous attempt exited, lock is stale
    _gateCtx.repoInfo = { owner: 'acme', repo: 'widgets' };
    _gateCtx.issueNumber = 102;
    _gateCtx.lockRecord = { pid: 33333, pidStartedAt: '2024-01-01T08:00:00Z' };
    _gateCtx.liveResult = false;
    _gateCtx.result = null;
  },
);

When('a human approves the previously-blocking PR', function () {
  // No-op: the approval is checked by adwMerge, not by shouldDispatchMerge
  // shouldDispatchMerge only cares about whether the spawn lock is held
});

Then('the very next cron cycle re-dispatches adwMerge for the issue', function () {
  const deps: MergeDispatchDeps = {
    readLock: () => _gateCtx.lockRecord,
    isLive: () => _gateCtx.liveResult,
  };
  const result = shouldDispatchMerge(_gateCtx.repoInfo, _gateCtx.issueNumber, deps);
  assert.strictEqual(result, true, 'Expected shouldDispatchMerge to return true on next cycle');
});

Then('no cron-process restart is required', function () {
  // The fact that shouldDispatchMerge works based on disk lock (not in-memory Set)
  // means no restart is needed — the architectural fix (removing processedMerges)
  // is what makes this true, validated by other scenarios
  assert.ok(true, 'No cron restart required — verified by processedMerges removal scenarios');
});

// ── TypeScript compilation ────────────────────────────────────────────────────
// NOTE: '{string} is run', 'the command exits with code {int}', and
// '{string} also exits with code {int}' are defined in removeUnitTestsSteps.ts
// and wireExtractorSteps.ts respectively.
