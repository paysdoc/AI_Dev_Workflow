/**
 * Novel step definitions for feature-910.feature. Reuses feature-902's harness
 * (probeStub, the mock GitHub / gh-shadow infrastructure, the seeded-entry map, the
 * shared "the pause-queue scanner runs N probe cycle(s)" step) rather than
 * re-initialising it — see feature-902.steps.ts and feature-902-queue.steps.ts for the
 * Before/After hooks this file's scenarios also run under (widened to
 * `@adw-902 or @adw-907 or @adw-910`).
 */

import { Given, When, Then, Before, After } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

import {
  registerSeededEntry,
  getSeededEntry,
  setPinnedClock,
  enableBunxRelaunchIntercept,
  disableBunxRelaunchIntercept,
  getScannerRunSummary,
  type SeededEntry,
} from './feature-902-queue.steps.ts';

import { AGENTS_STATE_DIR, MAX_UNKNOWN_PROBE_FAILURES } from '../../../adws/core/config.ts';
import { REPO_ROOT } from '../../../adws/core/index.ts';
import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { readPauseQueue, updatePauseQueueEntry, PAUSE_QUEUE_PATH, type PausedWorkflow } from '../../../adws/core/pauseQueue.ts';
import { CostTracker, runPhase } from '../../../adws/core/phaseRunner.ts';
import { RateLimitError, type RateLimitFacts } from '../../../adws/types/agentTypes.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import { decidePauseQueueAction, type PauseQueueAction } from '../../../adws/triggers/pauseQueueDecider.ts';
import type { ProbeClassification, ProbeOutcome } from '../../../adws/triggers/rateLimitProbe.ts';

// Sentinel thrown when process.exit is called inside the real pause path.
class PausePathExitSentinel extends Error {
  constructor(public readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

interface PausePathSetup {
  config: WorkflowConfig;
  issueNumber: number;
  worktreePath: string;
}

const deciderWorld: {
  entry: PausedWorkflow | null;
  probe: ProbeClassification | null;
  action: PauseQueueAction | null;
} = { entry: null, probe: null, action: null };

let pausePath: PausePathSetup | null = null;

Before({ tags: '@adw-910' }, function () {
  pausePath = null;
  deciderWorld.entry = null;
  deciderWorld.probe = null;
  deciderWorld.action = null;
});

After({ tags: '@adw-910' }, function () {
  setPinnedClock(null);
  disableBunxRelaunchIntercept();
  pausePath = null;
});

// ── §1 THE PAUSE PATH ──────────────────────────────────────────────────────────────────────

Given(
  'a workflow for issue {int} is running its {string} phase for the target repository {string}',
  function (issueNumber: number, _phase: string, targetRepoFullName: string) {
    const [owner, repo] = targetRepoFullName.split('/');
    const adwId = `bdd910-${issueNumber}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
    const worktreePath = fs.mkdtempSync(path.join(tmpdir(), `adw-910-worktree-${issueNumber}-`));
    const orchestratorStatePath = path.join(AGENTS_STATE_DIR, adwId, 'orchestrator');
    fs.mkdirSync(orchestratorStatePath, { recursive: true });

    // Canonical-claim precondition for the later resume path.
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber, workflowStage: 'running' });

    const config = {
      adwId,
      issueNumber,
      orchestratorName: 'sdlc-orchestrator',
      worktreePath,
      branchName: `bdd-910-issue-${issueNumber}`,
      targetRepo: { owner, repo, cloneUrl: `https://example.invalid/${owner}/${repo}.git` },
      orchestratorStatePath,
      ctx: { issueNumber, adwId },
      completedPhases: [],
      // NO repoContext — the pause path posts nothing; every recorded comment is the scanner's.
    } as unknown as WorkflowConfig;

    pausePath = { config, issueNumber, worktreePath };
  },
);

async function drivePausePath(phase: string, facts: RateLimitFacts): Promise<void> {
  assert.ok(pausePath, 'Expected a running-phase workflow to have been set up first');
  const { config, issueNumber, worktreePath } = pausePath;
  const tracker = new CostTracker();

  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    throw new PausePathExitSentinel(code);
  }) as typeof process.exit;

  try {
    await runPhase(config, tracker, async () => {
      throw new RateLimitError(phase, facts);
    }, phase);
    assert.fail('Expected runPhase to end the process via the pause path');
  } catch (err) {
    if (!(err instanceof PausePathExitSentinel)) throw err;
  } finally {
    process.exit = originalExit;
  }

  const writtenEntry = readPauseQueue().find(e => e.adwId === config.adwId);
  assert.ok(writtenEntry, 'Expected the pause path to have appended a queue entry');

  const resolvedScript = path.isAbsolute(writtenEntry.orchestratorScript)
    ? writtenEntry.orchestratorScript
    : path.join(REPO_ROOT, writtenEntry.orchestratorScript);
  const invocationLogPath = path.join(worktreePath, 'bunx-invocations.log');

  const seeded: SeededEntry = {
    entry: writtenEntry,
    worktreePath,
    scriptPath: resolvedScript,
    invocationLogPath,
    baselineProbeFailures: 0,
  };
  registerSeededEntry(issueNumber, seeded);
  enableBunxRelaunchIntercept(invocationLogPath);
}

When(
  'the {string} phase is stopped by a rate-limit error carrying a {string} limit that resets at {string}',
  async function (phase: string, limitType: string, isoTimestamp: string) {
    const resetsAt = Math.floor(new Date(isoTimestamp).getTime() / 1000);
    await drivePausePath(phase, { rateLimitType: limitType, resetsAt });
  },
);

When(
  'the {string} phase is stopped by a rate-limit error carrying a {string} limit with no reset time',
  async function (phase: string, limitType: string) {
    await drivePausePath(phase, { rateLimitType: limitType });
  },
);

When(
  'the {string} phase is stopped by a rate-limit error carrying no limit type and no reset time',
  async function (phase: string) {
    await drivePausePath(phase, {});
  },
);

// ── shared entry lookups ────────────────────────────────────────────────────────────────────

function requireCurrentEntry(issueNumber: number): PausedWorkflow {
  const seeded = getSeededEntry(issueNumber);
  assert.ok(seeded, `Expected issue ${issueNumber} to have a known pause-queue entry`);
  const current = readPauseQueue().find(e => e.adwId === seeded.entry.adwId);
  assert.ok(current, `Expected issue ${issueNumber} to still be queued`);
  return current;
}

Then('the workflow for issue {int} is recorded at workflow stage {string}', function (issueNumber: number, expectedStage: string) {
  const seeded = getSeededEntry(issueNumber);
  assert.ok(seeded, `Expected issue ${issueNumber} to have a known adwId`);
  const state = AgentStateManager.readTopLevelState(seeded.entry.adwId);
  assert.ok(state, `Expected top-level state for adwId ${seeded.entry.adwId}`);
  assert.strictEqual(state.workflowStage, expectedStage);
});

Then('the pause queue entry for issue {int} records the limit type {string}', function (issueNumber: number, expectedType: string) {
  const entry = requireCurrentEntry(issueNumber);
  assert.strictEqual(entry.rateLimitType, expectedType);
});

Then('the pause queue entry for issue {int} records the reset time {string}', function (issueNumber: number, isoTimestamp: string) {
  const entry = requireCurrentEntry(issueNumber);
  assert.ok(entry.resetsAt, `Expected issue ${issueNumber}'s entry to carry a resetsAt`);
  assert.strictEqual(new Date(entry.resetsAt).getTime(), new Date(isoTimestamp).getTime());
});

Then('the pause queue entry for issue {int} stores its reset time as an ISO 8601 timestamp', function (issueNumber: number) {
  const entry = requireCurrentEntry(issueNumber);
  assert.ok(entry.resetsAt, `Expected issue ${issueNumber}'s entry to carry a resetsAt`);
  assert.match(
    entry.resetsAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    `Expected an ISO 8601 date-time string, got: ${entry.resetsAt}`,
  );
});

Then('the pause queue entry for issue {int} records no reset time', function (issueNumber: number) {
  const entry = requireCurrentEntry(issueNumber);
  assert.strictEqual(entry.resetsAt, undefined);
});

Then('the pause queue entry for issue {int} records no limit type', function (issueNumber: number) {
  const entry = requireCurrentEntry(issueNumber);
  assert.strictEqual(entry.rateLimitType, undefined);
});

// ── §2 THE DECIDER ──────────────────────────────────────────────────────────────────────────

function makeDeciderEntry(resetsAt: string | undefined, probeFailures: number): PausedWorkflow {
  return {
    adwId: 'decider-test-adw',
    issueNumber: 9999,
    orchestratorScript: 'adws/adwSdlc.tsx',
    pausedAtPhase: 'build',
    pauseReason: 'rate_limited',
    pausedAt: '2026-09-22T11:57:00Z',
    worktreePath: '/tmp/decider-test-worktree',
    branchName: 'decider-test-branch',
    extraArgs: ['--target-repo', 'acme/widgets'],
    probeFailures,
    ...(resetsAt ? { resetsAt } : {}),
  };
}

Given('a pause-queue entry with a reset time of {string} and {int} probe failures', function (resetsAt: string, probeFailures: number) {
  deciderWorld.entry = makeDeciderEntry(resetsAt, probeFailures);
});

Given('a pause-queue entry with no reset time and {int} probe failures', function (probeFailures: number) {
  deciderWorld.entry = makeDeciderEntry(undefined, probeFailures);
});

Given('the rate-limit probe classification is {string}', function (verdict: string) {
  deciderWorld.probe = { verdict: verdict as ProbeOutcome };
});

Given(
  'the rate-limit probe classification is {string} with a {string} limit that resets at {string}',
  function (verdict: string, limitType: string, isoTimestamp: string) {
    const resetsAt = Math.floor(new Date(isoTimestamp).getTime() / 1000);
    deciderWorld.probe = { verdict: verdict as ProbeOutcome, rateLimitType: limitType, resetsAt };
  },
);

When('the pause-queue decider is consulted at {string}', function (isoTimestamp: string) {
  assert.ok(deciderWorld.entry, 'Expected a pause-queue entry to have been set up first');
  assert.ok(deciderWorld.probe, 'Expected a rate-limit probe classification to have been set up first');
  deciderWorld.action = decidePauseQueueAction({
    entry: deciderWorld.entry,
    probe: deciderWorld.probe,
    now: new Date(isoTimestamp),
    maxProbeFailures: MAX_UNKNOWN_PROBE_FAILURES,
  });
});

function requireDeciderAction(): PauseQueueAction {
  assert.ok(deciderWorld.action, 'Expected the pause-queue decider to have been consulted first');
  return deciderWorld.action;
}

Then('the pause-queue decider returns {string}', function (expectedKind: string) {
  assert.strictEqual(requireDeciderAction().kind, expectedKind);
});

Then('the pause-queue decider returns {string} with the reset time {string}', function (expectedKind: string, isoTimestamp: string) {
  const action = requireDeciderAction();
  assert.strictEqual(action.kind, expectedKind);
  const resetsAt = 'resetsAt' in action ? action.resetsAt : undefined;
  assert.ok(resetsAt, `Expected the "${expectedKind}" action to carry a resetsAt`);
  assert.strictEqual(new Date(resetsAt).getTime(), new Date(isoTimestamp).getTime());
});

Then('the pause-queue decider neither resumes, strikes nor evicts the entry', function () {
  const action = requireDeciderAction();
  assert.ok(
    !['resume', 'count_strike', 'evict'].includes(action.kind),
    `Expected neither resume, count_strike nor evict, got: ${action.kind}`,
  );
});

Then('the pause-queue decider sets no new reset time on the entry', function () {
  const action = requireDeciderAction();
  const resetsAt = 'resetsAt' in action ? action.resetsAt : undefined;
  assert.strictEqual(resetsAt, undefined, `Expected no new resetsAt, got: ${JSON.stringify(action)}`);
});

// ── §3 THE CLOCK, THE SEEDED RESET FACTS, HOW OFTEN THE SCANNER PROBED ─────────────────────

Given('the cron host\'s clock reads {string}', function (isoTimestamp: string) {
  setPinnedClock(new Date(isoTimestamp));
});

Given(
  'the paused workflow for issue {int} was queued with a {string} limit that resets at {string}',
  function (issueNumber: number, limitType: string, isoTimestamp: string) {
    const seeded = getSeededEntry(issueNumber);
    assert.ok(seeded, `Expected issue ${issueNumber} to already be seeded in the pause queue`);
    updatePauseQueueEntry(seeded.entry.adwId, { rateLimitType: limitType, resetsAt: isoTimestamp });
  },
);

Then('the scanner did not run the rate-limit probe', function () {
  const { probeCallsBefore, probeCallsAfter } = getScannerRunSummary();
  assert.strictEqual(
    probeCallsAfter, probeCallsBefore,
    `Expected no probe calls during the last scan, but saw ${probeCallsAfter - probeCallsBefore}`,
  );
});

Then('the scanner ran the rate-limit probe once per probe cycle', function () {
  const { probeCallsBefore, probeCallsAfter, cyclesRequested } = getScannerRunSummary();
  assert.strictEqual(
    probeCallsAfter - probeCallsBefore, cyclesRequested,
    `Expected ${cyclesRequested} probe call(s), saw ${probeCallsAfter - probeCallsBefore}`,
  );
});

// ── §6 LEGACY ENTRIES ───────────────────────────────────────────────────────────────────────

function writeLegacyFixtureOrchestratorScript(worktreePath: string, invocationLogPath: string): string {
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

Given(
  'a workflow for issue {int} was paused in the rate-limit queue for the target repository {string} by a release that recorded no reset time or limit type',
  function (issueNumber: number, targetRepo: string) {
    const adwId = `bdd910-legacy-${issueNumber}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
    const worktreePath = fs.mkdtempSync(path.join(tmpdir(), `adw-910-legacy-worktree-${issueNumber}-`));
    const invocationLogPath = path.join(worktreePath, 'invocations.log');
    const scriptPath = writeLegacyFixtureOrchestratorScript(worktreePath, invocationLogPath);

    AgentStateManager.writeTopLevelState(adwId, { adwId, workflowStage: 'paused' });

    // Exactly the pre-#910 shape: no resetsAt, no rateLimitType. Written as raw JSON,
    // bypassing appendToPauseQueue, so a default added on the write path could never
    // mask a regression on load.
    const legacyEntry = {
      adwId,
      issueNumber,
      orchestratorScript: scriptPath,
      pausedAtPhase: 'sdlc_planner',
      pauseReason: 'rate_limited',
      pausedAt: new Date().toISOString(),
      probeFailures: 0,
      worktreePath,
      branchName: `bdd-910-legacy-issue-${issueNumber}`,
      extraArgs: ['--target-repo', targetRepo],
    };

    const existing = readPauseQueue();
    fs.mkdirSync('agents', { recursive: true });
    fs.writeFileSync(PAUSE_QUEUE_PATH, JSON.stringify([...existing, legacyEntry], null, 2), 'utf-8');

    registerSeededEntry(issueNumber, {
      entry: legacyEntry as PausedWorkflow,
      worktreePath,
      scriptPath,
      invocationLogPath,
      baselineProbeFailures: 0,
    });
  },
);
