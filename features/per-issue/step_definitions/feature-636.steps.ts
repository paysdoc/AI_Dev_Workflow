/**
 * BDD step definitions for feature-636.feature
 *
 * Exhaustive classifyStage + route cron/takeover through it (behaviour-preserving)
 *
 * §1–§4  drive evaluateIssue (cronIssueFilter) with an injected resolveStage stub
 * §5–§10 drive evaluateCandidate (takeoverHandler) with injected TakeoverDeps
 * §11    asserts the TypeScript type-check passes (T22 — implemented in feature-504.steps.ts)
 * G18    "the ADW codebase is checked out" — implemented in ensureCronOnEveryEventSteps.ts
 */

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { evaluateIssue } from '../../../adws/triggers/cronIssueFilter.ts';
import { evaluateCandidate } from '../../../adws/triggers/takeoverHandler.ts';
import type { CronIssue, FilterResult } from '../../../adws/triggers/cronIssueFilter.ts';
import type { TakeoverDeps, CandidateDecision } from '../../../adws/triggers/takeoverHandler.ts';
import type { AgentState } from '../../../adws/types/agentTypes.ts';
import type { RepoInfo } from '../../../adws/github/githubApi.ts';
import type { WorkflowStage } from '../../../adws/types/workflowTypes.ts';

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

const FIXED_ADW_ID = 'test-adwid-636';
const REPO: RepoInfo = { owner: 'test-owner', repo: 'test-repo' };

interface CronCtx {
  issueNumber: number;
  stage: string;
  adwId: string | null;
  lastActivityMs: number;
  filterResult: FilterResult | null;
}

interface TakeoverCtx {
  issueNumber: number;
  stage: string;
  branchName: string | undefined;
  pid: number | undefined;
  isLive: boolean;
  decision: CandidateDecision | null;
  killCalls: number[];
  resetCalls: number;
  reconcileCalls: number;
  releaseCalls: number;
}

const cronCtx: CronCtx = {
  issueNumber: 0,
  stage: '',
  adwId: FIXED_ADW_ID,
  lastActivityMs: 0,
  filterResult: null,
};

const takeoverCtx: TakeoverCtx = {
  issueNumber: 0,
  stage: '',
  branchName: undefined,
  pid: undefined,
  isLive: false,
  decision: null,
  killCalls: [],
  resetCalls: 0,
  reconcileCalls: 0,
  releaseCalls: 0,
};

// ---------------------------------------------------------------------------
// Cron Given steps
// ---------------------------------------------------------------------------

Given(
  'a backlog issue {int} idle past the cron grace period whose latest ADW run is recorded at stage {string}',
  function (issueNumber: number, stage: string) {
    cronCtx.issueNumber = issueNumber;
    cronCtx.stage = stage;
    cronCtx.adwId = FIXED_ADW_ID;
    // lastActivityMs set well before now so "idle past grace period" holds
    cronCtx.lastActivityMs = Date.now() - 200_000;
    cronCtx.filterResult = null;
  },
);

Given(
  'a backlog issue {int} recorded at stage "awaiting_merge" with no ADW run id in its issue comments',
  function (issueNumber: number) {
    cronCtx.issueNumber = issueNumber;
    cronCtx.stage = 'awaiting_merge';
    cronCtx.adwId = null;
    cronCtx.lastActivityMs = Date.now() - 200_000;
    cronCtx.filterResult = null;
  },
);

// ---------------------------------------------------------------------------
// Takeover Given steps
// ---------------------------------------------------------------------------

Given(
  'a takeover candidate for issue {int} whose stalled ADW run is recorded at stage {string} on branch {string} with a dead owning process',
  function (issueNumber: number, stage: string, branchName: string) {
    takeoverCtx.issueNumber = issueNumber;
    takeoverCtx.stage = stage;
    takeoverCtx.branchName = branchName;
    takeoverCtx.pid = 99999;
    takeoverCtx.isLive = false;
    takeoverCtx.decision = null;
    takeoverCtx.killCalls = [];
    takeoverCtx.resetCalls = 0;
    takeoverCtx.reconcileCalls = 0;
    takeoverCtx.releaseCalls = 0;
  },
);

Given(
  'a takeover candidate for issue {int} whose stalled ADW run is recorded at stage {string} on branch {string} with a live owning process that does not hold the spawn lock',
  function (issueNumber: number, stage: string, branchName: string) {
    takeoverCtx.issueNumber = issueNumber;
    takeoverCtx.stage = stage;
    takeoverCtx.branchName = branchName;
    takeoverCtx.pid = 55555;
    takeoverCtx.isLive = true;
    takeoverCtx.decision = null;
    takeoverCtx.killCalls = [];
    takeoverCtx.resetCalls = 0;
    takeoverCtx.reconcileCalls = 0;
    takeoverCtx.releaseCalls = 0;
  },
);

Given(
  'a takeover candidate for issue {int} whose recorded ADW run is at stage "abandoned" on branch {string}',
  function (issueNumber: number, branchName: string) {
    takeoverCtx.issueNumber = issueNumber;
    takeoverCtx.stage = 'abandoned';
    takeoverCtx.branchName = branchName;
    takeoverCtx.pid = undefined;
    takeoverCtx.isLive = false;
    takeoverCtx.decision = null;
    takeoverCtx.killCalls = [];
    takeoverCtx.resetCalls = 0;
    takeoverCtx.reconcileCalls = 0;
    takeoverCtx.releaseCalls = 0;
  },
);

Given(
  'a takeover candidate for issue {int} whose recorded ADW run is at stage {string}',
  function (issueNumber: number, stage: string) {
    takeoverCtx.issueNumber = issueNumber;
    takeoverCtx.stage = stage;
    takeoverCtx.branchName = undefined;
    takeoverCtx.pid = undefined;
    takeoverCtx.isLive = false;
    takeoverCtx.decision = null;
    takeoverCtx.killCalls = [];
    takeoverCtx.resetCalls = 0;
    takeoverCtx.reconcileCalls = 0;
    takeoverCtx.releaseCalls = 0;
  },
);

// ---------------------------------------------------------------------------
// When steps
// ---------------------------------------------------------------------------

When('the cron backlog filter evaluates the issue', function () {
  const issue: CronIssue = {
    number: cronCtx.issueNumber,
    comments: [],
    createdAt: new Date(cronCtx.lastActivityMs - 10_000).toISOString(),
    updatedAt: new Date(cronCtx.lastActivityMs).toISOString(),
    labels: [],
  };

  const resolveStage = (_: { body: string }[]) => ({
    stage: cronCtx.stage,
    adwId: cronCtx.adwId,
    lastActivityMs: cronCtx.lastActivityMs,
  });

  const gracePeriodMs = 60_000; // 1 minute; lastActivityMs is ~200s ago so we're past it
  const now = Date.now();

  cronCtx.filterResult = evaluateIssue(
    issue,
    now,
    { spawns: new Set() },
    gracePeriodMs,
    resolveStage,
  );
});

When('the takeover handler evaluates the candidate', function () {
  const state: AgentState = {
    adwId: FIXED_ADW_ID,
    issueNumber: takeoverCtx.issueNumber,
    agentName: 'orchestrator',
    execution: { status: 'running', startedAt: '2026-01-01T00:00:00Z' },
    workflowStage: takeoverCtx.stage as WorkflowStage,
    branchName: takeoverCtx.branchName,
    pid: takeoverCtx.pid,
    pidStartedAt: takeoverCtx.pid !== undefined ? 'test-start-era' : undefined,
  };

  const isLive = takeoverCtx.isLive;
  const kills: number[] = takeoverCtx.killCalls;
  let resets = 0;
  let reconciles = 0;
  let releases = 0;

  const deps: TakeoverDeps = {
    acquireIssueSpawnLock: () => true,
    releaseIssueSpawnLock: () => { releases++; },
    readSpawnLockRecord: () => null,
    resolveAdwId: () => FIXED_ADW_ID,
    readTopLevelState: () => state,
    isProcessLive: () => isLive,
    killProcess: (pid) => { kills.push(pid); },
    resetWorktree: () => { resets++; },
    deriveStageFromRemote: () => { reconciles++; return 'abandoned' as WorkflowStage; },
    getWorktreePath: (branch) => `/worktrees/${branch}`,
    writeTopLevelState: () => undefined,
    commentOnIssue: () => undefined,
  };

  takeoverCtx.decision = evaluateCandidate(
    { issueNumber: takeoverCtx.issueNumber, repoInfo: REPO },
    deps,
  );
  takeoverCtx.resetCalls = resets;
  takeoverCtx.reconcileCalls = reconciles;
  takeoverCtx.releaseCalls = releases;
});

// ---------------------------------------------------------------------------
// Cron Then steps
// ---------------------------------------------------------------------------

Then('the cron backlog filter excludes the issue from the sweep', function () {
  assert.ok(cronCtx.filterResult !== null, 'Expected filterResult to be set');
  assert.strictEqual(
    cronCtx.filterResult.eligible,
    false,
    `Expected eligible:false but got eligible:${cronCtx.filterResult.eligible} (reason: ${cronCtx.filterResult.reason})`,
  );
});

Then(
  'the cron backlog filter marks the issue eligible to dispatch a merge for the recorded ADW run',
  function () {
    assert.ok(cronCtx.filterResult !== null, 'Expected filterResult to be set');
    assert.strictEqual(cronCtx.filterResult.eligible, true, 'Expected eligible:true for merge');
    assert.strictEqual(cronCtx.filterResult.action, 'merge', 'Expected action:merge');
    assert.strictEqual(
      cronCtx.filterResult.adwId,
      FIXED_ADW_ID,
      `Expected adwId to be '${FIXED_ADW_ID}'`,
    );
  },
);

Then(
  'the cron backlog filter marks the issue eligible to re-spawn the recorded ADW run',
  function () {
    assert.ok(cronCtx.filterResult !== null, 'Expected filterResult to be set');
    assert.strictEqual(cronCtx.filterResult.eligible, true, 'Expected eligible:true for re-spawn');
    assert.strictEqual(cronCtx.filterResult.action, 'spawn', 'Expected action:spawn');
  },
);

// ---------------------------------------------------------------------------
// Takeover Then steps
// ---------------------------------------------------------------------------

Then('the takeover handler takes over the recorded ADW run', function () {
  assert.ok(takeoverCtx.decision !== null, 'Expected decision to be set');
  assert.strictEqual(
    takeoverCtx.decision.kind,
    'take_over_adwId',
    `Expected take_over_adwId but got '${takeoverCtx.decision.kind}'`,
  );
});

Then(
  'the takeover handler resets the worktree and reconciles from the remote before taking over',
  function () {
    assert.ok(takeoverCtx.resetCalls >= 1, 'Expected resetWorktree to have been called');
    assert.ok(takeoverCtx.reconcileCalls >= 1, 'Expected deriveStageFromRemote to have been called');
  },
);

Then('the takeover handler signals no owning process to die', function () {
  assert.strictEqual(
    takeoverCtx.killCalls.length,
    0,
    `Expected no killProcess calls but got ${takeoverCtx.killCalls.length}`,
  );
});

Then('the takeover handler signals the stale owning process to die', function () {
  assert.ok(
    takeoverCtx.killCalls.length >= 1,
    'Expected killProcess to have been called at least once',
  );
});

Then('the takeover handler spawns a fresh workflow', function () {
  assert.ok(takeoverCtx.decision !== null, 'Expected decision to be set');
  assert.strictEqual(
    takeoverCtx.decision.kind,
    'spawn_fresh',
    `Expected spawn_fresh but got '${takeoverCtx.decision.kind}'`,
  );
});

Then('the takeover handler stands down and releases the spawn lock', function () {
  assert.ok(takeoverCtx.decision !== null, 'Expected decision to be set');
  assert.strictEqual(
    takeoverCtx.decision.kind,
    'skip_terminal',
    `Expected skip_terminal but got '${takeoverCtx.decision.kind}'`,
  );
  assert.ok(takeoverCtx.releaseCalls >= 1, 'Expected releaseIssueSpawnLock to have been called');
});

Then('the takeover handler performs no worktree reset or remote reconcile', function () {
  assert.strictEqual(
    takeoverCtx.resetCalls,
    0,
    `Expected no resetWorktree calls but got ${takeoverCtx.resetCalls}`,
  );
  assert.strictEqual(
    takeoverCtx.reconcileCalls,
    0,
    `Expected no deriveStageFromRemote calls but got ${takeoverCtx.reconcileCalls}`,
  );
});
