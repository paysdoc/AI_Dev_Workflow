/**
 * The subprocess scenarios of feature-1105.feature carry `@subprocess` but no `@regression`, so the regression hooks
 * give them neither the mock infrastructure nor the subprocess harness. The hooks here do what those hooks do, for
 * those scenarios alone. The cron scenarios run under the `@dead-orchestrator-takeover` hooks, and the type-check
 * scenario needs none. The rest are the phrases no other file defines: the Givens that seed a workflow whose
 * orchestrator holds the issue's spawn lock, or that has used resume attempts, the Given and When that keep the
 * orchestrators the cron launches alive and end them, the When that runs the orchestrator the cron launched, and
 * the Thens that read what an orchestrator that lost the lock left.
 */

import { After, Before, Given, Then, When } from '@cucumber/cucumber';
import assert from 'assert';
import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';
import { readSpawnLockRecord } from '../../../adws/triggers/spawnGate.ts';
import { setupMockInfrastructure, teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';
import { runCleanup } from '../../regression/support/cleanup.ts';
import { isOrchestratorLaunch } from '../../regression/support/harnessOrchestrators.ts';
import { describeLaunches, recordedLaunches } from '../../regression/support/launchRecorder.ts';
import { SURFACE_REPO } from '../../regression/support/mockForgeProviders.ts';
import { claimAdwId, claimIssue, createSubprocessHarness, ensureTargetWorkspace, requireHarness } from '../../regression/support/subprocessHarness.ts';
import { findRealBunx, runThroughHarness } from '../../regression/support/subprocessRun.ts';
import { LAUNCH_WAIT_MS, bunxBinDir, s as world932, waitFor } from '../../regression/step_definitions/feature-932-world.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const OWN_SUBPROCESS_SCENARIO = '@adw-1105 and @subprocess and not @regression';
const OWN_CRON_SCENARIO = '@adw-1105 and @dead-orchestrator-takeover and not @regression';
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

/** Set once the `bunx` shadow keeps the orchestrators alive, since only then is the pid of a launch record one of a live process. */
let standInsAreAlive = false;
/** Each stand-in is signalled once, while it is known to be alive: a pid that has ended may belong to another process by now. */
const endedStandIns = new Set<number>();

Before({ tags: OWN_SUBPROCESS_SCENARIO }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  this.subprocess = createSubprocessHarness(this);
  seededStates.clear();
});

After({ tags: OWN_SUBPROCESS_SCENARIO }, async function (this: RegressionWorld) {
  await runCleanup(this);
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.subprocess = null;
  this.lastExitCode = -1;
  this.lastOutput = '';
  this.seededIssues = new Set();
  this.matchedLaunch = null;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
  this.cleanup = [];
  seededStates.clear();
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

/** The `bunx` shadow named each record after its own pid; a launch is `tsx <script> <issue> <adwId> …`. */
function standInsFor(issueNumber: number): number[] {
  return readdirSync(world932.dir).flatMap((name) => {
    const pid = LAUNCH_RECORD.exec(name)?.[1];
    if (pid === undefined) return [];
    const [, , issue] = readFileSync(join(world932.dir, name), 'utf-8').split('\0');
    return issue === String(issueNumber) && !endedStandIns.has(Number(pid)) ? [Number(pid)] : [];
  });
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

After({ tags: OWN_CRON_SCENARIO }, function () {
  if (standInsAreAlive && existsSync(world932.dir)) {
    for (const name of readdirSync(world932.dir)) {
      const pid = LAUNCH_RECORD.exec(name)?.[1];
      if (pid !== undefined && !endedStandIns.has(Number(pid)) && isRunning(Number(pid))) endStandIn(Number(pid));
    }
  }
  standInsAreAlive = false;
  endedStandIns.clear();
});

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

Given('every orchestrator the cron launches stays alive, still starting up, without recording anything', function () {
  const shadow = join(bunxBinDir(), 'bunx');
  writeFileSync(shadow, [
    '#!/bin/sh',
    `printf '%s\\0' "$@" > '${world932.dir}/launch-'$$'.args'`,
    `exec sleep ${STAND_IN_LIFETIME_SECONDS}`,
    '',
  ].join('\n'));
  chmodSync(shadow, 0o755);
  standInsAreAlive = true;
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
