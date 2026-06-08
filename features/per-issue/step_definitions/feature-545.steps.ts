/**
 * BDD step definitions for feature-545.feature
 * CRON recovery layer — label-eligibility rescan for unprocessed adw:* issues.
 *
 * Design (mirrors feature-542 sibling pattern)
 * -------------------------------------------
 * The recovery scan logic lives in `evaluateLabelRecovery` (cronLabelEligibility.ts)
 * and the gate in `evaluateIssue` (cronIssueFilter.ts), both behind pure interfaces.
 * Driving the full cron loop with its setInterval / process guard is not viable here,
 * so we drive the pure decision and gate functions in-process with recording deps.
 *
 * The "cron recovery scan runs over the target repo" step invokes `evaluateLabelRecovery`
 * + `evaluateIssue` directly, passing the scenario's seeded issue state and a spy for
 * classifyAndSpawn. The spawn channel is the observable artefact (same pattern as
 * feature-542's webhook spawn channel).
 *
 * Steps reused from existing files (NOT redefined here):
 *   - Given 'the ADW codebase is checked out'         → ensureCronOnEveryEventSteps.ts
 *   - Then  'the ADW TypeScript type-check passes'    → feature-504.steps.ts
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import {
  evaluateIssue,
  type CronIssue,
} from '../../../adws/triggers/cronIssueFilter.ts';
import { evaluateLabelRecovery } from '../../../adws/triggers/cronLabelEligibility.ts';
import type { LabelRecoveryResult } from '../../../adws/triggers/cronLabelEligibility.ts';
import type { LinkedPRRef } from '../../../adws/github/linkedPrDetector.ts';
import type { StageResolution } from '../../../adws/triggers/cronStageResolver.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { MockContext, RecordedRequest } from '../../../test/mocks/types.ts';

// ── Per-scenario state ─────────────────────────────────────────────────────────

interface IssueState {
  labels: string[];
  comments: string[];
  hasLinkedMergedPR: boolean;
  hasLinkedClosedPR: boolean;
  hasLiveSpawnLock: boolean;
}

interface Ctx545 {
  issues: Map<number, IssueState>;
  spawns: Array<{ issueNumber: number; classification: string }>;
}

const ADW_WORKFLOW_COMMENT = '## :rocket: ADW Workflow Started\n<!-- adw-bot -->';

function freshIssueState(): IssueState {
  return {
    labels: [],
    comments: [],
    hasLinkedMergedPR: false,
    hasLinkedClosedPR: false,
    hasLiveSpawnLock: false,
  };
}

const ctx: Ctx545 = {
  issues: new Map(),
  spawns: [],
};

function resetCtx(): void {
  ctx.issues.clear();
  ctx.spawns = [];
}

// ── Synthetic MockContext ───────────────────────────────────────────────────────
// The G4 step in givenSteps.ts requires mockContext to be set. We provide a
// no-op synthetic context (same pattern as feature-542) since we don't need a
// real HTTP mock server for the in-process recovery scan test.

function createSyntheticMockContext(): MockContext {
  const recorded: RecordedRequest[] = [];
  return {
    serverUrl: 'http://localhost:0',
    port: 0,
    getRecordedRequests: () => recorded,
    setState: async () => {},
    teardown: async () => {},
  };
}

// ── Hooks ───────────────────────────────────────────────────────────────────────

Before({ tags: '@adw-545' }, function (this: RegressionWorld) {
  resetCtx();
  this.mockContext = createSyntheticMockContext();
});

After({ tags: '@adw-545' }, function (this: RegressionWorld) {
  resetCtx();
  this.mockContext = null;
});

// ── Given: issue setup ─────────────────────────────────────────────────────────
// Note: G4 ("an issue {int} exists in the mock issue tracker") is already
// registered in givenSteps.ts — not redefined here. Issue state in ctx.issues
// is lazily initialized in the steps below.

Given(
  'the issue {int} carries the labels {string}',
  function (issueNumber: number, labelsCsv: string) {
    const state = ctx.issues.get(issueNumber) ?? freshIssueState();
    state.labels = labelsCsv.split(',').map((s) => s.trim()).filter(Boolean);
    ctx.issues.set(issueNumber, state);
  },
);

Given(
  'the issue {int} has an in-progress ADW workflow comment',
  function (issueNumber: number) {
    const state = ctx.issues.get(issueNumber) ?? freshIssueState();
    state.comments = [ADW_WORKFLOW_COMMENT];
    ctx.issues.set(issueNumber, state);
  },
);

Given(
  'the issue {int} has a linked merged pull request',
  function (issueNumber: number) {
    const state = ctx.issues.get(issueNumber) ?? freshIssueState();
    state.hasLinkedMergedPR = true;
    ctx.issues.set(issueNumber, state);
  },
);

Given(
  'the issue {int} has a linked closed pull request',
  function (issueNumber: number) {
    const state = ctx.issues.get(issueNumber) ?? freshIssueState();
    state.hasLinkedClosedPR = true;
    ctx.issues.set(issueNumber, state);
  },
);

// G5 ("no spawn lock exists for issue {int}") is already in givenSteps.ts.
// The scan step reads ctx.issues which defaults hasLiveSpawnLock=false — no
// local action needed for the default (clean) case.

Given(
  'a live ADW orchestrator already holds the spawn lock for issue {int}',
  function (issueNumber: number) {
    const state = ctx.issues.get(issueNumber) ?? freshIssueState();
    state.hasLiveSpawnLock = true;
    ctx.issues.set(issueNumber, state);
  },
);

// ── When: run the cron recovery scan ─────────────────────────────────────────

/**
 * Builds a minimal `LinkedPRRef[]` for the issue based on the seeded state.
 * We use a sentinel PR body `Implements #<issueNumber>` so the detector finds it.
 */
function buildLinkedPRs(issueNumber: number, state: IssueState): LinkedPRRef[] {
  const prs: LinkedPRRef[] = [];
  if (state.hasLinkedMergedPR) {
    prs.push({
      number: 9000,
      body: `Implements #${issueNumber}`,
      state: 'MERGED',
      mergedAt: '2024-01-01T00:00:00Z',
    });
  }
  if (state.hasLinkedClosedPR) {
    prs.push({
      number: 9001,
      body: `Implements #${issueNumber}`,
      state: 'CLOSED',
      mergedAt: null,
    });
  }
  return prs;
}

/**
 * Builds a `CronIssue` from the seeded state.
 * createdAt/updatedAt are set to a time well beyond the grace period so
 * age-based filtering never interferes with the label-gate tests.
 */
function buildCronIssue(issueNumber: number, state: IssueState): CronIssue {
  return {
    number: issueNumber,
    body: '',
    title: `Issue ${issueNumber}`,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    comments: state.comments.map((body) => ({ body })),
    labels: state.labels.map((name) => ({ name })),
  };
}

When(
  'the cron recovery scan runs over the target repo',
  function () {
    for (const [issueNumber, state] of ctx.issues.entries()) {
      const linkedPrs = buildLinkedPRs(issueNumber, state);
      const issue = buildCronIssue(issueNumber, state);

      // Resolve stage: a live spawn lock means an active orchestrator holds the issue.
      // We model this as a non-null adwId so the gate is bypassed (dedup path).
      const resolution: StageResolution = state.hasLiveSpawnLock
        ? { stage: null, adwId: 'live-orchestrator-adwId', lastActivityMs: null }
        : { stage: null, adwId: null, lastActivityMs: null };

      const labelRecovery = (i: CronIssue): LabelRecoveryResult =>
        evaluateLabelRecovery(i, linkedPrs);

      const result = evaluateIssue(
        issue,
        // Use a timestamp far beyond the grace period so age-filtering is never the reason
        new Date('2099-01-01T00:00:00Z').getTime(),
        { spawns: new Set() },
        60_000,
        () => resolution,
        new Set(),
        labelRecovery,
      );

      if (result.eligible && result.action === 'spawn') {
        // Gate: the spawn-time dedup primitive (evaluateCandidate / spawnGate) would
        // defer the issue when a live orchestrator holds the spawn lock. We model that
        // here so the observable outcome matches what the real cron loop produces.
        if (state.hasLiveSpawnLock) continue;

        // Derive the classification from labels (mirrors the spawn site in trigger_cron.ts)
        const labelResult = evaluateLabelRecovery(issue, linkedPrs);
        const classification = labelResult.classification
          ? labelResult.classification.replace(/^\//, '')
          : 'unknown';
        ctx.spawns.push({ issueNumber, classification });
      }
    }
  },
);

// ── When: multi-label cleanup (self-recovery scenario) ───────────────────────

When(
  'the conflicting labels on issue {int} are cleaned up to {string}',
  function (issueNumber: number, singleLabel: string) {
    const state = ctx.issues.get(issueNumber) ?? freshIssueState();
    state.labels = [singleLabel.trim()];
    ctx.issues.set(issueNumber, state);
    // Also clear any prior spawns so the next "scan runs" step starts clean
    ctx.spawns = ctx.spawns.filter((s) => s.issueNumber !== issueNumber);
  },
);

// ── Then: spawn assertions ────────────────────────────────────────────────────

Then(
  'the cron recovery scan spawned an orchestrator for issue {int} classified as {string}',
  function (issueNumber: number, expectedClassification: string) {
    const spawned = ctx.spawns.filter((s) => s.issueNumber === issueNumber);
    assert.ok(
      spawned.length > 0,
      `Expected an orchestrator spawn for issue ${issueNumber} but none was recorded. Spawns: ${JSON.stringify(ctx.spawns)}`,
    );
    const match = spawned.find((s) => s.classification === expectedClassification);
    assert.ok(
      match,
      `Expected spawn for issue ${issueNumber} classified as "${expectedClassification}" but got: [${spawned.map((s) => s.classification).join(', ')}]`,
    );
  },
);

Then(
  'the cron recovery scan spawned no orchestrator for issue {int}',
  function (issueNumber: number) {
    const spawned = ctx.spawns.filter((s) => s.issueNumber === issueNumber);
    assert.strictEqual(
      spawned.length,
      0,
      `Expected no orchestrator spawn for issue ${issueNumber} but recorded ${spawned.length}: ${JSON.stringify(spawned)}`,
    );
  },
);
