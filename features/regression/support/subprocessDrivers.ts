/**
 * What W1, W9 and W10 do once the subprocess harness exists: run a named orchestrator, run the
 * workflow-init driver for the one seeded issue, and run the cron probe for one tick. Each runs the
 * real process through `runThroughHarness`, so its GitHub writes are replayed against the mock after
 * it has exited. No hooks and no import-time side effects, so any step file may import it.
 */

import assert from 'assert';
import { copyFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';
import { STUB_MANIFEST_MARKER } from '../../../test/mocks/stubMarker.ts';
import type { RegressionWorld } from '../step_definitions/world.ts';
import { targetCloneUrl } from './fixtureTargetRepo.ts';
import {
  harnessOrchestrator,
  isOrchestratorLaunch,
  orchestratorArgv,
  orchestratorForStem,
  realScriptPath,
} from './harnessOrchestrators.ts';
import { settleLaunches, waitForLaunch, type LaunchRecorder } from './launchRecorder.ts';
import { SURFACE_REPO } from './mockForgeProviders.ts';
import { claimAdwId, claimIssue, ensureTargetWorkspace, requireHarness } from './subprocessHarness.ts';
import { findRealBunx, runThroughHarness } from './subprocessRun.ts';

const ORCHESTRATOR_TIMEOUT_MS = 120_000;
const INIT_TIMEOUT_MS = 30_000;
const CRON_POLL_TIMEOUT_MS = 60_000;
/** How long the cron may take, after it has polled, to launch the orchestrator for a candidate it found. */
const DISPATCH_WAIT_MS = 20_000;

/** A configured label names the orchestrator script and the adwId: `adwPlan-surface-01`. */
const CONFIG_LABEL = /^(adw[A-Z]\w*)-(.+)$/;
const POLL_LINE = /POLL: [^\n]*\n/;
const POLL_CANDIDATES = /POLL: \d+ open, (\d+) candidate\(s\)/;
const TICK_FAILED = 'checkAndTrigger: tick failed';

/** A host `.env` that lowers these would let the probe's one tick run the hung detector, the janitor or a sweep against the checkout's shared state. */
const CADENCE_PINS: Readonly<Record<string, string>> = Object.fromEntries(
  [
    'PROBE_INTERVAL_CYCLES',
    'JANITOR_INTERVAL_CYCLES',
    'HUNG_DETECTOR_INTERVAL_CYCLES',
    'PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES',
    'PROMOTION_SWEEP_INTERVAL_CYCLES',
    'DOCS_INDEX_SWEEP_INTERVAL_CYCLES',
  ].map((variable) => [variable, '1000000']),
);

const TARGET_ARGS = ['--target-repo', `${SURFACE_REPO.owner}/${SURFACE_REPO.repo}`, '--clone-url', targetCloneUrl(SURFACE_REPO.owner, SURFACE_REPO.repo)];

/** The stub reads no MOCK_* name from an agent's environment, so G3's manifest is put where its search finds it: above every worktree the run creates, under the system's temporary directory. */
function deliverStubMarker(world: RegressionWorld): void {
  const manifestPath = world.harnessEnv['MOCK_MANIFEST_PATH'];
  if (!manifestPath) return;
  copyFileSync(manifestPath, join(requireHarness(world).targetReposDir, STUB_MANIFEST_MARKER));
}

/** W1. Fails first, naming the orchestrators it can run, when the name is not one of them. */
export async function runOrchestrator(world: RegressionWorld, name: string, adwId: string, issue: number): Promise<void> {
  harnessOrchestrator(name);
  claimAdwId(world, adwId);
  claimIssue(world, issue);
  ensureTargetWorkspace(world);
  deliverStubMarker(world);
  await runThroughHarness(
    world,
    { command: findRealBunx(), args: ['tsx', ...orchestratorArgv(name, adwId, issue)], timeoutMs: ORCHESTRATOR_TIMEOUT_MS, label: `The "${name}" orchestrator` },
    { recordsExitCode: true },
  );
}

function seededIssueNumber(world: RegressionWorld): number {
  const issues = [...world.seededIssues];
  assert.strictEqual(issues.length, 1, `Expected the scenario to seed exactly one issue for the workflow to be initialised for, but it seeded: ${issues.join(', ') || 'none'}`);
  return issues[0];
}

/** W9. The label names the orchestrator whose startup the init driver runs, and the adwId. */
export async function runWorkflowInit(world: RegressionWorld, configLabel: string): Promise<void> {
  const match = CONFIG_LABEL.exec(configLabel);
  assert.ok(match, `Expected a config label naming an orchestrator script and an adwId, such as "adwPlan-surface-01", but got "${configLabel}"`);
  const [, stem, adwId] = match;
  const { orchestratorId, issueType } = orchestratorForStem(stem);
  const issue = seededIssueNumber(world);

  claimAdwId(world, adwId);
  claimIssue(world, issue);
  ensureTargetWorkspace(world);
  deliverStubMarker(world);
  await runThroughHarness(
    world,
    {
      command: findRealBunx(),
      args: ['tsx', realScriptPath('features/regression/drivers/workflowInitDriver.ts'), orchestratorId, String(issue), adwId, '--issue-type', issueType, ...TARGET_ARGS],
      timeoutMs: INIT_TIMEOUT_MS,
      label: 'The workflow init driver',
    },
    { recordsExitCode: true },
  );
}

/** `scanAuthQueue` rewrites every `paused_auth` workflow in the checkout, whatever its repository, and the cron would resume it. */
function assertNoPausedAuthWorkflows(): void {
  const entries = existsSync(AGENTS_STATE_DIR) ? readdirSync(AGENTS_STATE_DIR, { withFileTypes: true }) : [];
  const adwIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const paused = adwIds.filter((adwId) => AgentStateManager.readTopLevelState(adwId)?.workflowStage === 'paused_auth');
  assert.deepStrictEqual(paused, [], 'The cron probe was not run: the checkout holds workflows paused for authentication, which the cron would rewrite and resume whatever their repository');
}

/** Once the cron has polled, waits for the launch it makes for each candidate it found, then for the launches to settle. */
async function settleAfterPoll(recorder: LaunchRecorder, output: string): Promise<void> {
  const candidates = Number(POLL_CANDIDATES.exec(output)?.[1] ?? 0);
  if (candidates > 0) await waitForLaunch(recorder, isOrchestratorLaunch, DISPATCH_WAIT_MS);
  await settleLaunches(recorder);
}

/** W10. The harness kills the cron after its first tick, so no exit code is recorded: "exited 0" must fail after it. */
export async function runCronProbe(world: RegressionWorld): Promise<void> {
  const { recorder } = requireHarness(world);
  assertNoPausedAuthWorkflows();
  world.seededIssues.forEach((issue) => claimIssue(world, issue));

  const { output } = await runThroughHarness(
    world,
    {
      command: findRealBunx(),
      args: ['tsx', realScriptPath('adws/triggers/trigger_cron.ts'), ...TARGET_ARGS],
      timeoutMs: CRON_POLL_TIMEOUT_MS,
      label: 'The cron probe',
      env: CADENCE_PINS,
      stopWhen: (text) => POLL_LINE.test(text) || text.includes(TICK_FAILED),
      beforeStop: (text) => settleAfterPoll(recorder, text),
    },
    { recordsExitCode: false },
  );
  assert.ok(POLL_LINE.test(output), `The cron probe's first tick failed before it polled. Last output:\n${output.trim().split('\n').slice(-40).join('\n')}`);
}
