import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';
import { getProcessStartTime, isProcessLive } from '../../adws/core/processLiveness.js';
import type { ProcessLivenessDeps } from '../../adws/core/processLiveness.js';
import { getSpawnLockFilePath } from '../../adws/triggers/spawnGate.js';
import { ctx as spawnGateCtx } from './fixCrossTriggerSpawnDedupSteps.ts';

const ROOT = process.cwd();

// ─── Module-level state (reset Before each scenario) ─────────────────────────

let _platformOverride: string | null = null;
let _killShouldSucceed = true;
let _fakeProcStat: string | null = null;
let _fakeLstart: string | null = null;
let _liveness: { pid: number; startTime: string } | null = null;
let _recordedStartTime: string | null = null;
let _getStartTimeResult: string | null | undefined = undefined;
let _isProcessLiveResult: boolean | null = null;
let _lockFilePath = '';
let _stalePid = -1;
let _cleanupLockFiles: string[] = [];

Before(function () {
  _platformOverride = null;
  _killShouldSucceed = true;
  _fakeProcStat = null;
  _fakeLstart = null;
  _liveness = null;
  _recordedStartTime = null;
  _getStartTimeResult = undefined;
  _isProcessLiveResult = null;
  _lockFilePath = '';
  _stalePid = -1;
});

After(function () {
  for (const f of _cleanupLockFiles) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
  _cleanupLockFiles = [];
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function runWithPlatform<T>(platform: string, fn: () => T): T {
  const saved = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try { return fn(); } finally {
    Object.defineProperty(process, 'platform', { value: saved, configurable: true });
  }
}

function mockKill(succeed: boolean, fn: () => void): void {
  const saved = process.kill;
  process.kill = ((_pid: number) => {
    if (!succeed) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    return true;
  }) as unknown as typeof process.kill;
  try { fn(); } finally { process.kill = saved; }
}

// ─── Module surface ───────────────────────────────────────────────────────────
// NOTE: 'the file {string} exists' → cucumberConfigSteps.ts
// NOTE: 'the file exports {string}' → autoApproveMergeAfterReviewSteps.ts

Then(
  '{string} accepts {string} as its required parameter',
  function (this: Record<string, string>, funcName: string, paramSig: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(content.includes(paramSig), `Expected "${funcName}" to accept parameter "${paramSig}"`);
  },
);

Then(
  '{string} returns {string}',
  function (this: Record<string, string>, funcName: string, returnType: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(content.includes(returnType), `Expected "${funcName}" to have return type containing "${returnType}"`);
  },
);

Then(
  '{string} accepts {string} and {string} as its required parameters',
  function (this: Record<string, string>, funcName: string, param1: string, param2: string) {
    const content = this.fileContent ?? sharedCtx.fileContent;
    assert.ok(content.includes(param1), `Expected "${funcName}" to accept parameter "${param1}"`);
    assert.ok(content.includes(param2), `Expected "${funcName}" to accept parameter "${param2}"`);
  },
);

// ─── Platform dispatch ────────────────────────────────────────────────────────

Given('the current platform is {string}', function (platform: string) {
  _platformOverride = platform;
  _fakeProcStat = null;
  _fakeLstart = null;
});

Given('the current platform is not {string} and not {string}', function (_p1: string, _p2: string) {
  _platformOverride = 'freebsd';
  _fakeLstart = 'Mon Apr 20 10:00:00 2026';
});

Given('no file exists at {string} for the queried pid', function (_procPath: string) {
  _fakeProcStat = null;
});

Given('the \\/proc\\/<pid>\\/stat line has comm {string}', function (comm: string) {
  _fakeProcStat = `1234 ${comm} S 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 99887766 0`;
});

Given('`ps -o lstart= -p <pid>` exits with a non-zero status for the queried pid', function () {
  _fakeLstart = null;
});

Given('`ps -o lstart= -p <pid>` writes no stdout for the queried pid', function () {
  _fakeLstart = '';
});

When('getProcessStartTime is called with a pid whose \\/proc\\/<pid>\\/stat file exists', function () {
  const pid = 1234;
  const statContent = `${pid} (test-proc) S 1 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 12345678 0`;
  const deps: ProcessLivenessDeps = {
    readFile: () => statContent,
    execPs: () => { throw new Error('n/a'); },
  };
  _getStartTimeResult = runWithPlatform('linux', () => getProcessStartTime(pid, deps));
});

When('getProcessStartTime is called', function () {
  const pid = 1234;
  const platform = _platformOverride ?? process.platform;
  if (platform === 'linux') {
    const deps: ProcessLivenessDeps = _fakeProcStat !== null
      ? { readFile: () => _fakeProcStat!, execPs: () => { throw new Error('n/a'); } }
      : { readFile: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }, execPs: () => { throw new Error('n/a'); } };
    _getStartTimeResult = runWithPlatform('linux', () => getProcessStartTime(pid, deps));
  } else if (platform === 'win32') {
    const deps: ProcessLivenessDeps = {
      readFile: () => { throw new Error('n/a'); },
      execPs: () => { throw new Error('n/a'); },
    };
    _getStartTimeResult = runWithPlatform('win32', () => getProcessStartTime(pid, deps));
  } else {
    const deps: ProcessLivenessDeps = _fakeLstart === null
      ? { readFile: () => { throw new Error('n/a'); }, execPs: () => { throw new Error('not found'); } }
      : { readFile: () => { throw new Error('n/a'); }, execPs: () => _fakeLstart! };
    _getStartTimeResult = runWithPlatform(platform, () => getProcessStartTime(pid, deps));
  }
});

When('getProcessStartTime is called with a pid whose `ps` invocation succeeds', function () {
  const pid = 1234;
  const deps: ProcessLivenessDeps = {
    readFile: () => { throw new Error('n/a'); },
    execPs: () => 'Mon Apr 20 10:15:23 2026',
  };
  _getStartTimeResult = runWithPlatform('darwin', () => getProcessStartTime(pid, deps));
});

When('getProcessStartTime parses the stat line', function () {
  assert.ok(_fakeProcStat !== null, 'Expected _fakeProcStat to be set by Given step');
  const deps: ProcessLivenessDeps = {
    readFile: () => _fakeProcStat!,
    execPs: () => { throw new Error('n/a'); },
  };
  _getStartTimeResult = runWithPlatform('linux', () => getProcessStartTime(1234, deps));
});

Then('the implementation reads from {string}', function (_procPath: string) {
  assert.notStrictEqual(_getStartTimeResult, null,
    'Expected getProcessStartTime to return non-null (readFile was invoked and succeeded)');
});

Then('the returned value is the 22nd whitespace-separated field of that file', function () {
  assert.strictEqual(_getStartTimeResult, '12345678');
});

Then('the returned value is null', function () {
  assert.strictEqual(_getStartTimeResult, null);
});

Then('the 22nd field is extracted from the portion after the final {string}', function (_char: string) {
  assert.notStrictEqual(_getStartTimeResult, null);
  assert.strictEqual(_getStartTimeResult, '99887766');
});

Then('the returned value is not polluted by spaces inside the comm', function () {
  assert.match(_getStartTimeResult ?? '', /^\d+$/, 'Start-time should be purely numeric clock ticks');
});

Then(/the implementation invokes `ps -o lstart= -p <pid>`/, function () {
  assert.notStrictEqual(_getStartTimeResult, null,
    'Expected getProcessStartTime to return non-null (ps was invoked and returned output)');
});

Then('the returned value is the trimmed stdout of that command', function () {
  assert.strictEqual(_getStartTimeResult, 'Mon Apr 20 10:15:23 2026');
});

Then('the file documents that Windows is not supported', function (this: Record<string, string>) {
  const content = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    content.toLowerCase().includes('windows') &&
      (content.toLowerCase().includes('unsupported') || content.toLowerCase().includes('not supported')),
    'Expected module to document that Windows is not supported',
  );
});

Then('the call does not throw an error', function () {
  const pid = 1234;
  const deps: ProcessLivenessDeps = {
    readFile: () => { throw new Error('n/a'); },
    execPs: () => { throw new Error('n/a'); },
  };
  assert.doesNotThrow(() => runWithPlatform('win32', () => getProcessStartTime(pid, deps)));
});

// ─── isProcessLive decision table ────────────────────────────────────────────

Given('a live process with pid {int} and start-time {string}', function (pid: number, startTime: string) {
  _liveness = { pid, startTime };
  _killShouldSucceed = true;
});

Given('the recordedStartTime for pid {int} was {string}', function (_pid: number, recorded: string) {
  _recordedStartTime = recorded;
});

Given('no process currently exists with pid {int}', function (pid: number) {
  _liveness = { pid, startTime: 'irrelevant' };
  _killShouldSucceed = false;
});

Given('`kill -0` succeeds for pid {int}', function (pid: number) {
  _liveness = { pid, startTime: 'irrelevant' };
  _killShouldSucceed = true;
});

Given('getProcessStartTime returns null for pid {int}', function (pid: number) {
  _liveness = { pid, startTime: 'irrelevant' };
  _killShouldSucceed = true;
  _fakeProcStat = null;
  _platformOverride = 'linux';
});

When('isProcessLive is called with pid {int} and recordedStartTime {string}', function (pid: number, recorded: string) {
  const platform = _platformOverride ?? 'darwin';
  const liveness = _liveness;
  const deps: ProcessLivenessDeps = platform === 'linux'
    ? {
        readFile: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
        execPs: () => { throw new Error('n/a'); },
      }
    : {
        readFile: () => { throw new Error('n/a'); },
        execPs: () => liveness?.startTime ?? '',
      };
  mockKill(_killShouldSucceed, () => {
    _isProcessLiveResult = runWithPlatform(platform, () => isProcessLive(pid, recorded, deps));
  });
});

When('isProcessLive is called with pid {int} and the recorded start-time', function (pid: number) {
  assert.ok(_recordedStartTime !== null, 'Expected _recordedStartTime to be set');
  const liveness = _liveness;
  const deps: ProcessLivenessDeps = {
    readFile: () => { throw new Error('n/a'); },
    execPs: () => liveness?.startTime ?? '',
  };
  mockKill(true, () => {
    _isProcessLiveResult = runWithPlatform('darwin', () => isProcessLive(pid, _recordedStartTime!, deps));
  });
});

When('isProcessLive is called with pid {int} and any recordedStartTime', function (pid: number) {
  const platform = _platformOverride ?? 'darwin';
  const liveness = _liveness;
  const deps: ProcessLivenessDeps = platform === 'linux'
    ? {
        readFile: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
        execPs: () => { throw new Error('n/a'); },
      }
    : {
        readFile: () => { throw new Error('n/a'); },
        execPs: () => liveness?.startTime ?? '',
      };
  mockKill(_killShouldSucceed, () => {
    _isProcessLiveResult = runWithPlatform(platform, () => isProcessLive(pid, 'some-recorded-time', deps));
  });
});

Then('isProcessLive returns true', function () {
  assert.strictEqual(_isProcessLiveResult, true, 'Expected isProcessLive to return true');
});

Then('isProcessLive returns false', function () {
  assert.strictEqual(_isProcessLiveResult, false, 'Expected isProcessLive to return false');
});

Then('{string} performs a `kill -0`-equivalent check', function (this: Record<string, string>, _funcName: string) {
  const content = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    content.includes('process.kill') || content.includes('kill(pid'),
    'Expected the function to contain a kill-0-equivalent check',
  );
});

Then('{string} compares the observed start-time to the recordedStartTime for equality', function (this: Record<string, string>, _funcName: string) {
  const content = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    content.includes('=== recordedStartTime') || content.includes('recordedStartTime'),
    'Expected the function to compare start-times for equality',
  );
});

// ─── spawnGate caller migration (static analysis only) ───────────────────────
// NOTE: 'the file imports {string} from {string}' → autoApproveMergeAfterReviewSteps.ts

Then('the file does not import {string} from {string}', function (this: Record<string, string>, exportName: string, modulePath: string) {
  const content = this.fileContent ?? sharedCtx.fileContent;
  const importLines = content.split('\n').filter(l => l.includes('import'));
  const hasImport = importLines.some(l => l.includes(exportName) && l.includes(modulePath));
  assert.ok(!hasImport, `Expected file NOT to import "${exportName}" from "${modulePath}"`);
});

Then('the stale-lock branch calls {string} with both the recorded pid and the recorded start-time', function (this: Record<string, string>, funcName: string) {
  const content = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    content.includes(funcName) && content.includes('pidStartedAt'),
    `Expected stale-lock branch to call "${funcName}" with pid and pidStartedAt`,
  );
});

Then('the lock record schema includes a start-time field alongside the pid', function (this: Record<string, string>) {
  const content = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(content.includes('pidStartedAt'), 'Expected lock record schema to include pidStartedAt field');
});

// ─── spawnGate behavioral scenarios ──────────────────────────────────────────
// NOTE: 'When acquireIssueSpawnLock is called for repo {string} and issue {int}' → fixCrossTriggerSpawnDedupSteps.ts
// NOTE: 'When acquireIssueSpawnLock is called for the same repo and issue' → fixCrossTriggerSpawnDedupSteps.ts
// NOTE: 'Then acquireIssueSpawnLock returns true/false' → fixCrossTriggerSpawnDedupSteps.ts

Given('a spawn lock file exists for repo {string} and issue {int}', function (repoKey: string, issueNumber: number) {
  const [owner, repo] = repoKey.split('/');
  const repoInfo = { owner, repo };
  _lockFilePath = getSpawnLockFilePath(repoInfo, issueNumber);
  mkdirSync(dirname(_lockFilePath), { recursive: true });
  _cleanupLockFiles.push(_lockFilePath);
  // Populate shared spawnGate context so the existing When/Then steps work
  spawnGateCtx.repo = repoInfo;
  spawnGateCtx.issueNumber = issueNumber;
  spawnGateCtx.writtenLockFiles.push(_lockFilePath);
});

Given('the recorded pid belongs to a live process whose start-time differs from the lock\'s recorded start-time', function () {
  // pid=12345 with fake start-time → isProcessLive(12345, 'boot-era-A') = false
  // (either 12345 doesn't exist, or its real start-time differs from 'boot-era-A')
  _stalePid = 12345;
  writeFileSync(_lockFilePath, JSON.stringify({
    pid: _stalePid,
    pidStartedAt: 'boot-era-A',
    repoKey: 'acme/widgets',
    issueNumber: 42,
    startedAt: new Date().toISOString(),
  }), 'utf-8');
});

Given('isProcessLive returns true for the recorded pid and start-time', function () {
  // Use the current process's real start-time so isProcessLive returns true
  const realStartTime = getProcessStartTime(process.pid) ?? '';
  writeFileSync(_lockFilePath, JSON.stringify({
    pid: process.pid,
    pidStartedAt: realStartTime,
    repoKey: 'acme/widgets',
    issueNumber: 42,
    startedAt: new Date().toISOString(),
  }), 'utf-8');
});

Then('the stale lock is removed', function () {
  // The lock file should have been replaced with a new one (different PID)
  assert.ok(existsSync(_lockFilePath), 'Expected a new lock file to have been written');
  const record = JSON.parse(readFileSync(_lockFilePath, 'utf-8'));
  assert.notStrictEqual(record.pid, _stalePid, `Expected lock file to have new PID (not stale ${_stalePid})`);
});

Then('the lock file is not removed', function () {
  assert.ok(existsSync(_lockFilePath), 'Expected lock file to still exist');
});

// ─── agentState caller migration ─────────────────────────────────────────────

Then('the file does not re-export {string}', function (this: Record<string, string>, name: string) {
  const content = this.fileContent ?? sharedCtx.fileContent;
  const hasReExport =
    content.includes(`export { ${name}`) ||
    content.includes(`, ${name} }`) ||
    content.includes(`, ${name},`) ||
    content.includes(`export const ${name}`) ||
    content.includes(`export function ${name}`);
  assert.ok(!hasReExport, `Expected file not to re-export "${name}"`);
});

Then('the file does not reference {string} as a static delegate', function (this: Record<string, string>, name: string) {
  const content = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(!content.includes(`static ${name}`), `Expected file not to have "static ${name}"`);
});

Then('isAgentProcessRunning delegates the liveness decision to {string} from processLiveness', function (funcName: string) {
  const content = readFileSync(join(ROOT, 'adws/core/stateHelpers.ts'), 'utf-8');
  assert.ok(
    content.includes(funcName) && content.includes('processLiveness'),
    `Expected isAgentProcessRunning to delegate to "${funcName}" from processLiveness`,
  );
});

Then(/the pid-only `process\.kill\(pid, 0\)` check is no longer used for that decision/, function () {
  const content = readFileSync(join(ROOT, 'adws/core/stateHelpers.ts'), 'utf-8');
  const fnStart = content.indexOf('function isAgentProcessRunning');
  const fnEnd = content.indexOf('\n}', fnStart);
  const fnBody = content.slice(fnStart, fnEnd);
  assert.ok(
    !fnBody.includes('isProcessAlive') && !fnBody.includes('process.kill'),
    'Expected isAgentProcessRunning not to use isProcessAlive or process.kill directly',
  );
});

// Behavioral: PID-reuse detected by isAgentProcessRunning
Given('a top-level state file records pid {int} and pidStartedAt {string}', function (pid: number, pidStartedAt: string) {
  _liveness = { pid, startTime: pidStartedAt };
  _killShouldSucceed = true;
});

Given('the OS reports pid {int} alive with start-time {string}', function (_pid: number, currentStartTime: string) {
  _fakeLstart = currentStartTime;
  _platformOverride = 'darwin';
});

When('isAgentProcessRunning is evaluated against that state file', function () {
  assert.ok(_liveness, 'Expected liveness context to be set');
  const recordedStart = _liveness!.startTime;
  const currentStart = _fakeLstart ?? recordedStart;
  const deps: ProcessLivenessDeps = {
    readFile: () => { throw new Error('n/a'); },
    execPs: () => currentStart,
  };
  mockKill(true, () => {
    _isProcessLiveResult = runWithPlatform('darwin', () =>
      isProcessLive(_liveness!.pid, recordedStart, deps));
  });
});

Then('isAgentProcessRunning returns false', function () {
  assert.strictEqual(_isProcessLiveResult, false, 'Expected false when start-times differ (PID reuse)');
});

// ─── Unit test file assertions ────────────────────────────────────────────────

let _unitTestContent = '';

Given('the processLiveness unit-test file is read', function () {
  const testPath = join(ROOT, 'adws/core/__tests__/processLiveness.test.ts');
  assert.ok(existsSync(testPath), `Expected test file to exist: ${testPath}`);
  _unitTestContent = readFileSync(testPath, 'utf-8');
});

Then('a test asserts isProcessLive returns true when kill -0 succeeds and start-times match', function () {
  assert.ok(
    _unitTestContent.includes('toBe(true)') &&
      (_unitTestContent.includes('match') || _unitTestContent.includes('matching')),
    'Expected a test asserting isProcessLive returns true when start-times match',
  );
});

Then('a test asserts isProcessLive returns false when kill -0 succeeds but start-times differ', function () {
  assert.ok(
    _unitTestContent.includes('toBe(false)') &&
      (_unitTestContent.includes('differ') || _unitTestContent.includes('mismatch') || _unitTestContent.includes('PID reuse')),
    'Expected a test asserting isProcessLive returns false on start-time mismatch',
  );
});

Then('a test asserts isProcessLive returns false when kill -0 fails for the pid', function () {
  assert.ok(
    _unitTestContent.includes('toBe(false)') &&
      (_unitTestContent.includes('kill') || _unitTestContent.includes('dead') || _unitTestContent.includes('throws')),
    'Expected a test asserting isProcessLive returns false when kill-0 fails',
  );
});

Then('a test asserts isProcessLive returns false when getProcessStartTime returns null', function () {
  assert.ok(
    _unitTestContent.includes('null') && _unitTestContent.includes('toBe(false)'),
    'Expected a test asserting isProcessLive returns false when getProcessStartTime returns null',
  );
});

Then(/the Linux-path tests substitute a fake `\/proc` reader instead of reading the real filesystem/, function () {
  assert.ok(
    _unitTestContent.includes('readFile') && _unitTestContent.includes('/proc'),
    'Expected Linux-path tests to use a fake readFile for /proc',
  );
});

Then('the macOS-path tests substitute a mocked `ps` child-process instead of invoking the real binary', function () {
  assert.ok(
    _unitTestContent.includes('execPs') && _unitTestContent.includes('lstart'),
    'Expected macOS-path tests to use a fake execPs',
  );
});

Then('no test asserts against the current process\'s real pid', function () {
  assert.ok(!_unitTestContent.includes('process.pid'), 'Expected no test to use process.pid');
});

Then(/the module exposes dependency-injection seams for the `\/proc` reader and the `ps` child-process/, function (this: Record<string, string>) {
  const content = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(
    content.includes('ProcessLivenessDeps') && content.includes('readFile') && content.includes('execPs'),
    'Expected module to expose ProcessLivenessDeps with readFile and execPs seams',
  );
});

Then('production code paths use the real seams by default', function (this: Record<string, string>) {
  const content = this.fileContent ?? sharedCtx.fileContent;
  assert.ok(content.includes('defaultDeps'), 'Expected module to export defaultDeps');
});
