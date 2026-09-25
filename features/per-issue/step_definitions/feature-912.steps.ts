/**
 * Novel step definitions for feature-912.feature. Every hook is scoped to
 * `@adw-912 and not @adw-910`: the four feature-910 pause-path rows that also carry
 * `@adw-912` run under feature-910's own `@adw-902 or @adw-907 or @adw-910` harness
 * (feature-902-queue.steps.ts), never this one.
 *
 * §1 drives the real, pure `decideRateLimitWait` directly. §2-§4 drive the real
 * `runPhase` in-process against a scripted fake phase function, through an injected
 * orchestrator clock (never fake timers — the heartbeat is a real interval timer) and
 * an injected comment-recording seam. §3's candidate/death rows drive the real
 * `evaluateCandidate` with the real spawn-gate functions and inert stubs for the rest.
 */

import { Given, When, Then, Before, After, setDefaultTimeout, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { Platform, type RepoIdentifier } from '@paysdoc/devplatform';
import type { GitContext } from '@paysdoc/devplatform/git';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { setupMockInfrastructure, teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';

import { AGENTS_STATE_DIR } from '../../../adws/core/config.ts';
import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { startHeartbeat, stopHeartbeat, type HeartbeatHandle } from '../../../adws/core/heartbeat.ts';
import { findHungOrchestrators, type HungOrchestrator } from '../../../adws/core/hungOrchestratorDetector.ts';
import { isProcessLive, getProcessStartTime } from '../../../adws/core/processLiveness.ts';
import { isAdwComment } from '../../../adws/core/workflowCommentParsing.ts';
import type { LaunchBoundary } from '../../../adws/core/launchGitContext.ts';
import {
  CostTracker,
  runPhase,
  type PostIssueComment,
  type PhaseResult,
} from '../../../adws/core/phaseRunner.ts';
import { decideRateLimitWait, type WaitClock, type RateLimitWaitDecision } from '../../../adws/core/rateLimitWaitPolicy.ts';
import { RateLimitError, type RateLimitFacts, type AgentState } from '../../../adws/types/agentTypes.ts';
import { readPauseQueue, PAUSE_QUEUE_PATH } from '../../../adws/core/pauseQueue.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import {
  acquireIssueSpawnLock,
  releaseIssueSpawnLock,
  readSpawnLockRecord,
  getSpawnLockFilePath,
} from '../../../adws/triggers/spawnGate.ts';
import { evaluateCandidate, type TakeoverDeps, type CandidateDecision } from '../../../adws/triggers/takeoverHandler.ts';
import { extractLatestAdwId } from '../../../adws/triggers/cronStageResolver.ts';

setDefaultTimeout(60_000);

const REPO: RepoIdentifier = { owner: 'acme', repo: 'widgets', platform: Platform.GitHub };
const TEST_HEARTBEAT_INTERVAL_MS = 20;
const TEST_HUNG_THRESHOLD_MS = 6 * TEST_HEARTBEAT_INTERVAL_MS;
const WAIT_SUSPEND_REAL_MS = 200; // real ms a wait actually blocks — longer than the hung threshold

class DriverExitSentinel extends Error {}

interface ScriptedOutcome {
  readonly outcome: 'rate-limited' | 'succeeds';
  readonly rateLimitType?: string;
  readonly resetsAt?: number;
}

interface PostedComment {
  readonly issueNumber: number;
  readonly body: string;
  readonly seq: number;
}

interface WaitEvent {
  readonly attempt: number;
  readonly until: Date;
  readonly beginState: AgentState | null;
  readonly endState: AgentState | null;
  readonly hungAtEnd: HungOrchestrator[];
  readonly seq: number;
}

interface OrchestratorSetup {
  readonly adwId: string;
  readonly issueNumber: number;
  readonly repoInfo: RepoIdentifier;
  readonly worktreePath: string;
  readonly config: WorkflowConfig;
  heartbeat: HeartbeatHandle | null;
}

interface Wait912World {
  clockNow: Date | null;
  orchestrator: OrchestratorSetup | null;
  phaseScript: ScriptedOutcome[];
  scriptedPhaseName: string | null;
  attemptStarts: number[];
  waitEvents: WaitEvent[];
  posted: PostedComment[];
  seq: number;
  exited: boolean;
  exitCode: number | null;
  diedDuringFirstWait: boolean;
  firstWaitBegunResolve: (() => void) | null;
  firstWaitBegun: Promise<void>;
  candidateArrivalIssue: number | null;
  candidateDecisionsDuringWaits: CandidateDecision[];
  lastCandidateDecision: CandidateDecision | null;
  usedAdwIds: Set<string>;
  usedIssues: Set<number>;
}

const world: Wait912World = {
  clockNow: null,
  orchestrator: null,
  phaseScript: [],
  scriptedPhaseName: null,
  attemptStarts: [],
  waitEvents: [],
  posted: [],
  seq: 0,
  exited: false,
  exitCode: null,
  diedDuringFirstWait: false,
  firstWaitBegunResolve: null,
  firstWaitBegun: Promise.resolve(),
  candidateArrivalIssue: null,
  candidateDecisionsDuringWaits: [],
  lastCandidateDecision: null,
  usedAdwIds: new Set(),
  usedIssues: new Set(),
};

const policyWorld: { facts: RateLimitFacts; decision: RateLimitWaitDecision | null } = { facts: {}, decision: null };

let savedQueueRaw: string | null = null;

function resetWorld(): void {
  world.clockNow = null;
  world.orchestrator = null;
  world.phaseScript = [];
  world.scriptedPhaseName = null;
  world.attemptStarts = [];
  world.waitEvents = [];
  world.posted = [];
  world.seq = 0;
  world.exited = false;
  world.exitCode = null;
  world.diedDuringFirstWait = false;
  world.firstWaitBegun = new Promise<void>((resolve) => { world.firstWaitBegunResolve = resolve; });
  world.candidateArrivalIssue = null;
  world.candidateDecisionsDuringWaits = [];
  world.lastCandidateDecision = null;
  world.usedAdwIds = new Set();
  world.usedIssues = new Set();
  policyWorld.facts = {};
  policyWorld.decision = null;
}

Before({ tags: '@adw-912 and not @adw-910' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  savedQueueRaw = fs.existsSync(PAUSE_QUEUE_PATH) ? fs.readFileSync(PAUSE_QUEUE_PATH, 'utf-8') : null;
  fs.rmSync(PAUSE_QUEUE_PATH, { force: true });
  resetWorld();
});

After({ tags: '@adw-912 and not @adw-910' }, async function (this: RegressionWorld) {
  if (world.orchestrator?.heartbeat) {
    stopHeartbeat(world.orchestrator.heartbeat);
    world.orchestrator.heartbeat = null;
  }
  for (const adwId of world.usedAdwIds) {
    try { fs.rmSync(path.join(process.cwd(), 'agents', adwId), { recursive: true, force: true }); } catch { /* best effort */ }
  }
  for (const issueNumber of world.usedIssues) {
    try { releaseIssueSpawnLock(REPO, issueNumber); } catch { /* best effort */ }
    try { fs.rmSync(getSpawnLockFilePath(REPO, issueNumber), { force: true }); } catch { /* best effort */ }
  }
  if (world.orchestrator?.worktreePath) {
    try { fs.rmSync(world.orchestrator.worktreePath, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  if (savedQueueRaw !== null) {
    fs.mkdirSync('agents', { recursive: true });
    fs.writeFileSync(PAUSE_QUEUE_PATH, savedQueueRaw, 'utf-8');
  } else {
    fs.rmSync(PAUSE_QUEUE_PATH, { force: true });
  }
  await teardownMockInfrastructure();
  this.mockContext = null;
});

function isoToEpochSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

// ── §1 THE WAIT POLICY ──────────────────────────────────────────────────────────────

Given('rate-limit facts with a {string} limit that resets at {string}', function (limitType: string, isoTimestamp: string) {
  policyWorld.facts = { rateLimitType: limitType, resetsAt: isoToEpochSeconds(isoTimestamp) };
});

Given('rate-limit facts with a {string} limit and no reset time', function (limitType: string) {
  policyWorld.facts = { rateLimitType: limitType };
});

Given('rate-limit facts with no limit type and a reset time of {string}', function (isoTimestamp: string) {
  policyWorld.facts = { resetsAt: isoToEpochSeconds(isoTimestamp) };
});

Given('rate-limit facts with no limit type and no reset time', function () {
  policyWorld.facts = {};
});

When('the rate-limit wait policy decides at {string}', function (isoTimestamp: string) {
  policyWorld.decision = decideRateLimitWait(policyWorld.facts, new Date(isoTimestamp));
});

Then('the wait policy decides to wait in-process until {string}', function (isoTimestamp: string) {
  assert.ok(policyWorld.decision, 'Expected the wait policy to have decided first');
  assert.strictEqual(policyWorld.decision!.kind, 'wait_in_process');
  const { until } = policyWorld.decision as { kind: 'wait_in_process'; until: Date };
  assert.strictEqual(new Date(until).getTime(), new Date(isoTimestamp).getTime());
});

Then('the wait policy decides to enqueue with the reset time {string}', function (isoTimestamp: string) {
  assert.ok(policyWorld.decision, 'Expected the wait policy to have decided first');
  assert.strictEqual(policyWorld.decision!.kind, 'enqueue');
  const { resetsAt } = policyWorld.decision as { kind: 'enqueue'; resetsAt?: number };
  assert.strictEqual(typeof resetsAt, 'number', 'Expected the enqueue decision to carry a resetsAt');
  assert.strictEqual((resetsAt as number) * 1000, new Date(isoTimestamp).getTime());
});

Then('the wait policy decides to enqueue with no reset time', function () {
  assert.ok(policyWorld.decision, 'Expected the wait policy to have decided first');
  assert.strictEqual(policyWorld.decision!.kind, 'enqueue');
  const { resetsAt } = policyWorld.decision as { kind: 'enqueue'; resetsAt?: number };
  assert.strictEqual(resetsAt, undefined);
});

// ── ORCHESTRATOR SETUP (§2-§4) ──────────────────────────────────────────────────────

Given('the orchestrator\'s clock reads {string}', function (isoTimestamp: string) {
  world.clockNow = new Date(isoTimestamp);
});

Given(
  'an orchestrator for issue {int} in the target repository {string} is running under adwId {string}',
  function (issueNumber: number, targetRepoFullName: string, adwId: string) {
    const [owner, repo] = targetRepoFullName.split('/');
    const worktreePath = fs.mkdtempSync(path.join(tmpdir(), `adw-912-worktree-${issueNumber}-`));
    const repoInfo: RepoIdentifier = { owner, repo, platform: Platform.GitHub };
    const branchName = `wait912-issue-${issueNumber}`;
    const orchestratorStatePath = path.join(AGENTS_STATE_DIR, adwId, 'orchestrator');
    fs.mkdirSync(orchestratorStatePath, { recursive: true });

    AgentStateManager.writeTopLevelState(adwId, {
      adwId,
      issueNumber,
      workflowStage: 'starting',
      pid: process.pid,
      pidStartedAt: getProcessStartTime(process.pid) ?? '',
      branchName,
      lastSeenAt: new Date().toISOString(),
    });

    const acquired = acquireIssueSpawnLock(repoInfo, issueNumber, process.pid);
    assert.ok(acquired, `Expected to acquire the spawn lock for issue ${issueNumber}`);

    const heartbeat = startHeartbeat(adwId, TEST_HEARTBEAT_INTERVAL_MS);

    const config = {
      adwId,
      issueNumber,
      orchestratorName: 'sdlc-orchestrator',
      worktreePath,
      branchName,
      targetRepo: { owner, repo, cloneUrl: `https://example.invalid/${owner}/${repo}.git` },
      orchestratorStatePath,
      ctx: { issueNumber, adwId },
      completedPhases: [],
    } as unknown as WorkflowConfig;

    world.orchestrator = { adwId, issueNumber, repoInfo, worktreePath, config, heartbeat };
    world.usedAdwIds.add(adwId);
    world.usedIssues.add(issueNumber);
  },
);

function requireOrchestrator(): OrchestratorSetup {
  assert.ok(world.orchestrator, 'Expected a running orchestrator to have been set up first');
  return world.orchestrator!;
}

Given('the {string} phase meets these outcomes, attempt by attempt:', function (phase: string, table: DataTable) {
  world.scriptedPhaseName = phase;
  world.phaseScript = table.hashes().map((row): ScriptedOutcome => ({
    outcome: row['outcome'] as 'rate-limited' | 'succeeds',
    ...(row['limit type'] ? { rateLimitType: row['limit type'] } : {}),
    ...(row['resets at'] ? { resetsAt: isoToEpochSeconds(row['resets at']) } : {}),
  }));
});

Given(
  'the {string} phase is rejected by {int} five-hour limits in a row, the first resetting at {string} and each later one five hours after the one before, and then succeeds',
  function (phase: string, count: number, firstIso: string) {
    const firstEpoch = isoToEpochSeconds(firstIso);
    const script: ScriptedOutcome[] = [];
    for (let i = 0; i < count; i++) {
      script.push({ outcome: 'rate-limited', rateLimitType: 'five_hour', resetsAt: firstEpoch + i * 5 * 3600 });
    }
    script.push({ outcome: 'succeeds' });
    world.scriptedPhaseName = phase;
    world.phaseScript = script;
  },
);

Given('the orchestrator process dies during its first wait', function () {
  world.diedDuringFirstWait = true;
});

Given('a candidate arrives at issue {int} during every wait', function (issueNumber: number) {
  world.candidateArrivalIssue = issueNumber;
});

// ── THE PHASE RUNNER'S WHEN ─────────────────────────────────────────────────────────

function buildScriptedPhaseFn(): (config: WorkflowConfig) => Promise<PhaseResult> {
  let call = 0;
  return async (): Promise<PhaseResult> => {
    const idx = call++;
    world.attemptStarts.push(world.clockNow!.getTime());
    assert.ok(idx < world.phaseScript.length, `Scripted phase called more times (${idx + 1}) than scripted (${world.phaseScript.length})`);
    const step = world.phaseScript[idx];
    if (step.outcome === 'rate-limited') {
      throw new RateLimitError(world.scriptedPhaseName ?? 'unknown', {
        ...(step.rateLimitType ? { rateLimitType: step.rateLimitType } : {}),
        ...(step.resetsAt !== undefined ? { resetsAt: step.resetsAt } : {}),
      });
    }
    return { costUsd: 0, modelUsage: {}, phaseCostRecords: [] };
  };
}

function buildMinimalBoundary(worktreePath: string): LaunchBoundary {
  return {
    repoId: REPO,
    gitContext: { worktreePathFor: () => worktreePath } as unknown as GitContext,
    providers: {},
  } as unknown as LaunchBoundary;
}

/** Real spawn-gate functions; inert stubs for everything this harness cannot reach. */
function buildCandidateTakeoverDeps(o: OrchestratorSetup): TakeoverDeps {
  return {
    acquireIssueSpawnLock: (repoInfo, issueNumber, ownPid) => acquireIssueSpawnLock(repoInfo, issueNumber, ownPid),
    releaseIssueSpawnLock: (repoInfo, issueNumber) => releaseIssueSpawnLock(repoInfo, issueNumber),
    readSpawnLockRecord: (repoInfo, issueNumber) => readSpawnLockRecord(repoInfo, issueNumber),
    resolveAdwId: () => {
      const startingComment = { body: `**ADW ID:** \`${o.adwId}\`` };
      const waitComments = world.posted.filter(p => p.issueNumber === o.issueNumber).map(p => ({ body: p.body }));
      return extractLatestAdwId([startingComment, ...waitComments]);
    },
    readTopLevelState: (adwId) => AgentStateManager.readTopLevelState(adwId),
    isProcessLive: (pid, pidStartedAt) => isProcessLive(pid, pidStartedAt),
    killProcess: () => { throw new Error('killProcess must not be called in this harness'); },
    resetWorktree: () => { /* recorded implicitly: no assertion needs its args */ },
    deriveStageFromRemote: () => 'awaiting_merge',
    writeTopLevelState: (adwId, state) => AgentStateManager.writeTopLevelState(adwId, state),
    commentOnIssue: () => { /* not asserted by this feature's scenarios */ },
    probeWorktree: () => ({
      registration: 'healthy',
      indexLock: 'absent',
      interruptedOp: 'none',
      headOnExpectedBranch: true,
      liveOwner: false,
    }),
    clearOrphanedIndexLock: () => { /* not asserted by this feature's scenarios */ },
  };
}

function makeOrchestratorClock(o: OrchestratorSetup): WaitClock {
  return {
    now: () => world.clockNow!,
    sleep: async (ms: number): Promise<void> => {
      const until = new Date(world.clockNow!.getTime() + ms);
      const beginState = AgentStateManager.readTopLevelState(o.adwId);
      world.firstWaitBegunResolve?.();

      if (world.diedDuringFirstWait && world.waitEvents.length === 0) {
        return new Promise<void>(() => { /* never resolves: the process dies mid-wait */ });
      }

      await new Promise<void>((resolve) => setTimeout(resolve, WAIT_SUSPEND_REAL_MS));

      if (world.candidateArrivalIssue === o.issueNumber) {
        const decision = evaluateCandidate(
          { issueNumber: o.issueNumber, boundary: buildMinimalBoundary(o.worktreePath) },
          buildCandidateTakeoverDeps(o),
        );
        world.candidateDecisionsDuringWaits.push(decision);
      }

      const hungAtEnd = findHungOrchestrators(Date.now(), TEST_HUNG_THRESHOLD_MS, {
        listAdwIds: () => [o.adwId],
        readTopLevelState: (adwId) => AgentStateManager.readTopLevelState(adwId),
        isProcessLive: (pid, pidStartedAt) => isProcessLive(pid, pidStartedAt),
      });
      const endState = AgentStateManager.readTopLevelState(o.adwId);

      world.waitEvents.push({ attempt: world.waitEvents.length + 1, until, beginState, endState, hungAtEnd, seq: world.seq++ });
      world.clockNow = until;
    },
  };
}

async function simulateOrchestratorDeath(o: OrchestratorSetup): Promise<void> {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve());
    child.once('error', reject);
  });
  const deadPid = child.pid;
  assert.ok(deadPid, 'Expected the throwaway child process to have a pid');
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  const deadPidStartedAt = getProcessStartTime(deadPid) ?? '';
  assert.ok(deadPidStartedAt, 'Expected to capture a start-time token for the throwaway child');

  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });

  AgentStateManager.writeTopLevelState(o.adwId, { pid: deadPid, pidStartedAt: deadPidStartedAt });

  const lockFilePath = getSpawnLockFilePath(o.repoInfo, o.issueNumber);
  const existingLock = JSON.parse(fs.readFileSync(lockFilePath, 'utf-8')) as Record<string, unknown>;
  fs.writeFileSync(lockFilePath, JSON.stringify({ ...existingLock, pid: deadPid, pidStartedAt: deadPidStartedAt }, null, 2), 'utf-8');
}

async function driveOrchestratedPhase(phase: string, anonymous: boolean): Promise<void> {
  const o = requireOrchestrator();
  const clock = makeOrchestratorClock(o);
  const postComment: PostIssueComment = (issueNumber, body) => {
    world.posted.push({ issueNumber, body, seq: world.seq++ });
  };
  const tracker = new CostTracker();
  const phaseFn = buildScriptedPhaseFn();

  const originalExit = process.exit;
  process.exit = ((code?: number) => {
    world.exited = true;
    world.exitCode = code ?? 0;
    throw new DriverExitSentinel();
  }) as typeof process.exit;

  const runPromise = runPhase(o.config, tracker, phaseFn, anonymous ? undefined : phase, { clock, postComment })
    .catch((err) => {
      if (err instanceof DriverExitSentinel) return;
      throw err;
    })
    .finally(() => { process.exit = originalExit; });

  if (world.diedDuringFirstWait) {
    await world.firstWaitBegun;
    runPromise.catch(() => { /* abandoned: this wait never resolves */ });
    if (o.heartbeat) { stopHeartbeat(o.heartbeat); o.heartbeat = null; }
    await simulateOrchestratorDeath(o);
    return;
  }

  await runPromise;
  if (o.heartbeat) { stopHeartbeat(o.heartbeat); o.heartbeat = null; }
}

When('the phase runner runs the {string} phase', async function (phase: string) {
  await driveOrchestratedPhase(phase, false);
});

When('the phase runner runs the {string} phase anonymously', async function (phase: string) {
  await driveOrchestratedPhase(phase, true);
});

When('the next candidate arrives at issue {int}', function (issueNumber: number) {
  const o = requireOrchestrator();
  assert.strictEqual(o.issueNumber, issueNumber);
  world.lastCandidateDecision = evaluateCandidate(
    { issueNumber, boundary: buildMinimalBoundary(o.worktreePath) },
    buildCandidateTakeoverDeps(o),
  );
});

// ── §2/§3 THEN: ATTEMPTS, WAITS, STAGE, HEARTBEAT, DETECTOR, CANDIDATES ─────────────

Then('the {string} phase ran {int} time(s)', function (phase: string, n: number) {
  void phase;
  assert.strictEqual(world.attemptStarts.length, n);
});

Then('the orchestrator waited in-process until each of these times, in order:', function (table: DataTable) {
  const expected = table.hashes().map(r => new Date(r['waits until']).getTime());
  const actual = world.waitEvents.map(e => e.until.getTime());
  assert.deepStrictEqual(actual, expected);
});

Then('the orchestrator waited in-process {int} times, each until the reset time reported by the rejection before it', function (n: number) {
  assert.strictEqual(world.waitEvents.length, n);
  world.waitEvents.forEach((e, i) => {
    const rejection = world.phaseScript[i];
    assert.strictEqual(typeof rejection.resetsAt, 'number', `Expected scripted rejection ${i + 1} to carry a reset time`);
    assert.strictEqual(e.until.getTime(), (rejection.resetsAt as number) * 1000);
  });
});

Then('the orchestrator did not wait in-process', function () {
  assert.strictEqual(world.waitEvents.length, 0);
});

Then('no re-run of the {string} phase started before the reset time it waited for', function (phase: string) {
  void phase;
  world.waitEvents.forEach((e, i) => {
    const nextAttemptStart = world.attemptStarts[i + 1];
    assert.ok(nextAttemptStart !== undefined, `Expected an attempt after wait ${i + 1}`);
    assert.ok(
      nextAttemptStart >= e.until.getTime(),
      `Expected attempt ${i + 2} to start at or after ${e.until.toISOString()}, started at ${new Date(nextAttemptStart).toISOString()}`,
    );
  });
});

Then('the orchestrator never exited', function () {
  assert.strictEqual(world.exited, false, `Expected no process.exit call, but got code ${world.exitCode}`);
});

Then('the orchestrator exited with code {int}', function (code: number) {
  assert.strictEqual(world.exited, true, 'Expected process.exit to have been called');
  assert.strictEqual(world.exitCode, code);
});

Then(
  'the state file for adwId {string} recorded workflowStage {string} throughout every wait',
  function (adwId: string, expectedStage: string) {
    assert.ok(world.waitEvents.length > 0, `Expected at least one wait for adwId ${adwId}`);
    for (const e of world.waitEvents) {
      assert.strictEqual(e.beginState?.workflowStage, expectedStage);
      assert.strictEqual(e.endState?.workflowStage, expectedStage);
    }
  },
);

Then('the heartbeat advanced lastSeenAt in the state file for adwId {string} during every wait', function (adwId: string) {
  void adwId;
  assert.ok(world.waitEvents.length > 0, 'Expected at least one wait');
  for (const e of world.waitEvents) {
    const begin = e.beginState?.lastSeenAt ? new Date(e.beginState.lastSeenAt).getTime() : -Infinity;
    const end = e.endState?.lastSeenAt ? new Date(e.endState.lastSeenAt).getTime() : -Infinity;
    assert.ok(end > begin, `Expected lastSeenAt to advance during wait ${e.attempt} (begin=${begin}, end=${end})`);
  }
});

Then('the hung-orchestrator detector did not report adwId {string} at the end of any wait', function (adwId: string) {
  assert.ok(world.waitEvents.length > 0, 'Expected at least one wait');
  for (const e of world.waitEvents) {
    assert.ok(!e.hungAtEnd.some(h => h.adwId === adwId), `Expected adwId ${adwId} not reported hung at the end of wait ${e.attempt}`);
  }
});

Then('every candidate that arrived at issue {int} during a wait was deferred to the waiting orchestrator', function (issueNumber: number) {
  void issueNumber;
  assert.ok(world.candidateDecisionsDuringWaits.length > 0, 'Expected at least one candidate to have arrived during a wait');
  for (const decision of world.candidateDecisionsDuringWaits) {
    assert.strictEqual(decision.kind, 'defer_live_holder');
    assert.strictEqual((decision as { kind: 'defer_live_holder'; holderPid: number }).holderPid, process.pid);
  }
});

Then('the candidate takes the workflow over under adwId {string}', function (adwId: string) {
  assert.ok(world.lastCandidateDecision, 'Expected "the next candidate arrives" to have run first');
  assert.strictEqual(world.lastCandidateDecision!.kind, 'take_over_adwId');
  assert.strictEqual((world.lastCandidateDecision as { kind: 'take_over_adwId'; adwId: string }).adwId, adwId);
});

// ── WAIT COMMENTS ────────────────────────────────────────────────────────────────────

function postedFor(issueNumber: number): PostedComment[] {
  return world.posted.filter(p => p.issueNumber === issueNumber);
}

Then('no wait comment was posted on issue {int}', function (issueNumber: number) {
  assert.strictEqual(postedFor(issueNumber).length, 0);
});

Then('exactly {int} wait comment(s) was/were posted on issue {int}', function (n: number, issueNumber: number) {
  assert.strictEqual(postedFor(issueNumber).length, n);
});

Then(
  'the wait comments on issue {int} name these attempts and wait-until times in UTC, in order:',
  function (issueNumber: number, table: DataTable) {
    const rows = table.hashes();
    const comments = postedFor(issueNumber);
    assert.strictEqual(comments.length, rows.length);
    rows.forEach((row, i) => {
      const body = comments[i].body;
      assert.ok(body.includes(`**Attempt:** ${row['attempt']}`), `Expected attempt ${row['attempt']} in comment ${i}`);
      assert.ok(body.includes(new Date(row['waits until']).toISOString()), `Expected wait-until ${row['waits until']} in comment ${i}`);
      assert.match(body, /\(UTC\)/);
    });
  },
);

Then('each wait comment on issue {int} was posted before the wait it announces began', function (issueNumber: number) {
  const comments = postedFor(issueNumber);
  assert.strictEqual(comments.length, world.waitEvents.length, 'Expected one wait comment per wait');
  comments.forEach((c, i) => {
    assert.ok(c.seq < world.waitEvents[i].seq, `Expected comment ${i} (seq ${c.seq}) to precede wait ${i} (seq ${world.waitEvents[i].seq})`);
  });
});

Then('every wait comment on issue {int} says the workflow is waiting for a rate limit to reset', function (issueNumber: number) {
  const comments = postedFor(issueNumber);
  assert.ok(comments.length > 0, 'Expected at least one wait comment');
  for (const c of comments) {
    assert.match(c.body, /rate[ _-]?limit|five[ _-]?hour|5[ -]?hour|session limit|usage limit/i);
  }
});

Then('every wait comment on issue {int} is recognised by ADW as its own comment', function (issueNumber: number) {
  const comments = postedFor(issueNumber);
  assert.ok(comments.length > 0, 'Expected at least one wait comment');
  for (const c of comments) assert.ok(isAdwComment(c.body));
});

Then('the wait comments on issue {int} carry the attempt numbers 1 to {int}, in order', function (issueNumber: number, n: number) {
  const comments = postedFor(issueNumber);
  assert.strictEqual(comments.length, n);
  comments.forEach((c, i) => {
    assert.ok(c.body.includes(`**Attempt:** ${i + 1}`), `Expected attempt ${i + 1} in comment ${i}`);
  });
});

// ── §4 PAUSE QUEUE ───────────────────────────────────────────────────────────────────

function requirePauseEntry(adwId: string) {
  const entry = readPauseQueue().find(e => e.adwId === adwId);
  assert.ok(entry, `Expected a pause-queue entry for adwId ${adwId}`);
  return entry!;
}

Then('the pause queue does not hold adwId {string}', function (adwId: string) {
  const entry = readPauseQueue().find(e => e.adwId === adwId);
  assert.strictEqual(entry, undefined, `Expected no pause-queue entry for adwId ${adwId}`);
});

Then('the pause queue holds adwId {string} with a {string} limit that resets at {string}', function (adwId: string, limitType: string, isoTimestamp: string) {
  const entry = requirePauseEntry(adwId);
  assert.strictEqual(entry.rateLimitType, limitType);
  assert.ok(entry.resetsAt, `Expected adwId ${adwId}'s entry to carry a resetsAt`);
  assert.strictEqual(new Date(entry.resetsAt as string).getTime(), new Date(isoTimestamp).getTime());
});

Then('the pause queue holds adwId {string} with a {string} limit and no reset time', function (adwId: string, limitType: string) {
  const entry = requirePauseEntry(adwId);
  assert.strictEqual(entry.rateLimitType, limitType);
  assert.strictEqual(entry.resetsAt, undefined);
});

Then('the pause queue holds adwId {string} with no limit type and no reset time', function (adwId: string) {
  const entry = requirePauseEntry(adwId);
  assert.strictEqual(entry.rateLimitType, undefined);
  assert.strictEqual(entry.resetsAt, undefined);
});
