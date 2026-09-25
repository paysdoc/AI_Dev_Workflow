/**
 * §3 drives the real `scanPauseQueue`/`resumeWorkflow` over the real
 * `agents/paused_queue.json`, with the Claude CLI replaced by the same
 * injectable-exec stub §1/§2 use (see feature-902.steps.ts's `probeStub`).
 *
 * The scanner's comment posts reach `gh issue comment` (GraphQL, not the REST
 * mock's HTTP surface — confirmed by tracing @paysdoc/devplatform's
 * GitHubIssueTracker → ghRepoApi → GitContext.exec), so redirecting them via
 * GH_HOST/GITHUB_API_URL alone does not work: `gh` ignores GH_TOKEN off
 * github.com, and the mock server never receives a GraphQL request. Instead
 * this file shadows `gh` on PATH — exactly the precedent test-harness.ts
 * already sets for `git` — with a stub that answers `gh auth token` and
 * records `gh issue comment` invocations to a file. After each scan (once the
 * blocking execSync calls inside it have returned — replaying while `gh`
 * might still be blocked on one would deadlock the single-process mock
 * server), the recorded invocations are replayed as real HTTP POSTs against
 * the mock so the already-registered T2/T3/T14 assertions observe them.
 */

import { Given, When, Then, Before, After, BeforeAll, AfterAll, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { setupMockInfrastructure, teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';
import { PROBE_INTERVAL_CYCLES } from '../../../adws/core/index.ts';
import { readPauseQueue, appendToPauseQueue, updatePauseQueueEntry, PAUSE_QUEUE_PATH, type PausedWorkflow } from '../../../adws/core/pauseQueue.ts';
import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { scanPauseQueue } from '../../../adws/triggers/pauseQueueScanner.ts';
import { probeRateLimit } from '../../../adws/triggers/rateLimitProbe.ts';
import type { ScanningCronIdentity } from '../../../adws/triggers/pauseQueueDecider.ts';
import type { SpawnOrchestrator } from '../../../adws/triggers/pauseQueueResume.ts';
import { probeStub } from './feature-902.steps.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * "The cron polling the target repository R" (`scanningCronFor(R)`) or "the self-host cron
 * on a host checked out at R" (`scanningCronFor(R, { selfHost: true })`) — the launch
 * identity a scenario hands the scanner/decider. Never derive this from the queue's own
 * entries: a cron derived from the entries it is about to scan would own them by
 * construction, so ownership would pass vacuously.
 */
export function scanningCronFor(repoFullName: string, opts: { selfHost?: boolean } = {}): ScanningCronIdentity {
  const [owner, repo] = repoFullName.split('/');
  return { repoId: { owner, repo }, selfHost: opts.selfHost ?? false };
}

export interface SeededEntry {
  entry: PausedWorkflow;
  worktreePath: string;
  scriptPath: string;
  invocationLogPath: string;
  baselineProbeFailures: number;
}

/**
 * Lets feature-910.steps.ts register an entry written by the REAL pause path (not this
 * file's fixture-orchestrator Given) into the same seeded map, so the shared queue/relaunch
 * Then-steps below find it by issue number and the existing After hook's cleanup loop
 * (pkill by scriptPath, rmSync worktreePath/agents/<adwId>) reaches it too.
 */
export function registerSeededEntry(issueNumber: number, seeded: SeededEntry): void {
  world.seeded.set(issueNumber, seeded);
}

export function getSeededEntry(issueNumber: number): SeededEntry | undefined {
  return world.seeded.get(issueNumber);
}

/**
 * feature-910's "the cron host's clock reads {string}" pins the instant `scanPauseQueue`
 * hands the decider. Cleared by feature-910.steps.ts's own After hook.
 */
let pinnedClock: Date | null = null;
export function setPinnedClock(date: Date | null): void {
  pinnedClock = date;
}

/**
 * feature-910's end-to-end journey drives the REAL pause path, so its queue entry names a
 * real orchestrator script. Shadowing `bunx` on PATH (mirroring this file's `gh` shadow)
 * intercepts the relaunch before `tsx` ever runs the real script, recording argv in the
 * same [issueNumber, adwId, ...extraArgs] shape the fixture orchestrator records so the
 * shared "relaunched under its original adwId" Then-step needs no changes.
 */
let bunxMockDir: string | null = null;
let interceptRelaunchViaBunx = false;
let bunxInvocationLogPath: string | null = null;

export function enableBunxRelaunchIntercept(logPath: string): void {
  interceptRelaunchViaBunx = true;
  bunxInvocationLogPath = logPath;
}

export function disableBunxRelaunchIntercept(): void {
  interceptRelaunchViaBunx = false;
  bunxInvocationLogPath = null;
}

function createBunxMockDir(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'adw-910-bunx-mock-'));
  const stubPath = path.join(dir, 'bunx-stub.ts');
  const stubSource = [
    "import { appendFileSync } from 'fs';",
    '',
    '// argv: [\'tsx\', resolvedScript, issueNumber, adwId, ...extraArgs] — drop the first two',
    "// so the record matches the fixture orchestrator's own [issueNumber, adwId, ...] shape.",
    'const argv = process.argv.slice(4);',
    "const logPath = process.env['ADW_910_BUNX_LOG'];",
    'if (logPath) {',
    "  appendFileSync(logPath, JSON.stringify({ argv }) + '\\n');",
    '}',
    "// Stays alive past the resume path's readiness window; killed in After by adwId.",
    'setInterval(() => {}, 60_000);',
  ].join('\n') + '\n';
  fs.writeFileSync(stubPath, stubSource, 'utf-8');

  const wrapperPath = path.join(dir, 'bunx');
  const wrapperSource = ['#!/bin/sh', `exec bun "${stubPath}" "$@"`].join('\n') + '\n';
  fs.writeFileSync(wrapperPath, wrapperSource, { mode: 0o755 });

  return dir;
}

const world: {
  seeded: Map<number, SeededEntry>;
  savedQueueRaw: string | null;
  savedAppEnv: { id: string | undefined; slug: string | undefined; key: string | undefined };
  ghLogDir: string;
  ghLogPath: string;
} = {
  seeded: new Map(),
  savedQueueRaw: null,
  savedAppEnv: { id: undefined, slug: undefined, key: undefined },
  ghLogDir: '',
  ghLogPath: '',
};

let ghMockDir: string | null = null;

/**
 * A `gh` shadow, mirroring test-harness.ts's `git` wrapper: a `/bin/sh`
 * script named exactly `gh` that execs into a bun-run TypeScript stub, placed
 * on PATH ahead of the real binary. Handles the only two subcommands the
 * scanner's comment path can reach (`auth token`, `issue comment ... --body-file -`);
 * anything else exits 0 harmlessly rather than reaching a real network call.
 */
function createGhMockDir(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'adw-902-gh-mock-'));
  const stubPath = path.join(dir, 'gh-stub.ts');
  const stubSource = [
    "import { readFileSync, appendFileSync } from 'fs';",
    '',
    'const args = process.argv.slice(2);',
    "const logPath = process.env['ADW_902_GH_LOG'];",
    '',
    "if (args[0] === 'auth' && args[1] === 'token') {",
    "  process.stdout.write('adw-902-fake-token\\n');",
    '  process.exit(0);',
    '}',
    '',
    "if (args[0] === 'issue' && args[1] === 'comment') {",
    '  const issueNumber = args[2];',
    "  const repoIdx = args.indexOf('--repo');",
    "  const repo = repoIdx !== -1 ? args[repoIdx + 1] : '';",
    "  const bodyFileIdx = args.indexOf('--body-file');",
    `  const body = bodyFileIdx !== -1 && args[bodyFileIdx + 1] === '-' ? readFileSync(0, 'utf-8') : '';`,
    '  if (logPath) {',
    "    appendFileSync(logPath, JSON.stringify({ issueNumber, repo, body }) + '\\n');",
    '  }',
    "  process.stdout.write('https://example.invalid/' + repo + '/issues/' + issueNumber + '#issuecomment-1\\n');",
    '  process.exit(0);',
    '}',
    '',
    'process.exit(0);',
  ].join('\n') + '\n';
  fs.writeFileSync(stubPath, stubSource, 'utf-8');

  const wrapperPath = path.join(dir, 'gh');
  const wrapperSource = ['#!/bin/sh', `exec bun "${stubPath}" "$@"`].join('\n') + '\n';
  fs.writeFileSync(wrapperPath, wrapperSource, { mode: 0o755 });

  return dir;
}

BeforeAll(function () {
  ghMockDir = createGhMockDir();
  bunxMockDir = createBunxMockDir();
});

AfterAll(function () {
  if (ghMockDir) {
    try { fs.rmSync(ghMockDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  ghMockDir = null;
  if (bunxMockDir) {
    try { fs.rmSync(bunxMockDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  bunxMockDir = null;
});

Before({ tags: '(@adw-902 or @adw-907 or @adw-910 or @adw-911) and not @adw-908 and not @adw-812' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();

  process.env['PATH'] = `${ghMockDir}:${process.env['PATH'] ?? ''}`;
  world.savedAppEnv = {
    id: process.env['GITHUB_APP_ID'],
    slug: process.env['GITHUB_APP_SLUG'],
    key: process.env['GITHUB_APP_PRIVATE_KEY_PATH'],
  };
  process.env['GITHUB_APP_ID'] = '';
  process.env['GITHUB_APP_SLUG'] = '';
  process.env['GITHUB_APP_PRIVATE_KEY_PATH'] = '';

  world.ghLogDir = fs.mkdtempSync(path.join(tmpdir(), 'adw-902-gh-log-'));
  world.ghLogPath = path.join(world.ghLogDir, 'invocations.log');
  process.env['ADW_902_GH_LOG'] = world.ghLogPath;

  world.seeded.clear();
  world.savedQueueRaw = fs.existsSync(PAUSE_QUEUE_PATH) ? fs.readFileSync(PAUSE_QUEUE_PATH, 'utf-8') : null;
  fs.rmSync(PAUSE_QUEUE_PATH, { force: true });
});

After({ tags: '(@adw-902 or @adw-907 or @adw-910 or @adw-911) and not @adw-908 and not @adw-812' }, async function (this: RegressionWorld) {
  for (const seeded of world.seeded.values()) {
    try { execSync(`pkill -f ${JSON.stringify(seeded.scriptPath)}`, { stdio: 'ignore' }); } catch { /* nothing to kill */ }
    try { fs.rmSync(seeded.worktreePath, { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(path.join(process.cwd(), 'agents', seeded.entry.adwId), { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(path.join(process.cwd(), 'agents', 'paused_queue_logs', `${seeded.entry.adwId}.resume.log`), { force: true }); } catch { /* best effort */ }
  }
  world.seeded.clear();

  if (world.savedQueueRaw !== null) {
    fs.writeFileSync(PAUSE_QUEUE_PATH, world.savedQueueRaw);
  } else {
    fs.rmSync(PAUSE_QUEUE_PATH, { force: true });
  }

  process.env['GITHUB_APP_ID'] = world.savedAppEnv.id;
  process.env['GITHUB_APP_SLUG'] = world.savedAppEnv.slug;
  process.env['GITHUB_APP_PRIVATE_KEY_PATH'] = world.savedAppEnv.key;
  delete process.env['ADW_902_GH_LOG'];
  if (world.ghLogDir) {
    try { fs.rmSync(world.ghLogDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  await teardownMockInfrastructure();
  this.mockContext = null;
});

function writeFixtureOrchestratorScript(worktreePath: string, invocationLogPath: string): string {
  const scriptPath = path.join(worktreePath, 'fixture-orchestrator.ts');
  const source = [
    "import { appendFileSync } from 'fs';",
    `appendFileSync(${JSON.stringify(invocationLogPath)}, JSON.stringify({ argv: process.argv.slice(2), pid: process.pid }) + ${JSON.stringify('\n')});`,
    '// Stays alive past the resume path readiness window; the After hook kills it by script path.',
    'setInterval(() => {}, 60_000);',
  ].join('\n') + '\n';
  fs.writeFileSync(scriptPath, source, 'utf-8');
  return scriptPath;
}

/** `targetRepo === null` seeds exactly what an orchestrator launched without `--target-repo` pauses: no `extraArgs` key at all. */
export function seedPausedWorkflow(issueNumber: number, targetRepo: string | null): SeededEntry {
  const adwId = `bdd902-${issueNumber}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
  const worktreePath = fs.mkdtempSync(path.join(tmpdir(), `adw-902-worktree-${issueNumber}-`));
  const invocationLogPath = path.join(worktreePath, 'invocations.log');
  const scriptPath = writeFixtureOrchestratorScript(worktreePath, invocationLogPath);

  AgentStateManager.writeTopLevelState(adwId, { adwId, workflowStage: 'paused' });

  const entry: PausedWorkflow = {
    adwId,
    issueNumber,
    orchestratorScript: scriptPath,
    pausedAtPhase: 'sdlc_planner',
    pauseReason: 'rate_limited',
    pausedAt: new Date().toISOString(),
    worktreePath,
    branchName: `bdd-902-issue-${issueNumber}`,
    ...(targetRepo ? { extraArgs: ['--target-repo', targetRepo] } : {}),
    probeFailures: 0,
  };
  appendToPauseQueue(entry);

  const seeded: SeededEntry = { entry, worktreePath, scriptPath, invocationLogPath, baselineProbeFailures: 0 };
  world.seeded.set(issueNumber, seeded);
  return seeded;
}

function countFixtureLaunches(seeded: SeededEntry): number {
  if (!fs.existsSync(seeded.invocationLogPath)) return 0;
  return fs.readFileSync(seeded.invocationLogPath, 'utf-8').trim().split('\n').filter(Boolean).length;
}

function requireSeeded(issueNumber: number): SeededEntry {
  const seeded = world.seeded.get(issueNumber);
  assert.ok(seeded, `No workflow was seeded for issue ${issueNumber}`);
  return seeded;
}

function currentEntry(issueNumber: number): PausedWorkflow | undefined {
  const seeded = requireSeeded(issueNumber);
  return readPauseQueue().find(e => e.adwId === seeded.entry.adwId);
}

Given(
  'a workflow for issue {int} is paused in the rate-limit queue for the target repository {string}',
  function (issueNumber: number, targetRepo: string) {
    seedPausedWorkflow(issueNumber, targetRepo);
  },
);

Given(
  'the paused workflow for issue {int} has already recorded {int} unknown probe failures',
  function (issueNumber: number, failures: number) {
    const seeded = requireSeeded(issueNumber);
    updatePauseQueueEntry(seeded.entry.adwId, { probeFailures: failures });
    seeded.baselineProbeFailures = failures;
  },
);

export async function replayGhCommentLog(): Promise<void> {
  if (!fs.existsSync(world.ghLogPath)) return;
  const content = fs.readFileSync(world.ghLogPath, 'utf-8');
  fs.writeFileSync(world.ghLogPath, '');
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const serverUrl = process.env['MOCK_GITHUB_API_URL'];
  if (!serverUrl) return;
  for (const line of lines) {
    const parsed = JSON.parse(line) as { issueNumber: string; repo: string; body: string };
    await fetch(`${serverUrl}/repos/${parsed.repo}/issues/${parsed.issueNumber}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: parsed.body }),
    });
  }
}

/** Shadows `bunx` on PATH for the duration of `fn`, mirroring the `gh` shadow above. */
async function withBunxShadow(fn: () => Promise<void>): Promise<void> {
  if (!interceptRelaunchViaBunx || !bunxMockDir) {
    await fn();
    return;
  }
  const savedPath = process.env['PATH'];
  process.env['PATH'] = `${bunxMockDir}:${savedPath ?? ''}`;
  process.env['ADW_910_BUNX_LOG'] = bunxInvocationLogPath ?? '';
  try {
    await fn();
  } finally {
    process.env['PATH'] = savedPath;
  }
}

export async function runOneProbeCycle(cycleIndex: number, scanningCron: ScanningCronIdentity, spawn?: SpawnOrchestrator): Promise<void> {
  const clockAtCall = pinnedClock;
  const deps = { scanningCron, ...(clockAtCall ? { now: () => clockAtCall } : {}), ...(spawn ? { spawn } : {}) };
  await withBunxShadow(() => scanPauseQueue(PROBE_INTERVAL_CYCLES * cycleIndex, () => probeRateLimit(probeStub.exec), deps));
  await replayGhCommentLog();
}

/** N successive cycle counts, each a multiple of PROBE_INTERVAL_CYCLES, so every scan probes. */
export async function runProbeCycles(count: number, scanningCron: ScanningCronIdentity, spawn?: SpawnOrchestrator): Promise<void> {
  for (let i = 1; i <= count; i++) {
    await runOneProbeCycle(i, scanningCron, spawn);
  }
}

let probeCallCountBeforeLastRun = 0;
let probeCallCountAfterLastRun = 0;
let probeCyclesRequestedLastRun = 0;

/** feature-910's "the scanner did not run/ran once per probe cycle" Then-steps read this. */
export function getScannerRunSummary(): { probeCallsBefore: number; probeCallsAfter: number; cyclesRequested: number } {
  return {
    probeCallsBefore: probeCallCountBeforeLastRun,
    probeCallsAfter: probeCallCountAfterLastRun,
    cyclesRequested: probeCyclesRequestedLastRun,
  };
}

/**
 * Runs N probe cycles as `scanningCron` and updates the probe-call counters
 * `getScannerRunSummary` reads — the single entry point every scanner-running step (the
 * plain one below and feature-911's cron-qualified ones) must go through, so "did not run
 * the rate-limit probe" / "ran it once per probe cycle" observe the run regardless of which
 * step triggered it.
 */
export async function runTrackedProbeCycles(count: number, scanningCron: ScanningCronIdentity, spawn?: SpawnOrchestrator): Promise<void> {
  probeCallCountBeforeLastRun = probeStub.calls.length;
  probeCyclesRequestedLastRun = count;
  await runProbeCycles(count, scanningCron, spawn);
  probeCallCountAfterLastRun = probeStub.calls.length;
}

When(/^the pause-queue scanner runs (\d+) probe cycles?$/, async function (countStr: string) {
  // This shared step owns every entry the 902/907/910 rows seed — always run it as the
  // acme/widgets cron, never an identity derived from the queue's own entries.
  await runTrackedProbeCycles(Number(countStr), scanningCronFor('acme/widgets'));
});

Then('the pause queue still holds the workflow for issue {int}', function (issueNumber: number) {
  const current = currentEntry(issueNumber);
  assert.ok(current, `Expected issue ${issueNumber} to still be queued`);
});

Then('the pause queue no longer holds the workflow for issue {int}', function (issueNumber: number) {
  const current = currentEntry(issueNumber);
  assert.strictEqual(current, undefined, `Expected issue ${issueNumber} to no longer be queued`);
});

Then('the pause queue entry for issue {int} has not gained a probe failure', function (issueNumber: number) {
  const seeded = requireSeeded(issueNumber);
  const current = currentEntry(issueNumber);
  assert.ok(current, `Expected issue ${issueNumber} to still be queued`);
  assert.strictEqual(current!.probeFailures ?? 0, seeded.baselineProbeFailures);
});

Then('the pause queue entry for issue {int} records {int} probe failure(s)', function (issueNumber: number, expected: number) {
  const current = currentEntry(issueNumber);
  assert.ok(current, `Expected issue ${issueNumber} to still be queued`);
  assert.strictEqual(current!.probeFailures ?? 0, expected);
});

Then('the pause queue entry for issue {int} still records the target repository {string}', function (issueNumber: number, targetRepo: string) {
  const current = currentEntry(issueNumber);
  assert.ok(current, `Expected issue ${issueNumber} to still be queued`);
  const extraArgs = current.extraArgs ?? [];
  const idx = extraArgs.indexOf('--target-repo');
  assert.ok(
    idx !== -1 && extraArgs[idx + 1] === targetRepo,
    `Expected --target-repo ${targetRepo} among issue ${issueNumber}'s extraArgs, got: ${JSON.stringify(extraArgs)}`,
  );
});

Given('the paused workflow for issue {int} was last probed at {string}', function (issueNumber: number, isoTimestamp: string) {
  const seeded = requireSeeded(issueNumber);
  updatePauseQueueEntry(seeded.entry.adwId, { lastProbeAt: isoTimestamp });
});

Then('the pause queue entry for issue {int} still records its last probe at {string}', function (issueNumber: number, isoTimestamp: string) {
  const current = currentEntry(issueNumber);
  assert.ok(current, `Expected issue ${issueNumber} to still be queued`);
  assert.ok(current.lastProbeAt, `Expected issue ${issueNumber}'s entry to carry a lastProbeAt`);
  assert.strictEqual(new Date(current.lastProbeAt).getTime(), new Date(isoTimestamp).getTime());
});

Then(
  'the pause queue still holds a workflow for each of these issues, none of which has gained a probe failure:',
  function (dataTable: DataTable) {
    for (const row of dataTable.hashes()) {
      const issueNumber = Number(row['issue']);
      const seeded = requireSeeded(issueNumber);
      const current = currentEntry(issueNumber);
      assert.ok(current, `Expected issue ${issueNumber} to still be queued`);
      assert.strictEqual(current!.probeFailures ?? 0, seeded.baselineProbeFailures, `Issue ${issueNumber} gained a probe failure`);
    }
  },
);

async function waitFor(predicate: () => boolean, timeoutMs: number, description: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!predicate()) throw new Error(`Timed out waiting for: ${description}`);
}

Then('the paused workflow for issue {int} is relaunched under its original adwId', async function (issueNumber: number) {
  const seeded = requireSeeded(issueNumber);
  await waitFor(() => fs.existsSync(seeded.invocationLogPath), 10_000, `fixture orchestrator invocation log at ${seeded.invocationLogPath}`);
  const lines = fs.readFileSync(seeded.invocationLogPath, 'utf-8').trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 0, `Expected the fixture orchestrator to record an invocation for issue ${issueNumber}`);
  const first = JSON.parse(lines[0]) as { argv: string[] };
  assert.strictEqual(first.argv[0], String(issueNumber));
  assert.strictEqual(first.argv[1], seeded.entry.adwId);
});

Then('the paused workflow for issue {int} is relaunched with the target repository {string}', async function (issueNumber: number, targetRepo: string) {
  const seeded = requireSeeded(issueNumber);
  await waitFor(() => fs.existsSync(seeded.invocationLogPath), 10_000, `fixture orchestrator invocation log at ${seeded.invocationLogPath}`);
  const lines = fs.readFileSync(seeded.invocationLogPath, 'utf-8').trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 0, `Expected the fixture orchestrator to record an invocation for issue ${issueNumber}`);
  const first = JSON.parse(lines[0]) as { argv: string[] };
  const idx = first.argv.indexOf('--target-repo');
  assert.ok(
    idx !== -1 && first.argv[idx + 1] === targetRepo,
    `Expected --target-repo ${targetRepo} among the relaunch args for issue ${issueNumber}, got argv=${first.argv.join(' ')}`,
  );
});

Then('the paused workflow for issue {int} has been relaunched {int} time(s)', async function (issueNumber: number, times: number) {
  const seeded = requireSeeded(issueNumber);
  await waitFor(() => countFixtureLaunches(seeded) === times, 10_000, `issue ${issueNumber} to have been relaunched ${times} time(s)`);
  assert.strictEqual(countFixtureLaunches(seeded), times);
});

Then('the paused workflow for issue {int} has not been relaunched', async function (issueNumber: number) {
  const seeded = requireSeeded(issueNumber);
  // A real spawn records asynchronously — wait a moment before concluding it never happened.
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.strictEqual(countFixtureLaunches(seeded), 0, `Expected issue ${issueNumber} not to have been relaunched`);
});
