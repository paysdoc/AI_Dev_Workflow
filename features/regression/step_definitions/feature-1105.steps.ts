/**
 * The phrases of feature-1105.feature that no other file defines: the Givens that seed a workflow whose orchestrator
 * holds the issue's spawn lock, or that has used resume attempts, the Given and When that keep the orchestrators the
 * cron launches alive and end them, the When that runs the orchestrator the cron launched, and the Thens that read what
 * an orchestrator that lost the lock left. The `@regression` and `@regression and (@subprocess or @webhook)` hooks give
 * the subprocess scenarios the mock infrastructure and the subprocess harness, the cron scenarios run under the
 * `@dead-orchestrator-takeover` hooks, and the type-check scenario needs neither. The hook here, keyed on the feature's
 * own `@spawn-lock-loser`, only resets this file's state.
 */

import { After, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';
import { readSpawnLockRecord } from '../../../adws/triggers/spawnGate.ts';
import { isOrchestratorLaunch } from '../../regression/support/harnessOrchestrators.ts';
import { describeLaunches, recordedLaunches } from '../../regression/support/launchRecorder.ts';
import { SURFACE_REPO } from '../../regression/support/mockForgeProviders.ts';
import { claimAdwId, claimIssue, ensureTargetWorkspace, requireHarness } from '../../regression/support/subprocessHarness.ts';
import { findRealBunx, runThroughHarness } from '../../regression/support/subprocessRun.ts';
import { LAUNCH_WAIT_MS, bunxBinDir, s as world932, waitFor } from '../../regression/step_definitions/feature-932-world.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const OWN_SCENARIOS = '@spawn-lock-loser';
const LAUNCHED_ORCHESTRATOR_TIMEOUT_MS = 120_000;
/** Long enough for any scenario, short enough that a stand-in the cleanup missed ends on its own. */
const STAND_IN_LIFETIME_SECONDS = 300;
const LAUNCH_RECORD = /^launch-(\d+)\.args$/;

/** What a file is, as far as a write to it can tell: a write that changes nothing still moves the modification time. */
interface FileSnapshot {
  readonly content: string;
  readonly modifiedAtMs: number;
}

/** The top-level state of each adwId, as the Given that seeded it left it. */
const seededStates = new Map<string, FileSnapshot>();

/** Each stand-in is signalled once, while it is known to be alive: a pid that has ended may belong to another process by now. */
const endedStandIns = new Set<number>();

After({ tags: OWN_SCENARIOS }, function () {
  seededStates.clear();
  endedStandIns.clear();
});

function snapshotTopLevelState(adwId: string): FileSnapshot {
  const statePath = AgentStateManager.getTopLevelStatePath(adwId);
  assert.ok(existsSync(statePath), `Expected the top-level state ${statePath} to exist`);
  return { content: readFileSync(statePath, 'utf-8'), modifiedAtMs: statSync(statePath).mtimeMs };
}

/** The record the holder's `acquireIssueSpawnLock` wrote for it: the pid, and the start time read then. */
function lockHolder(issueNumber: number): { pid: number; pidStartedAt: string } {
  const holder = readSpawnLockRecord(SURFACE_REPO, issueNumber);
  assert.ok(holder, `Expected another live process to hold the spawn lock for issue ${issueNumber} in ${SURFACE_REPO.owner}/${SURFACE_REPO.repo}`);
  return holder;
}

/** The `bunx` shadow named each record after its own pid. */
function launchRecords(): { pid: number; file: string }[] {
  return readdirSync(world932.dir).flatMap((name) => {
    const match = LAUNCH_RECORD.exec(name);
    return match ? [{ pid: Number(match[1]), file: join(world932.dir, name) }] : [];
  });
}

/** A launch is `tsx <script> <issue> <adwId> …`. */
function launchedIssue(file: string): string | undefined {
  return readFileSync(file, 'utf-8').split('\0')[2];
}

function standInsFor(issueNumber: number): number[] {
  return launchRecords()
    .filter(({ pid, file }) => !endedStandIns.has(pid) && launchedIssue(file) === String(issueNumber))
    .map(({ pid }) => pid);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function endStandIn(pid: number): void {
  endedStandIns.add(pid);
  process.kill(pid, 'SIGKILL');
}

function endLiveStandIns(): void {
  if (!existsSync(world932.dir)) return;
  launchRecords()
    .map(({ pid }) => pid)
    .filter((pid) => !endedStandIns.has(pid) && isRunning(pid))
    .forEach(endStandIn);
}

Given(
  'the top-level state for adwId {string} records the process holding the spawn lock for issue {int} as its orchestrator, at workflowStage {string}',
  function (this: RegressionWorld, adwId: string, issueNumber: number, workflowStage: string) {
    const { pid, pidStartedAt } = lockHolder(issueNumber);
    claimAdwId(this, adwId);
    AgentStateManager.writeTopLevelState(adwId, {
      adwId,
      issueNumber,
      workflowStage,
      orchestratorScript: 'adws/adwSdlc.tsx',
      repoIdentity: { owner: SURFACE_REPO.owner, repo: SURFACE_REPO.repo },
      pid,
      pidStartedAt,
      lastSeenAt: new Date().toISOString(),
    });
    seededStates.set(adwId, snapshotTopLevelState(adwId));
  },
);

Given(
  'the prior run for adwId {string} has used {int} resume attempt(s)',
  function (adwId: string, resumeAttempts: number) {
    assert.ok(AgentStateManager.readTopLevelState(adwId), `Expected a prior run to have been seeded for adwId "${adwId}" first`);
    AgentStateManager.writeTopLevelState(adwId, { resumeAttempts });
  },
);

/** The launch runs as the cron made it, `tsx <script> <issue> <adwId> …`, so the orchestrator classifies the issue itself. */
When(
  'the orchestrator the cron launched for issue {int} runs',
  { timeout: 150_000 },
  async function (this: RegressionWorld, issueNumber: number) {
    const { recorder } = requireHarness(this);
    const launches = recordedLaunches(recorder).filter((argv) => isOrchestratorLaunch(argv) && argv[2] === String(issueNumber));
    assert.strictEqual(launches.length, 1, `Expected the cron to have launched exactly one orchestrator for issue ${issueNumber}. Launches: ${describeLaunches(recorder)}`);

    claimIssue(this, issueNumber);
    ensureTargetWorkspace(this);
    await runThroughHarness(
      this,
      {
        command: findRealBunx(),
        args: launches[0],
        timeoutMs: LAUNCHED_ORCHESTRATOR_TIMEOUT_MS,
        label: `The orchestrator the cron launched for issue ${issueNumber}`,
      },
      { recordsExitCode: true },
    );
  },
);

Given('every orchestrator the cron launches stays alive, still starting up, without recording anything', function (this: RegressionWorld) {
  const shadow = join(bunxBinDir(), 'bunx');
  writeFileSync(shadow, [
    '#!/bin/sh',
    `printf '%s\\0' "$@" > '${world932.dir}/launch-'$$'.args'`,
    `exec sleep ${STAND_IN_LIFETIME_SECONDS}`,
    '',
  ].join('\n'));
  chmodSync(shadow, 0o755);
  // Only from here on does a launch record name a live stand-in. The @regression After hook runs this list before
  // the @dead-orchestrator-takeover After hook removes the launch records, which hold the only copy of the pids.
  this.cleanup.push(endLiveStandIns);
});

When('the orchestrator the cron launched for issue {int} exits, having recorded nothing', async function (issueNumber: number) {
  await waitFor(() => standInsFor(issueNumber).length > 0, LAUNCH_WAIT_MS, `an orchestrator launched for issue ${issueNumber} to be alive`);
  const standIns = standInsFor(issueNumber);
  standIns.forEach(endStandIn);
  await waitFor(() => standIns.every((pid) => !isRunning(pid)), LAUNCH_WAIT_MS, `the orchestrator launched for issue ${issueNumber} to have exited`);
});

Then(
  'the execution log of the {string} for adwId {string} records that the spawn lock for issue {int} is held by the pid of the process holding it, exiting without running a phase',
  function (orchestrator: string, adwId: string, issueNumber: number) {
    const logPath = join(AGENTS_STATE_DIR, adwId, orchestrator, 'execution.log');
    assert.ok(existsSync(logPath), `Expected the execution log ${logPath} to exist`);
    const expected = `Spawn lock for issue #${issueNumber} is held by pid ${lockHolder(issueNumber).pid}; exiting without running a phase`;
    const executionLog = readFileSync(logPath, 'utf-8');
    assert.ok(executionLog.includes(expected), `Expected the execution log of ${orchestrator} for ${adwId} to hold "${expected}", it holds:\n${executionLog}`);
  },
);

Then('the orchestrator subprocess did not write the top-level state for adwId {string}', function (adwId: string) {
  const seeded = seededStates.get(adwId);
  assert.ok(seeded, `Expected the top-level state for adwId "${adwId}" to have been seeded first`);
  assert.deepStrictEqual(
    snapshotTopLevelState(adwId),
    seeded,
    `Expected the orchestrator subprocess to leave the top-level state for adwId "${adwId}" as it was seeded`,
  );
});

Then(
  'the top-level state for adwId {string} records the pid and start time of the process holding the spawn lock for issue {int}',
  function (adwId: string, issueNumber: number) {
    const state = AgentStateManager.readTopLevelState(adwId);
    assert.ok(state, `Expected the top-level state for adwId "${adwId}"`);
    assert.deepStrictEqual(
      { pid: state.pid, pidStartedAt: state.pidStartedAt },
      lockHolder(issueNumber),
      `Expected the top-level state for adwId "${adwId}" to name the process holding the spawn lock for issue ${issueNumber}`,
    );
  },
);
