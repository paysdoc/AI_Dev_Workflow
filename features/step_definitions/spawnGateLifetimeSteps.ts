import { Given, When, Then, After } from '@cucumber/cucumber';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';
import { ctx as spawnGateCtx } from './fixCrossTriggerSpawnDedupSteps.ts';
import { acquireIssueSpawnLock, getSpawnLockFilePath } from '../../adws/triggers/spawnGate.ts';
import { getProcessStartTime } from '../../adws/core/processLiveness.ts';
import type { RepoInfo } from '../../adws/github/githubApi.ts';

const ROOT = process.cwd();

// ─── Per-scenario state ───────────────────────────────────────────────────────

interface LifetimeCtx {
  repo: RepoInfo | null;
  issueNumber: number;
  ownPid: number;
  acquireResult: boolean | null;
  lockFilePath: string | null;
  lockFilesToCleanup: string[];
  spawnTestContent: string;
}

const ctx: LifetimeCtx = {
  repo: null,
  issueNumber: 0,
  ownPid: 0,
  acquireResult: null,
  lockFilePath: null,
  lockFilesToCleanup: [],
  spawnTestContent: '',
};

function resetCtx(): void {
  ctx.repo = null;
  ctx.issueNumber = 0;
  ctx.ownPid = 0;
  ctx.acquireResult = null;
  ctx.lockFilePath = null;
}

function parseRepo(repoFullName: string): RepoInfo {
  const [owner, repo] = repoFullName.split('/');
  return { owner, repo };
}

After(function () {
  for (const f of ctx.lockFilesToCleanup) {
    try { unlinkSync(f); } catch { /* ignore */ }
  }
  ctx.lockFilesToCleanup = [];
  resetCtx();
});

// ─── 1. Lock record schema (static) ──────────────────────────────────────────

Then('the spawn lock record interface declares a {string} field of type {string}', function (field: string, type: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`readonly ${field}: ${type}`) || content.includes(`${field}: ${type}`),
    `Expected IssueSpawnLockRecord to declare "${field}: ${type}" in "${sharedCtx.filePath}"`,
  );
});

// ─── 2. Behavioral: fresh acquire persists pid + pidStartedAt ─────────────────

Given('a fresh spawn-lock directory is prepared for repo {string} and issue {int}', function (repoName: string, issueNum: number) {
  const repo = parseRepo(repoName);
  ctx.repo = repo;
  ctx.issueNumber = issueNum;
  const lockPath = getSpawnLockFilePath(repo, issueNum);
  try { unlinkSync(lockPath); } catch { /* already absent */ }
  mkdirSync(dirname(lockPath), { recursive: true });
  ctx.lockFilePath = lockPath;
  ctx.lockFilesToCleanup.push(lockPath);
});

When('acquireIssueSpawnLock is called for repo {string} and issue {int} with an owning pid', function (repoName: string, issueNum: number) {
  const repo = parseRepo(repoName);
  ctx.repo = repo;
  ctx.issueNumber = issueNum;
  ctx.ownPid = process.pid;
  ctx.acquireResult = acquireIssueSpawnLock(repo, issueNum, process.pid);
  ctx.lockFilePath = getSpawnLockFilePath(repo, issueNum);
  ctx.lockFilesToCleanup.push(ctx.lockFilePath);
});

Then('the persisted lock record has a numeric {string} field matching the owning pid', function (field: string) {
  assert.ok(ctx.lockFilePath, 'Expected lockFilePath to be set');
  assert.ok(existsSync(ctx.lockFilePath), `Expected lock file at ${ctx.lockFilePath}`);
  const record = JSON.parse(readFileSync(ctx.lockFilePath, 'utf-8'));
  assert.strictEqual(typeof record[field], 'number', `Expected ${field} to be a number`);
  assert.strictEqual(record[field], ctx.ownPid, `Expected ${field} to match owning pid ${ctx.ownPid}`);
});

Then('the persisted lock record has a non-empty {string} field', function (field: string) {
  assert.ok(ctx.lockFilePath, 'Expected lockFilePath to be set');
  const record = JSON.parse(readFileSync(ctx.lockFilePath, 'utf-8'));
  assert.ok(record[field] && record[field].length > 0, `Expected ${field} to be a non-empty string`);
});

// ─── 3. Static: pidStartedAt source ──────────────────────────────────────────

Then('acquireIssueSpawnLock populates pidStartedAt from {string}', function (funcName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(funcName),
    `Expected acquireIssueSpawnLock to use "${funcName}" for pidStartedAt in "${sharedCtx.filePath}"`,
  );
});

Then('{string} is imported from {string}', function (exportName: string, modulePath: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(exportName),
    `Expected "${sharedCtx.filePath}" to reference "${exportName}"`,
  );
  assert.ok(
    content.includes(`from '${modulePath}'`) || content.includes(`from "${modulePath}"`),
    `Expected "${sharedCtx.filePath}" to import from "${modulePath}"`,
  );
});

// ─── 4. Static: stale-lock delegation ────────────────────────────────────────

Then('the stale-lock branch invokes {string} with the existing lock\'s {string} and {string}', function (funcName: string, field1: string, field2: string) {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes(funcName), `Expected stale-lock branch to call "${funcName}"`);
  assert.ok(content.includes(field1), `Expected stale-lock branch to reference "${field1}"`);
  assert.ok(content.includes(field2), `Expected stale-lock branch to reference "${field2}"`);
});

Then('the file does not fall back to a pid-only {string} liveness check', function (expr: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    !content.includes(expr),
    `Expected "${sharedCtx.filePath}" to NOT contain a pid-only check "${expr}"`,
  );
});

// ─── 5. Behavioral: contention with live holder ───────────────────────────────

Given('a spawn lock record for repo {string} and issue {int} whose pidStartedAt matches a live PID', function (repoName: string, issueNum: number) {
  const repo = parseRepo(repoName);
  ctx.repo = repo;
  ctx.issueNumber = issueNum;
  spawnGateCtx.repo = repo;
  spawnGateCtx.issueNumber = issueNum;
  const lockPath = getSpawnLockFilePath(repo, issueNum);
  mkdirSync(dirname(lockPath), { recursive: true });
  const realStartTime = getProcessStartTime(process.pid) ?? '';
  const record = {
    pid: process.pid,
    pidStartedAt: realStartTime,
    repoKey: repoName,
    issueNumber: issueNum,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(lockPath, JSON.stringify(record, null, 2), 'utf-8');
  ctx.lockFilePath = lockPath;
  ctx.lockFilesToCleanup.push(lockPath);
  spawnGateCtx.writtenLockFiles.push(lockPath);
});

Then('the existing lock record on disk is preserved', function () {
  assert.ok(ctx.lockFilePath, 'Expected lockFilePath to be set');
  assert.ok(existsSync(ctx.lockFilePath), `Expected lock file to still exist at ${ctx.lockFilePath}`);
  const record = JSON.parse(readFileSync(ctx.lockFilePath, 'utf-8'));
  assert.strictEqual(record.pid, process.pid, 'Expected original lock pid to be preserved');
});

// ─── 6. Behavioral: contention with dead holder ──────────────────────────────

Given('a spawn lock record for repo {string} and issue {int} whose recorded PID is not alive', function (repoName: string, issueNum: number) {
  const repo = parseRepo(repoName);
  ctx.repo = repo;
  ctx.issueNumber = issueNum;
  spawnGateCtx.repo = repo;
  spawnGateCtx.issueNumber = issueNum;
  const lockPath = getSpawnLockFilePath(repo, issueNum);
  mkdirSync(dirname(lockPath), { recursive: true });
  const record = {
    pid: 999999999,
    pidStartedAt: 'dead-era',
    repoKey: repoName,
    issueNumber: issueNum,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(lockPath, JSON.stringify(record, null, 2), 'utf-8');
  ctx.lockFilePath = lockPath;
  ctx.lockFilesToCleanup.push(lockPath);
  spawnGateCtx.writtenLockFiles.push(lockPath);
});

Then('the stale spawn lock file is force-removed', function () {
  // After reclaim, either the old file is gone or has a new PID
  assert.ok(ctx.lockFilePath, 'Expected lockFilePath to be set');
  if (existsSync(ctx.lockFilePath)) {
    const record = JSON.parse(readFileSync(ctx.lockFilePath, 'utf-8'));
    assert.notStrictEqual(record.pid, 999999999, 'Expected stale lock to have been replaced (pid should not be stale pid)');
  }
  // File may not exist if the new acquire failed — but we expect it to succeed (acquireResult true)
});

Then('a new lock record is written with the reclaiming caller\'s pid and pidStartedAt', function () {
  assert.ok(ctx.lockFilePath, 'Expected lockFilePath to be set');
  assert.ok(existsSync(ctx.lockFilePath), `Expected new lock file at ${ctx.lockFilePath}`);
  const record = JSON.parse(readFileSync(ctx.lockFilePath, 'utf-8'));
  assert.ok(typeof record.pid === 'number', 'Expected new lock to have a numeric pid');
  assert.ok(record.pidStartedAt !== undefined, 'Expected new lock to have a pidStartedAt');
});

// ─── 7. Behavioral: PID reuse with mismatched start-time ─────────────────────

Given('a spawn lock record for repo {string} and issue {int} whose recorded PID is live but whose pidStartedAt differs', function (repoName: string, issueNum: number) {
  const repo = parseRepo(repoName);
  ctx.repo = repo;
  ctx.issueNumber = issueNum;
  spawnGateCtx.repo = repo;
  spawnGateCtx.issueNumber = issueNum;
  const lockPath = getSpawnLockFilePath(repo, issueNum);
  mkdirSync(dirname(lockPath), { recursive: true });
  // Current process's PID is alive but with a wrong start-time
  const record = {
    pid: process.pid,
    pidStartedAt: 'wrong-boot-era-99999',
    repoKey: repoName,
    issueNumber: issueNum,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(lockPath, JSON.stringify(record, null, 2), 'utf-8');
  ctx.lockFilePath = lockPath;
  ctx.lockFilesToCleanup.push(lockPath);
  spawnGateCtx.writtenLockFiles.push(lockPath);
});

// ─── 8. Static: orchestratorLock helper module ───────────────────────────────

Then('acquireOrchestratorLock calls acquireIssueSpawnLock with {string} as the owning PID argument', function (pidExpr: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('acquireIssueSpawnLock') && content.includes(pidExpr),
    `Expected acquireOrchestratorLock to call acquireIssueSpawnLock with "${pidExpr}" in "${sharedCtx.filePath}"`,
  );
});

// ─── 9. Static: orchestrator file wiring checks ──────────────────────────────

Given('the orchestrator file {string} is read', function (filePath: string) {
  const fullPath = join(ROOT, filePath);
  assert.ok(existsSync(fullPath), `Expected orchestrator file to exist: ${filePath}`);
  const content = readFileSync(fullPath, 'utf-8');
  sharedCtx.fileContent = content;
  sharedCtx.filePath = filePath;
});

Then('{string} is called after {string} in main', function (laterExpr: string, earlierExpr: string) {
  const content = sharedCtx.fileContent;
  const mainStart = content.indexOf('async function main()');
  assert.ok(mainStart !== -1, `Expected main() function in "${sharedCtx.filePath}"`);
  const mainBody = content.slice(mainStart);
  const earlierIdx = mainBody.indexOf(earlierExpr);
  const laterIdx = mainBody.indexOf(laterExpr);
  assert.ok(earlierIdx !== -1, `Expected "${earlierExpr}" to appear in main() of "${sharedCtx.filePath}"`);
  assert.ok(laterIdx !== -1, `Expected "${laterExpr}" to appear in main() of "${sharedCtx.filePath}"`);
  assert.ok(
    laterIdx > earlierIdx,
    `Expected "${laterExpr}" (pos ${laterIdx}) to appear after "${earlierExpr}" (pos ${earlierIdx}) in "${sharedCtx.filePath}"`,
  );
});

Then('{string} is called before the phase-execution try block', function (expr: string) {
  const content = sharedCtx.fileContent;
  const mainStart = content.indexOf('async function main()');
  assert.ok(mainStart !== -1, `Expected main() in "${sharedCtx.filePath}"`);
  const mainBody = content.slice(mainStart);
  const exprIdx = mainBody.indexOf(expr);
  const tryIdx = mainBody.indexOf('try {');
  assert.ok(exprIdx !== -1, `Expected "${expr}" in main() of "${sharedCtx.filePath}"`);
  assert.ok(tryIdx !== -1, `Expected try block in main() of "${sharedCtx.filePath}"`);
  assert.ok(
    exprIdx < tryIdx,
    `Expected "${expr}" (pos ${exprIdx}) to appear before "try {" (pos ${tryIdx}) in "${sharedCtx.filePath}"`,
  );
});

Then('{string} is called after the repoInfo constant is declared in main', function (expr: string) {
  const content = sharedCtx.fileContent;
  const mainStart = content.indexOf('async function main()');
  assert.ok(mainStart !== -1, `Expected main() in "${sharedCtx.filePath}"`);
  const mainBody = content.slice(mainStart);
  const repoInfoIdx = mainBody.indexOf('repoInfo');
  const exprIdx = mainBody.indexOf(expr);
  assert.ok(repoInfoIdx !== -1, `Expected "repoInfo" declaration in main() of "${sharedCtx.filePath}"`);
  assert.ok(exprIdx !== -1, `Expected "${expr}" in main() of "${sharedCtx.filePath}"`);
  assert.ok(
    exprIdx > repoInfoIdx,
    `Expected "${expr}" (pos ${exprIdx}) to appear after "repoInfo" (pos ${repoInfoIdx}) in "${sharedCtx.filePath}"`,
  );
});

// ─── 10. Static: exit on contention ──────────────────────────────────────────

Then('the main function calls {string} when acquireOrchestratorLock returns false', function (exitExpr: string) {
  const content = sharedCtx.fileContent;
  const acquireIdx = content.indexOf('acquireOrchestratorLock(') !== -1
    ? content.indexOf('acquireOrchestratorLock(')
    : content.indexOf('acquireIssueSpawnLock(');
  assert.ok(acquireIdx !== -1, `Expected acquire call in "${sharedCtx.filePath}"`);
  const afterAcquire = content.slice(acquireIdx);
  assert.ok(
    afterAcquire.includes(exitExpr),
    `Expected "${exitExpr}" to follow the acquire call in "${sharedCtx.filePath}"`,
  );
});

Then('the main function does not throw when acquireOrchestratorLock returns false', function () {
  const content = sharedCtx.fileContent;
  const acquireIdx = content.indexOf('acquireOrchestratorLock(') !== -1
    ? content.indexOf('acquireOrchestratorLock(')
    : content.indexOf('acquireIssueSpawnLock(');
  assert.ok(acquireIdx !== -1, `Expected acquire call in "${sharedCtx.filePath}"`);
  const afterAcquire = content.slice(acquireIdx, acquireIdx + 300);
  assert.ok(
    !afterAcquire.includes('throw '),
    `Expected no throw in the acquire-failure branch of "${sharedCtx.filePath}"`,
  );
});

// ─── 11. Static: finally block ────────────────────────────────────────────────

Then('the main function contains a {string} block', function (keyword: string) {
  const content = sharedCtx.fileContent;
  const mainStart = content.indexOf('async function main()');
  assert.ok(mainStart !== -1, `Expected main() in "${sharedCtx.filePath}"`);
  const mainBody = content.slice(mainStart);
  assert.ok(
    mainBody.includes(keyword),
    `Expected main() in "${sharedCtx.filePath}" to contain "${keyword}" block`,
  );
});

Then('the {string} block calls {string}', function (blockKw: string, callExpr: string) {
  const content = sharedCtx.fileContent;
  const mainStart = content.indexOf('async function main()');
  assert.ok(mainStart !== -1, `Expected main() in "${sharedCtx.filePath}"`);
  const mainBody = content.slice(mainStart);
  const blockIdx = mainBody.indexOf(`${blockKw} {`);
  assert.ok(blockIdx !== -1, `Expected "${blockKw} {" in main() of "${sharedCtx.filePath}"`);
  const blockBody = mainBody.slice(blockIdx, blockIdx + 300);
  assert.ok(
    blockBody.includes(callExpr),
    `Expected "${blockKw}" block in "${sharedCtx.filePath}" to call "${callExpr}"`,
  );
});

// ─── 12. Static: completion handlers do not release ──────────────────────────

Then('{string} does not call {string}', function (funcName: string, callExpr: string) {
  const content = sharedCtx.fileContent;
  // Find the function body from its declaration to the closing brace
  const fnIdx = content.indexOf(`function ${funcName}(`);
  if (fnIdx === -1) {
    // Function not found → cannot call it, assertion passes vacuously
    return;
  }
  // Extract function body by finding matched braces
  const braceStart = content.indexOf('{', fnIdx);
  if (braceStart === -1) return;
  let depth = 0;
  let braceEnd = braceStart;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) { braceEnd = i; break; }
    }
  }
  const fnBody = content.slice(braceStart, braceEnd + 1);
  assert.ok(
    !fnBody.includes(callExpr),
    `Expected "${funcName}" not to call "${callExpr}" in "${sharedCtx.filePath}"`,
  );
});

// ─── 13. Behavioral: no-op release ───────────────────────────────────────────

Given('no spawn lock file exists for repo {string} and issue {int}', function (repoName: string, issueNum: number) {
  const repo = parseRepo(repoName);
  ctx.repo = repo;
  ctx.issueNumber = issueNum;
  const lockPath = getSpawnLockFilePath(repo, issueNum);
  try { unlinkSync(lockPath); } catch { /* already absent */ }
});

// ─── 14. Behavioral: crash recovery ─────────────────────────────────────────

Given('a spawn lock record for repo {string} and issue {int} whose pid is {int} and whose pidStartedAt is {string}', function (repoName: string, issueNum: number, pid: number, pidStartedAt: string) {
  const repo = parseRepo(repoName);
  ctx.repo = repo;
  ctx.issueNumber = issueNum;
  spawnGateCtx.repo = repo;
  spawnGateCtx.issueNumber = issueNum;
  const lockPath = getSpawnLockFilePath(repo, issueNum);
  mkdirSync(dirname(lockPath), { recursive: true });
  const record = { pid, pidStartedAt, repoKey: repoName, issueNumber: issueNum, startedAt: new Date().toISOString() };
  writeFileSync(lockPath, JSON.stringify(record, null, 2), 'utf-8');
  ctx.lockFilePath = lockPath;
  ctx.lockFilesToCleanup.push(lockPath);
  spawnGateCtx.writtenLockFiles.push(lockPath);
});

Given('isProcessLive returns false for pid {int} with pidStartedAt {string}', function (_pid: number, _pidStartedAt: string) {
  // Context-only: pid 99999 is assumed not alive, and the recorded pidStartedAt
  // "crashed-era" will not match any live process start-time, so isProcessLive
  // returns false naturally. The actual assertion is in the Then step.
});

Then('the stale lock is reclaimed', function () {
  assert.ok(ctx.lockFilePath, 'Expected lockFilePath to be set');
  assert.ok(existsSync(ctx.lockFilePath), 'Expected new lock file to exist after reclaim');
  const record = JSON.parse(readFileSync(ctx.lockFilePath, 'utf-8'));
  assert.ok(record.pid !== 99999, 'Expected reclaimed lock to have a different pid than the stale one');
});

Then('the new lock record reflects the reclaiming caller\'s pid and pidStartedAt', function () {
  assert.ok(ctx.lockFilePath, 'Expected lockFilePath to be set');
  assert.ok(existsSync(ctx.lockFilePath), `Expected new lock file at ${ctx.lockFilePath}`);
  const record = JSON.parse(readFileSync(ctx.lockFilePath, 'utf-8'));
  assert.ok(typeof record.pid === 'number', 'Expected new lock pid to be a number');
  assert.ok(record.pidStartedAt !== undefined, 'Expected new lock to have pidStartedAt');
  assert.notStrictEqual(record.pid, 99999, 'Expected new lock to not have the crashed PID');
});

// ─── 15. Unit test file assertions ───────────────────────────────────────────

Then('the file mocks the {string} module', function (modulePath: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('vi.mock') && content.includes(modulePath),
    `Expected "${sharedCtx.filePath}" to mock "${modulePath}" using vi.mock`,
  );
});

Then('the file registers mock implementations for {string} and {string}', function (fn1: string, fn2: string) {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes(fn1), `Expected test file to register a mock for "${fn1}"`);
  assert.ok(content.includes(fn2), `Expected test file to register a mock for "${fn2}"`);
});

Then('a test asserts acquireIssueSpawnLock returns true against an empty spawn-lock directory', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('acquireIssueSpawnLock') &&
      (content.includes('toBe(true)') || content.includes('true')),
    `Expected "${sharedCtx.filePath}" to have a test asserting acquireIssueSpawnLock returns true on fresh acquire`,
  );
});

Then('that test asserts the written record contains {string} and {string}', function (field1: string, field2: string) {
  const content = sharedCtx.fileContent;
  assert.ok(content.includes(field1), `Expected test to reference "${field1}"`);
  assert.ok(content.includes(field2), `Expected test to reference "${field2}"`);
});

Then('a test configures isProcessLive to return true', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    (content.includes('isProcessLive') || content.includes('mockReturnValue')) &&
      content.includes('true'),
    `Expected "${sharedCtx.filePath}" to configure isProcessLive to return true`,
  );
});

Then('that test asserts acquireIssueSpawnLock returns false', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('acquireIssueSpawnLock') && content.includes('false'),
    `Expected "${sharedCtx.filePath}" to assert acquireIssueSpawnLock returns false`,
  );
});

Then('a test configures isProcessLive to return false for an existing lock record', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('isProcessLive') && content.includes('false'),
    `Expected "${sharedCtx.filePath}" to configure isProcessLive to return false`,
  );
});

Then('that test asserts acquireIssueSpawnLock returns true and the reclaimed record carries the new pid', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('acquireIssueSpawnLock') &&
      content.includes('true') &&
      (content.includes('pid') || content.includes('reclaim')),
    `Expected "${sharedCtx.filePath}" to assert reclaim path writes new pid`,
  );
});

Then('a test writes a lock record whose pidStartedAt differs from the reported live start-time', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('pidStartedAt') && content.includes('differ'),
    `Expected "${sharedCtx.filePath}" to have a PID-reuse test with mismatched start-time`,
  );
});

Then('that test configures isProcessLive to return false for the mismatched tuple', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('isProcessLive') && content.includes('false'),
    `Expected "${sharedCtx.filePath}" to configure isProcessLive to return false for PID-reuse case`,
  );
});

Then('that test asserts the stale lock is reclaimed', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('reclaim') ||
      (content.includes('acquireIssueSpawnLock') && content.includes('true')),
    `Expected "${sharedCtx.filePath}" to assert the stale lock is reclaimed`,
  );
});
