/**
 * Novel step definitions for feature-911.feature. Reuses the shared harness (probeStub,
 * the mock GitHub / gh-shadow infrastructure, the saved-and-restored queue file, the seeded-
 * entry map, the pinned clock, the decider world) — see feature-902.steps.ts and
 * feature-902-queue.steps.ts for the Before/After hooks this file's scenarios run under
 * (widened to `(@adw-902 or @adw-907 or @adw-910 or @adw-911) and not @adw-908 and not
 * @adw-812`), and feature-910.steps.ts for the decider world (widened to `@adw-910 or
 * @adw-911`). This file owns only what neither of those already provides: the scanning-cron
 * descriptor parser, the cron-qualified scanner/decider steps, the remove-before-spawn seam,
 * the crash-on-first-launch fixture, the held spawn lock, and the real cron process (§4).
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { spawn as realSpawn, type ChildProcess } from 'child_process';
import { Platform, type RepoIdentifier } from '@paysdoc/devplatform';

import {
  seedPausedWorkflow,
  getSeededEntry,
  scanningCronFor,
  runOneProbeCycle,
  runTrackedProbeCycles,
  replayGhCommentLog,
} from './feature-902-queue.steps.ts';
import {
  setDeciderEntryForScanningCronTest,
  consultDeciderWithScanningCron,
} from './feature-910.steps.ts';
import {
  createRealCronWorld,
  spawnRealCron,
  killRealCronWorld,
  waitForRealCron,
  type RealCronWorld,
} from './realCronProcess.ts';

import { readPauseQueue, type PausedWorkflow } from '../../../adws/core/pauseQueue.ts';
import { acquireIssueSpawnLock, releaseIssueSpawnLock } from '../../../adws/triggers/spawnGate.ts';
import type { ScanningCronIdentity } from '../../../adws/triggers/pauseQueueDecider.ts';
import type { SpawnOrchestrator } from '../../../adws/triggers/pauseQueueResume.ts';

const AUTH_GATE_PATH = path.join('agents', '.auth_gate');

// Matches "the cron polling the target repository R" / "the self-host cron on a host checked
// out at R" — the exact prose the .feature file uses to name which cron makes a scan or a
// decision.
const CRON_TARGET_REPO_RE = /^the cron polling the target repository "([^"]+)"$/;
const CRON_SELF_HOST_RE = /^the self-host cron on a host checked out at "([^"]+)"$/;

function parseScanningCron(descriptor: string): ScanningCronIdentity {
  const targetMatch = descriptor.match(CRON_TARGET_REPO_RE);
  if (targetMatch) return scanningCronFor(targetMatch[1]);
  const selfHostMatch = descriptor.match(CRON_SELF_HOST_RE);
  if (selfHostMatch) return scanningCronFor(selfHostMatch[1], { selfHost: true });
  throw new Error(`Unrecognized scanning-cron descriptor: "${descriptor}"`);
}

// At the moment it is invoked, reads agents/paused_queue.json synchronously and records
// whether the entry for the adwId it launches is present, then hands the same arguments to
// the real child_process.spawn — the fixture orchestrator still starts and the readiness
// window still runs on real timers.
const presentAtSpawn = new Map<string, boolean>();

const spawnSeam: SpawnOrchestrator = (command, args, options) => {
  const adwId = args[3];
  if (typeof adwId === 'string') {
    presentAtSpawn.set(adwId, readPauseQueue().some((e) => e.adwId === adwId));
  }
  return realSpawn(command, args as string[], options);
};

interface HeldLock {
  proc: ChildProcess;
  repoInfo: RepoIdentifier;
  issueNumber: number;
}

const heldLocks = new Map<string, HeldLock>();

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for pid ${pid} to exit`);
}

const realCronWorld: RealCronWorld & { targetReposDir: string } = { ...createRealCronWorld(), targetReposDir: '' };
let savedAuthGate: string | null = null;

Before({ tags: '@adw-911' }, function () {
  presentAtSpawn.clear();
  Object.assign(realCronWorld, createRealCronWorld());
  realCronWorld.targetReposDir = '';
  savedAuthGate = fs.existsSync(AUTH_GATE_PATH) ? fs.readFileSync(AUTH_GATE_PATH, 'utf-8') : null;
  fs.rmSync(AUTH_GATE_PATH, { force: true });
});

After({ tags: '@adw-911' }, function () {
  for (const held of heldLocks.values()) {
    try { held.proc.kill('SIGKILL'); } catch { /* already dead */ }
    try { releaseIssueSpawnLock(held.repoInfo, held.issueNumber); } catch { /* best effort */ }
  }
  heldLocks.clear();

  killRealCronWorld(realCronWorld);
  if (realCronWorld.targetReposDir) {
    try { fs.rmSync(realCronWorld.targetReposDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  if (savedAuthGate !== null) {
    fs.mkdirSync(path.dirname(AUTH_GATE_PATH), { recursive: true });
    fs.writeFileSync(AUTH_GATE_PATH, savedAuthGate);
  } else {
    fs.rmSync(AUTH_GATE_PATH, { force: true });
  }
  savedAuthGate = null;
});

function makeOwnershipDeciderEntry(targetRepo: string | null, resetsAt: string | undefined, probeFailures: number): PausedWorkflow {
  return {
    adwId: 'decider-911-test-adw',
    issueNumber: 9999,
    orchestratorScript: 'adws/adwSdlc.tsx',
    pausedAtPhase: 'build',
    pauseReason: 'rate_limited',
    pausedAt: '2026-09-22T11:57:00Z',
    worktreePath: '/tmp/decider-911-test-worktree',
    branchName: 'decider-911-test-branch',
    probeFailures,
    ...(targetRepo ? { extraArgs: ['--target-repo', targetRepo] } : {}),
    ...(resetsAt ? { resetsAt } : {}),
  };
}

Given(
  /^a pause-queue entry recorded for the target repository "([^"]+)", with a reset time of "([^"]+)" and (\d+) probe failures?$/,
  function (targetRepo: string, resetsAt: string, failures: string) {
    setDeciderEntryForScanningCronTest(makeOwnershipDeciderEntry(targetRepo, resetsAt, Number(failures)));
  },
);

Given(
  /^a pause-queue entry recorded for the target repository "([^"]+)", with no reset time and (\d+) probe failures?$/,
  function (targetRepo: string, failures: string) {
    setDeciderEntryForScanningCronTest(makeOwnershipDeciderEntry(targetRepo, undefined, Number(failures)));
  },
);

Given(
  /^a pause-queue entry recorded for no target repository, with a reset time of "([^"]+)" and (\d+) probe failures?$/,
  function (resetsAt: string, failures: string) {
    setDeciderEntryForScanningCronTest(makeOwnershipDeciderEntry(null, resetsAt, Number(failures)));
  },
);

Given(
  /^a pause-queue entry recorded for no target repository, with no reset time and (\d+) probe failures?$/,
  function (failures: string) {
    setDeciderEntryForScanningCronTest(makeOwnershipDeciderEntry(null, undefined, Number(failures)));
  },
);

When(/^the pause-queue decider is consulted at "([^"]+)" by (.+)$/, function (isoTimestamp: string, cronDescriptor: string) {
  consultDeciderWithScanningCron(isoTimestamp, parseScanningCron(cronDescriptor));
});

Given('a workflow for issue {int} is paused in the rate-limit queue with no target repository', function (issueNumber: number) {
  seedPausedWorkflow(issueNumber, null);
});

Given('the orchestrator of the paused workflow for issue {int} exits as soon as it starts on its first launch', function (issueNumber: number) {
  const seeded = getSeededEntry(issueNumber);
  assert.ok(seeded, `Expected issue ${issueNumber} to have a known pause-queue entry`);
  const markerPath = path.join(seeded.worktreePath, 'launch-count.marker');
  const source = [
    "import { appendFileSync, existsSync, writeFileSync } from 'fs';",
    `const markerPath = ${JSON.stringify(markerPath)};`,
    `appendFileSync(${JSON.stringify(seeded.invocationLogPath)}, JSON.stringify({ argv: process.argv.slice(2), pid: process.pid }) + ${JSON.stringify('\n')});`,
    'const isFirstLaunch = !existsSync(markerPath);',
    'writeFileSync(markerPath, "launched");',
    'if (isFirstLaunch) { process.exit(1); }',
    "// Stays alive past the resume path's readiness window; the After hook kills it by script path.",
    'setInterval(() => {}, 60_000);',
  ].join('\n') + '\n';
  fs.writeFileSync(seeded.scriptPath, source, 'utf-8');
});

Given('another live process holds the spawn lock for issue {int} in the repository {string}', function (issueNumber: number, repoFullName: string) {
  const [owner, repo] = repoFullName.split('/');
  const repoInfo: RepoIdentifier = { owner, repo, platform: Platform.GitHub };
  const proc = realSpawn('sleep', ['60'], { stdio: 'ignore' });
  assert.ok(proc.pid, 'Expected the throwaway long-lived process to have a pid');
  const acquired = acquireIssueSpawnLock(repoInfo, issueNumber, proc.pid);
  assert.ok(acquired, `Expected to acquire the spawn lock for ${repoFullName}#${issueNumber}`);
  heldLocks.set(`${repoFullName}#${issueNumber}`, { proc, repoInfo, issueNumber });
});

When('the process holding the spawn lock for issue {int} in the repository {string} exits', async function (issueNumber: number, repoFullName: string) {
  const key = `${repoFullName}#${issueNumber}`;
  const held = heldLocks.get(key);
  assert.ok(held, `Expected a held spawn lock for ${key}`);
  assert.ok(held.proc.pid, 'Expected the held process to have a pid');
  held.proc.kill('SIGKILL');
  await waitForProcessExit(held.proc.pid, 10_000);
  heldLocks.delete(key);
});

When(/^the pause-queue scanner of (.+) runs (\d+) probe cycles?$/, async function (cronDescriptor: string, countStr: string) {
  await runTrackedProbeCycles(Number(countStr), parseScanningCron(cronDescriptor), spawnSeam);
});

When(
  /^the pause-queue scanner of (.+) runs two overlapping probe cycles, the second starting while the first cycle's relaunch of issue (\d+) is still inside its readiness window$/,
  async function (cronDescriptor: string, issueNumberStr: string) {
    const scanningCron = parseScanningCron(cronDescriptor);
    const issueNumber = Number(issueNumberStr);
    const seeded = getSeededEntry(issueNumber);
    assert.ok(seeded, `Expected issue ${issueNumber} to have a known pause-queue entry`);

    let resolveSpawned: () => void;
    const spawnedPromise = new Promise<void>((resolve) => { resolveSpawned = resolve; });
    const trackingSpawn: SpawnOrchestrator = (command, args, options) => {
      const child = spawnSeam(command, args, options);
      if (args[3] === seeded.entry.adwId) resolveSpawned();
      return child;
    };

    const firstCyclePromise = runOneProbeCycle(1, scanningCron, trackingSpawn);
    await spawnedPromise;
    await runOneProbeCycle(2, scanningCron, spawnSeam);
    await firstCyclePromise;
  },
);

Then('the pause queue no longer held the workflow for issue {int} when its orchestrator was spawned', function (issueNumber: number) {
  const seeded = getSeededEntry(issueNumber);
  assert.ok(seeded, `Expected issue ${issueNumber} to have a known pause-queue entry`);
  assert.ok(presentAtSpawn.has(seeded.entry.adwId), `Expected a recorded spawn-seam call for issue ${issueNumber}`);
  assert.strictEqual(
    presentAtSpawn.get(seeded.entry.adwId),
    false,
    `Expected the queue not to hold issue ${issueNumber} at the moment its orchestrator was spawned`,
  );
});

Given('the rate-limit probe reports the limit has cleared', function () {
  // No-op: the real cron process spawned below always points CLAUDE_CODE_PATH at
  // test/mocks/claude-cli-stub.ts, whose default reply (no rate-limit text, exit 0) the
  // probe classifies `clear`. This step documents that precondition for the reader.
});

Given('a cron trigger process launched with --target-repo {string} completes its first probing poll tick', async function (repoFullName: string) {
  realCronWorld.targetReposDir = fs.mkdtempSync(path.join(tmpdir(), 'adw-911-cron-targets-'));
  spawnRealCron(realCronWorld, repoFullName, {
    PROBE_INTERVAL_CYCLES: '1',
    TARGET_REPOS_DIR: realCronWorld.targetReposDir,
  });
  await waitForRealCron(realCronWorld, () => realCronWorld.stdout.includes('CRON trigger (backlog sweeper) started'), 15_000, 'cron trigger startup line');
  await waitForRealCron(
    realCronWorld,
    () => realCronWorld.stdout.includes('POLL:') || realCronWorld.stdout.includes('checkAndTrigger: tick failed'),
    20_000,
    'the first probing tick to complete',
  );
  await replayGhCommentLog();
});
