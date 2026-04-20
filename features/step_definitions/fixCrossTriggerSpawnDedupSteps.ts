import { Given, When, Then, After } from '@cucumber/cucumber';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';
import { acquireIssueSpawnLock, releaseIssueSpawnLock, getSpawnLockFilePath } from '../../adws/triggers/spawnGate.ts';
import type { RepoInfo } from '../../adws/github/githubApi.ts';

const ROOT = process.cwd();

// ─── Per-scenario state ───────────────────────────────────────────────────────

interface SpawnGateCtx {
  repo: RepoInfo | null;
  issueNumber: number;
  acquireResult: boolean | null;
  releaseThrew: boolean;
  lockFilePath: string | null;
  writtenLockFiles: string[];
}

export const ctx: SpawnGateCtx = {
  repo: null,
  issueNumber: 0,
  acquireResult: null,
  releaseThrew: false,
  lockFilePath: null,
  writtenLockFiles: [],
};

function resetCtx(): void {
  ctx.repo = null;
  ctx.issueNumber = 0;
  ctx.acquireResult = null;
  ctx.releaseThrew = false;
  ctx.lockFilePath = null;
}

function parseRepo(repoFullName: string): RepoInfo {
  const [owner, repo] = repoFullName.split('/');
  return { owner, repo };
}

After(function () {
  for (const lockFile of ctx.writtenLockFiles) {
    try { unlinkSync(lockFile); } catch { /* ignore */ }
  }
  ctx.writtenLockFiles = [];
  resetCtx();
});

// ─── 1. Spawn gate module existence (static analysis) ────────────────────────
// Note: 'the file {string} exists' is defined in cucumberConfigSteps.ts
// Note: 'the file exports {string}' is defined in autoApproveMergeAfterReviewSteps.ts

// ─── 2. TOCTOU-safe wx flag (static analysis) ─────────────────────────────────

Then('the lock file path contains both the repo owner and the issue number', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('repoInfo.owner') || content.includes('owner'),
    'Expected lock file path derivation to include the repo owner',
  );
  assert.ok(
    content.includes('issueNumber'),
    'Expected lock file path derivation to include the issueNumber',
  );
});

// ─── 3. Filesystem behavioral: acquire / release ──────────────────────────────

Given('a lock file already exists for repo {string} and issue {int}', function (repoName: string, issueNum: number) {
  const repo = parseRepo(repoName);
  ctx.repo = repo;
  ctx.issueNumber = issueNum;
  const lockPath = getSpawnLockFilePath(repo, issueNum);
  mkdirSync(dirname(lockPath), { recursive: true });
  const record = { pid: process.pid, repoKey: repoName, issueNumber: issueNum, startedAt: new Date().toISOString() };
  writeFileSync(lockPath, JSON.stringify(record, null, 2), 'utf-8');
  ctx.writtenLockFiles.push(lockPath);
});

Given('no lock file exists for repo {string} and issue {int}', function (repoName: string, issueNum: number) {
  ctx.repo = parseRepo(repoName);
  ctx.issueNumber = issueNum;
  const lockPath = getSpawnLockFilePath(ctx.repo, issueNum);
  try { unlinkSync(lockPath); } catch { /* already absent */ }
});

When('acquireIssueSpawnLock is called with the same repo and issue', function () {
  assert.ok(ctx.repo, 'Expected repo to be set by a prior Given step');
  ctx.acquireResult = acquireIssueSpawnLock(ctx.repo, ctx.issueNumber, process.pid + 1000);
  const lockPath = getSpawnLockFilePath(ctx.repo, ctx.issueNumber);
  ctx.writtenLockFiles.push(lockPath);
});

Then('acquireIssueSpawnLock returns false', function () {
  assert.strictEqual(ctx.acquireResult, false, 'Expected acquireIssueSpawnLock to return false');
});

Then('acquireIssueSpawnLock returns true', function () {
  assert.strictEqual(ctx.acquireResult, true, 'Expected acquireIssueSpawnLock to return true');
});

Then('a lock file is created on disk', function () {
  assert.ok(ctx.repo, 'Expected repo to be set');
  const lockPath = getSpawnLockFilePath(ctx.repo, ctx.issueNumber);
  assert.ok(existsSync(lockPath), `Expected lock file to exist at ${lockPath}`);
});

Given('acquireIssueSpawnLock succeeded for repo {string} and issue {int}', function (repoName: string, issueNum: number) {
  const repo = parseRepo(repoName);
  const result = acquireIssueSpawnLock(repo, issueNum, process.pid);
  assert.strictEqual(result, true, `Expected first acquire to succeed for ${repoName}#${issueNum}`);
  ctx.writtenLockFiles.push(getSpawnLockFilePath(repo, issueNum));
});

When('acquireIssueSpawnLock is called for repo {string} and issue {int}', function (repoName: string, issueNum: number) {
  const repo = parseRepo(repoName);
  ctx.repo = repo;
  ctx.issueNumber = issueNum;
  ctx.acquireResult = acquireIssueSpawnLock(repo, issueNum, process.pid + 2000);
  ctx.writtenLockFiles.push(getSpawnLockFilePath(repo, issueNum));
});

// ─── 4. classifyAndSpawnWorkflow gate integration (static analysis) ────────────

Then('"acquireIssueSpawnLock" is called in classifyAndSpawnWorkflow before "classifyIssueForTrigger"', function () {
  const content = sharedCtx.fileContent;
  const acquireIdx = content.indexOf('acquireIssueSpawnLock(');
  const classifyIdx = content.indexOf('classifyIssueForTrigger(');
  assert.ok(acquireIdx !== -1, 'Expected classifyAndSpawnWorkflow to call acquireIssueSpawnLock');
  assert.ok(classifyIdx !== -1, 'Expected classifyAndSpawnWorkflow to call classifyIssueForTrigger');
  assert.ok(
    acquireIdx < classifyIdx,
    `Expected acquireIssueSpawnLock (pos ${acquireIdx}) to appear before classifyIssueForTrigger (pos ${classifyIdx}) in ${sharedCtx.filePath}`,
  );
});

Then('classifyAndSpawnWorkflow returns early when acquireIssueSpawnLock returns false', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('!acquired') || content.includes('acquired === false') || content.includes('acquired == false'),
    'Expected classifyAndSpawnWorkflow to check if lock was not acquired',
  );
  const acquireIdx = content.indexOf('acquireIssueSpawnLock(');
  assert.ok(acquireIdx !== -1, 'Expected acquireIssueSpawnLock call');
  const afterAcquire = content.slice(acquireIdx);
  assert.ok(
    afterAcquire.includes('return;') || afterAcquire.includes('return\n'),
    'Expected an early return when the lock is not acquired',
  );
});

Then('classifyAndSpawnWorkflow logs a message mentioning {string} when the lock acquire fails', function (keyword: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(keyword),
    `Expected classifyAndSpawnWorkflow to log a message containing "${keyword}" when lock acquire fails`,
  );
});

// ─── 5. Both trigger paths converge on classifyAndSpawnWorkflow (static) ───────

Then('the SDLC spawn branch in checkAndTrigger calls {string}', function (fnName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`${fnName}(`),
    `Expected checkAndTrigger in trigger_cron.ts to call ${fnName}`,
  );
});

Then('the SDLC spawn branch does not bypass classifyAndSpawnWorkflow with a direct spawnDetached', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    !content.includes('spawnDetached('),
    'Expected trigger_cron.ts to NOT call spawnDetached directly (must go through classifyAndSpawnWorkflow)',
  );
});

Then('the issue_comment handler calls {string} for actionable comments', function (fnName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`${fnName}(`),
    `Expected trigger_webhook.ts issue_comment handler to call ${fnName}`,
  );
});

Then('the issues opened handler calls {string} for eligible issues', function (fnName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`${fnName}(`),
    `Expected trigger_webhook.ts issues.opened handler to call ${fnName}`,
  );
});

Then('handleIssueClosedDependencyUnblock calls {string} for each unblocked dependent', function (fnName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(`${fnName}(`),
    `Expected webhookGatekeeper.ts handleIssueClosedDependencyUnblock to call ${fnName}`,
  );
});

// ─── 6. Post-classification recheck (static analysis) ─────────────────────────

Then('classifyAndSpawnWorkflow calls {string} after {string} returns', function (laterFn: string, earlierFn: string) {
  const content = sharedCtx.fileContent;
  const earlierIdx = content.indexOf(`${earlierFn}(`);
  const laterIdx = content.indexOf(`${laterFn}(`);
  assert.ok(earlierIdx !== -1, `Expected ${sharedCtx.filePath} to call ${earlierFn}`);
  assert.ok(laterIdx !== -1, `Expected ${sharedCtx.filePath} to call ${laterFn}`);
  assert.ok(
    earlierIdx < laterIdx,
    `Expected ${earlierFn} (pos ${earlierIdx}) to be called before ${laterFn} (pos ${laterIdx})`,
  );
});

// Scenario 15: classifyIssueForTrigger resolved after 5 minutes → structural check
Given('classifyIssueForTrigger resolved after 5 minutes', function () {
  const gatekeeperPath = join(ROOT, 'adws/triggers/webhookGatekeeper.ts');
  assert.ok(existsSync(gatekeeperPath), 'Expected webhookGatekeeper.ts to exist');
  const content = readFileSync(gatekeeperPath, 'utf-8');
  sharedCtx.fileContent = content;
  sharedCtx.filePath = 'adws/triggers/webhookGatekeeper.ts';
});

Given('during that window the cron spawned an orchestrator for the same issue', function () {
  // Structural invariant: the recheck after classifyIssueForTrigger covers this window
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('isAdwRunningForIssue'),
    'Expected classifyAndSpawnWorkflow to call isAdwRunningForIssue (post-classify recheck)',
  );
});

When('classifyAndSpawnWorkflow re-checks isAdwRunningForIssue', function () {
  // State from prior Given steps; the check happens inside classifyAndSpawnWorkflow
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('isAdwRunningForIssue'),
    'Expected isAdwRunningForIssue to be called in the post-classify recheck path',
  );
});

Then('classifyAndSpawnWorkflow releases the lock and returns without spawning', function () {
  const content = sharedCtx.fileContent;
  const isAdwIdx = content.indexOf('isAdwRunningForIssue');
  assert.ok(isAdwIdx !== -1, 'Expected isAdwRunningForIssue call');
  const afterRecheck = content.slice(isAdwIdx);
  assert.ok(
    afterRecheck.includes('releaseIssueSpawnLock('),
    'Expected releaseIssueSpawnLock to be called on the post-classify abort path',
  );
  assert.ok(
    afterRecheck.includes('return;') || afterRecheck.includes('return\n'),
    'Expected an early return after the post-classify recheck aborts',
  );
});

Then('classifyAndSpawnWorkflow calls {string} on the post-classification abort path', function (fnName: string) {
  const content = sharedCtx.fileContent;
  const isAdwIdx = content.indexOf('isAdwRunningForIssue');
  assert.ok(isAdwIdx !== -1, 'Expected isAdwRunningForIssue call to be present');
  const afterRecheck = content.slice(isAdwIdx);
  assert.ok(
    afterRecheck.includes(`${fnName}(`),
    `Expected ${fnName} to be called on the post-classification abort path (after isAdwRunningForIssue check)`,
  );
});

// ─── 7. Race scenario (structural verification) ────────────────────────────────

Given('issue {int} is blocked by issue {int} which was just merged by the cron', function (_dependent: number, _blocker: number) {
  // Context only — the structural invariants below cover this scenario
});

Given('the webhook receives the `issues.closed` event for issue {int} and starts handleIssueClosedDependencyUnblock', function (_issueNum: number) {
  const gatekeeperPath = join(ROOT, 'adws/triggers/webhookGatekeeper.ts');
  assert.ok(existsSync(gatekeeperPath), 'Expected webhookGatekeeper.ts to exist');
  const content = readFileSync(gatekeeperPath, 'utf-8');
  assert.ok(
    content.includes('handleIssueClosedDependencyUnblock'),
    'Expected handleIssueClosedDependencyUnblock to exist in webhookGatekeeper.ts',
  );
  sharedCtx.fileContent = content;
  sharedCtx.filePath = 'adws/triggers/webhookGatekeeper.ts';
});

Given("the cron's next poll sees issue {int} as eligible during the webhook's classification window", function (_issueNum: number) {
  const cronPath = join(ROOT, 'adws/triggers/trigger_cron.ts');
  assert.ok(existsSync(cronPath), 'Expected trigger_cron.ts to exist');
  const content = readFileSync(cronPath, 'utf-8');
  assert.ok(
    content.includes('classifyAndSpawnWorkflow'),
    'Expected cron to route through classifyAndSpawnWorkflow',
  );
});

When('both triggers reach classifyAndSpawnWorkflow for issue {int}', function (_issueNum: number) {
  // Structural: both paths verified above; gate in classifyAndSpawnWorkflow enforces dedup
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('acquireIssueSpawnLock('),
    'Expected classifyAndSpawnWorkflow to call acquireIssueSpawnLock before any spawn',
  );
});

Then('exactly one orchestrator process is spawned for issue {int}', function (_issueNum: number) {
  const content = sharedCtx.fileContent;
  // Look within the classifyAndSpawnWorkflow function body (skip the spawnDetached function definition)
  const fnIdx = content.indexOf('export async function classifyAndSpawnWorkflow');
  assert.ok(fnIdx !== -1, 'Expected classifyAndSpawnWorkflow to be defined in webhookGatekeeper.ts');
  const fnBody = content.slice(fnIdx);
  const acquireIdx = fnBody.indexOf('acquireIssueSpawnLock(');
  const spawnIdx = fnBody.indexOf('spawnDetached(');
  assert.ok(acquireIdx !== -1, 'Expected acquireIssueSpawnLock call in classifyAndSpawnWorkflow body');
  assert.ok(spawnIdx !== -1, 'Expected spawnDetached call in classifyAndSpawnWorkflow body');
  assert.ok(
    acquireIdx < spawnIdx,
    'Expected acquireIssueSpawnLock to gate spawnDetached (spawn appears after lock acquisition)',
  );
});

Then('the losing trigger logs a spawn-lock deferral', function () {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes('spawn lock'),
    'Expected the losing trigger to log a "spawn lock" message on deferral',
  );
});

// ─── 8. Lock lifecycle (static + filesystem) ──────────────────────────────────

Then('the lock directory is resolved from {string}', function (constantName: string) {
  const content = sharedCtx.fileContent;
  assert.ok(
    content.includes(constantName),
    `Expected lock directory to reference ${constantName} in ${sharedCtx.filePath}`,
  );
});

Given('acquireIssueSpawnLock returned true for repo {string} and issue {int}', function (repoName: string, issueNum: number) {
  const repo = parseRepo(repoName);
  ctx.repo = repo;
  ctx.issueNumber = issueNum;
  const result = acquireIssueSpawnLock(repo, issueNum, process.pid);
  assert.strictEqual(result, true, `Expected acquire to succeed for ${repoName}#${issueNum}`);
  ctx.writtenLockFiles.push(getSpawnLockFilePath(repo, issueNum));
});

When('releaseIssueSpawnLock is called for the same repo and issue', function () {
  assert.ok(ctx.repo, 'Expected repo context from prior Given step');
  ctx.releaseThrew = false;
  try {
    releaseIssueSpawnLock(ctx.repo, ctx.issueNumber);
  } catch {
    ctx.releaseThrew = true;
  }
});

Then('the lock file for repo {string} and issue {int} no longer exists', function (repoName: string, issueNum: number) {
  const repo = parseRepo(repoName);
  const lockPath = getSpawnLockFilePath(repo, issueNum);
  assert.ok(!existsSync(lockPath), `Expected lock file to be gone at ${lockPath}`);
});

When('releaseIssueSpawnLock is called for repo {string} and issue {int}', function (repoName: string, issueNum: number) {
  ctx.repo = parseRepo(repoName);
  ctx.issueNumber = issueNum;
  ctx.releaseThrew = false;
  try {
    releaseIssueSpawnLock(ctx.repo, issueNum);
  } catch {
    ctx.releaseThrew = true;
  }
});

Then('releaseIssueSpawnLock does not throw', function () {
  assert.strictEqual(ctx.releaseThrew, false, 'Expected releaseIssueSpawnLock to not throw');
});

Given('a lock file exists for repo {string} and issue {int} whose PID is not alive', function (repoName: string, issueNum: number) {
  const repo = parseRepo(repoName);
  ctx.repo = repo;
  ctx.issueNumber = issueNum;
  const lockPath = getSpawnLockFilePath(repo, issueNum);
  mkdirSync(dirname(lockPath), { recursive: true });
  const record = { pid: 999999999, repoKey: repoName, issueNumber: issueNum, startedAt: new Date().toISOString() };
  writeFileSync(lockPath, JSON.stringify(record, null, 2), 'utf-8');
  ctx.writtenLockFiles.push(lockPath);
});

When('acquireIssueSpawnLock is called for the same repo and issue', function () {
  assert.ok(ctx.repo, 'Expected repo context from prior Given step');
  ctx.acquireResult = acquireIssueSpawnLock(ctx.repo, ctx.issueNumber, process.pid);
  ctx.writtenLockFiles.push(getSpawnLockFilePath(ctx.repo, ctx.issueNumber));
});

Then('the stale lock is removed and acquireIssueSpawnLock returns true', function () {
  assert.strictEqual(ctx.acquireResult, true, 'Expected acquireIssueSpawnLock to return true (stale reclaim)');
  assert.ok(ctx.repo, 'Expected repo context');
  const lockPath = getSpawnLockFilePath(ctx.repo, ctx.issueNumber);
  assert.ok(existsSync(lockPath), 'Expected a new lock file to be written by the reclaiming caller');
  const record = JSON.parse(readFileSync(lockPath, 'utf-8'));
  assert.notStrictEqual(record.pid, 999999999, 'Expected new lock file to have a different PID (not the stale one)');
});

// ─── 9. known_issues.md ────────────────────────────────────────────────────────

Then('the entry references issue #{int}', function (this: Record<string, string>, issueNum: number) {
  const content = this['fileContent'] || sharedCtx.fileContent;
  assert.ok(
    content.includes(`#${issueNum}`) || content.includes(String(issueNum)),
    `Expected known_issues.md to reference issue #${issueNum}`,
  );
});

// ─── 10. Structural: spawnDetached not called when lock held ──────────────────

Given('acquireIssueSpawnLock returns false for repo {string} and issue {int}', function (_repoName: string, _issueNum: number) {
  // Context only — verified via static analysis below
  const gatekeeperPath = join(ROOT, 'adws/triggers/webhookGatekeeper.ts');
  sharedCtx.fileContent = readFileSync(gatekeeperPath, 'utf-8');
  sharedCtx.filePath = 'adws/triggers/webhookGatekeeper.ts';
});

When('classifyAndSpawnWorkflow is called for repo {string} and issue {int}', function (_repoName: string, _issueNum: number) {
  // Context from Given step above — static analysis
});

Then('spawnDetached is not called', function () {
  const content = sharedCtx.fileContent;
  // Inspect classifyAndSpawnWorkflow's body (skip the spawnDetached function definition at the top)
  const fnIdx = content.indexOf('export async function classifyAndSpawnWorkflow');
  assert.ok(fnIdx !== -1, 'Expected classifyAndSpawnWorkflow to exist');
  const fnBody = content.slice(fnIdx);

  const acquireIdx = fnBody.indexOf('acquireIssueSpawnLock(');
  assert.ok(acquireIdx !== -1, 'Expected acquireIssueSpawnLock call in classifyAndSpawnWorkflow');

  // Verify early return when lock not acquired (before any spawnDetached call)
  const earlyReturnIdx = fnBody.indexOf('return;');
  assert.ok(earlyReturnIdx !== -1, 'Expected early return path in classifyAndSpawnWorkflow');
  assert.ok(
    earlyReturnIdx > acquireIdx,
    'Expected early return to appear after acquireIssueSpawnLock check',
  );

  // spawnDetached must appear after acquireIssueSpawnLock in the function body
  const spawnIdx = fnBody.indexOf('spawnDetached(');
  assert.ok(spawnIdx !== -1, 'Expected spawnDetached call in classifyAndSpawnWorkflow body');
  assert.ok(
    spawnIdx > acquireIdx,
    'Expected spawnDetached to appear after acquireIssueSpawnLock (locked scope)',
  );
});
