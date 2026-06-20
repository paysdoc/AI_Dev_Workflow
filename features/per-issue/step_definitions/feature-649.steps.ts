/**
 * BDD step definitions for feature-649.feature
 *
 * Serialize issues that edit overlapping code regions instead of spawning
 * them in parallel.
 *
 * §1  Calls the pure pathsOverlap decision over two comma-separated path sets.
 * §2–§5 Build in-memory CronIssue fixtures and drive filterEligibleIssues with
 *        an injected resolveTouchedFiles resolver; assert eligible/deferred partition.
 * §6  Drives scanPostPlanOverlaps with injected in-flight issue data.
 * §7  Delegates to the shared T22 type-check step (feature-504.steps.ts).
 *
 * Steps NOT defined here (already registered):
 *   Given 'the ADW codebase is checked out'       → ensureCronOnEveryEventSteps.ts (G18)
 *   Then  'the ADW TypeScript type-check passes'  → feature-504.steps.ts (T22)
 */

import { Before, After, When, Given, Then } from '@cucumber/cucumber';
import assert from 'assert';
import {
  pathsOverlap,
  scanPostPlanOverlaps,
} from '../../../adws/triggers/regionOverlap.ts';
import {
  filterEligibleIssues,
} from '../../../adws/triggers/cronIssueFilter.ts';
import type { CronIssue, EligibleIssue, OverlapDeferral } from '../../../adws/triggers/cronIssueFilter.ts';
import type { OrderingRecommendation } from '../../../adws/triggers/regionOverlap.ts';
import { registerRegionOverlapBlocker } from '../../../adws/triggers/regionOverlapSignals.ts';
import { parseDependencies } from '../../../adws/triggers/issueDependencies.ts';
import type { RepoInfo } from '../../../adws/github/githubApi.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// ---------------------------------------------------------------------------
// Module-level scenario state (reset in Before/After hooks)
// ---------------------------------------------------------------------------

const OLD_DATE = new Date('2024-01-01T00:00:00Z').toISOString();
const NOW = new Date('2025-06-01T12:00:00Z').getTime();
const GRACE_PERIOD_MS = 60_000;

interface EvalResult {
  eligible: EligibleIssue[];
  overlapDeferrals: OverlapDeferral[];
}

const ctx: {
  // §1 pure-decision state
  overlapVerdict: boolean | null;

  // §2–§5 backlog router state
  cronIssues: Map<number, CronIssue>;
  issueTouchedFiles: Map<number, string[]>;
  firstEval: EvalResult | null;
  secondEval: EvalResult | null;

  // §3–§4 last "pair" seen — set by "exactly one of A and B" / "the other of A and B"
  lastPairA: number;
  lastPairB: number;
  lastEligibleOfPair: number | null;
  lastDeferredOfPair: number | null;

  // §6 post-plan scan state
  inFlightIssues: Array<{ issueNumber: number; relevantFiles: string[] }>;
  postPlanRecommendations: OrderingRecommendation[];

  // §9 durable registration state
  regDeferredNumber: number;
  regBodyInput: string;
  regBody: string | null;
  regComment: string | null;
} = {
  overlapVerdict: null,
  cronIssues: new Map(),
  issueTouchedFiles: new Map(),
  firstEval: null,
  secondEval: null,
  lastPairA: 0,
  lastPairB: 0,
  lastEligibleOfPair: null,
  lastDeferredOfPair: null,
  inFlightIssues: [],
  postPlanRecommendations: [],
  regDeferredNumber: 0,
  regBodyInput: '',
  regBody: null,
  regComment: null,
};

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-649
// ---------------------------------------------------------------------------

Before({ tags: '@adw-649' }, function (this: RegressionWorld) {
  ctx.overlapVerdict = null;
  ctx.cronIssues = new Map();
  ctx.issueTouchedFiles = new Map();
  ctx.firstEval = null;
  ctx.secondEval = null;
  ctx.lastPairA = 0;
  ctx.lastPairB = 0;
  ctx.lastEligibleOfPair = null;
  ctx.lastDeferredOfPair = null;
  ctx.inFlightIssues = [];
  ctx.postPlanRecommendations = [];
  ctx.regDeferredNumber = 0;
  ctx.regBodyInput = '';
  ctx.regBody = null;
  ctx.regComment = null;
});

After({ tags: '@adw-649' }, function (this: RegressionWorld) {
  ctx.cronIssues = new Map();
  ctx.issueTouchedFiles = new Map();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePaths(raw: string): string[] {
  return raw.split(',').map(p => p.trim()).filter(Boolean);
}

function makeEligibleCronIssue(number: number): CronIssue {
  return {
    number,
    comments: [], // no ADW stage comment → stage=null → eligible
    createdAt: OLD_DATE,
    updatedAt: OLD_DATE,
    labels: [],
  };
}

function runFilter(): EvalResult {
  const issues = [...ctx.cronIssues.values()];
  const result = filterEligibleIssues(
    issues,
    NOW,
    { spawns: new Set() },
    GRACE_PERIOD_MS,
    undefined,       // resolveStage: use default (no comments → stage=null → spawn-eligible)
    new Set(),       // cancelledThisCycle
    undefined,       // labelRecovery
    (issue: CronIssue) => ctx.issueTouchedFiles.get(issue.number) ?? [],
  );
  return { eligible: result.eligible, overlapDeferrals: result.overlapDeferrals };
}

// ---------------------------------------------------------------------------
// §1 — pure region-overlap decision
// ---------------------------------------------------------------------------

When(
  'the region-overlap decision is evaluated between issue {int} touching {string} and issue {int} touching {string}',
  function (_issueA: number, filesA: string, _issueB: number, filesB: string) {
    const pathsA = parsePaths(filesA);
    const pathsB = parsePaths(filesB);
    ctx.overlapVerdict = pathsOverlap(pathsA, pathsB).overlap;
  },
);

Then(
  'the region-overlap verdict is {string}',
  function (expected: string) {
    const expectedBool = expected === 'true';
    assert.strictEqual(
      ctx.overlapVerdict,
      expectedBool,
      `Expected region-overlap verdict to be ${expected} but got ${String(ctx.overlapVerdict)}`,
    );
  },
);

// ---------------------------------------------------------------------------
// §2–§5 — backlog router with injected touched-files resolver
// ---------------------------------------------------------------------------

Given(
  'a backlog issue {int} otherwise eligible to spawn, annotated with touched files {string}',
  function (issueNumber: number, touchedFiles: string) {
    const paths = parsePaths(touchedFiles);
    ctx.issueTouchedFiles.set(issueNumber, paths);
    ctx.cronIssues.set(issueNumber, makeEligibleCronIssue(issueNumber));
  },
);

When(
  'the issue router evaluates the backlog for overlapping-region collisions',
  function () {
    ctx.firstEval = runFilter();
  },
);

When(
  'the issue router re-evaluates the same backlog',
  function () {
    ctx.secondEval = runFilter();
  },
);

Then(
  'both issue {int} and issue {int} are eligible to spawn',
  function (issueA: number, issueB: number) {
    assert.ok(ctx.firstEval, 'Router has not been evaluated yet');
    const eligibleNumbers = new Set(ctx.firstEval.eligible.map(e => e.issue.number));
    assert.ok(
      eligibleNumbers.has(issueA),
      `Expected issue ${issueA} to be eligible but it was not. Eligible: [${[...eligibleNumbers].join(', ')}]`,
    );
    assert.ok(
      eligibleNumbers.has(issueB),
      `Expected issue ${issueB} to be eligible but it was not. Eligible: [${[...eligibleNumbers].join(', ')}]`,
    );
  },
);

Then(
  'issue {int} is eligible to spawn',
  function (issueNumber: number) {
    assert.ok(ctx.firstEval, 'Router has not been evaluated yet');
    const eligibleNumbers = new Set(ctx.firstEval.eligible.map(e => e.issue.number));
    assert.ok(
      eligibleNumbers.has(issueNumber),
      `Expected issue ${issueNumber} to be eligible but it was not. Eligible: [${[...eligibleNumbers].join(', ')}]`,
    );
  },
);

Then(
  'exactly one of issue {int} and issue {int} is eligible to spawn',
  function (issueA: number, issueB: number) {
    assert.ok(ctx.firstEval, 'Router has not been evaluated yet');
    const eligibleNumbers = new Set(ctx.firstEval.eligible.map(e => e.issue.number));
    const aEligible = eligibleNumbers.has(issueA);
    const bEligible = eligibleNumbers.has(issueB);

    assert.ok(
      aEligible !== bEligible,
      `Expected exactly one of issue ${issueA} and issue ${issueB} to be eligible, but got: ${issueA}=${aEligible}, ${issueB}=${bEligible}`,
    );

    ctx.lastPairA = issueA;
    ctx.lastPairB = issueB;
    ctx.lastEligibleOfPair = aEligible ? issueA : issueB;
    ctx.lastDeferredOfPair = aEligible ? issueB : issueA;
  },
);

Then(
  'the other of issue {int} and issue {int} is deferred behind the eligible one for an overlapping code region',
  function (issueA: number, issueB: number) {
    assert.ok(ctx.firstEval, 'Router has not been evaluated yet');
    const eligibleNumbers = new Set(ctx.firstEval.eligible.map(e => e.issue.number));

    // Determine which of the pair is deferred
    const aEligible = eligibleNumbers.has(issueA);
    const bEligible = eligibleNumbers.has(issueB);

    // Exactly one should be eligible (the "other" is the deferred one)
    assert.ok(
      aEligible !== bEligible,
      `Expected exactly one of issue ${issueA} and issue ${issueB} to be eligible (so the other can be deferred), but got: ${issueA}=${aEligible}, ${issueB}=${bEligible}`,
    );

    const deferredNumber = aEligible ? issueB : issueA;
    const eligibleNumber = aEligible ? issueA : issueB;

    // Record for subsequent steps
    ctx.lastPairA = issueA;
    ctx.lastPairB = issueB;
    ctx.lastEligibleOfPair = eligibleNumber;
    ctx.lastDeferredOfPair = deferredNumber;

    // Assert the deferred issue is in overlapDeferrals
    const deferral = ctx.firstEval.overlapDeferrals.find(d => d.issueNumber === deferredNumber);
    assert.ok(
      deferral !== undefined,
      `Expected issue ${deferredNumber} to be in overlapDeferrals but it was not. Deferrals: [${ctx.firstEval.overlapDeferrals.map(d => d.issueNumber).join(', ')}]`,
    );
  },
);

Then(
  'the deferral of the non-eligible issue names the eligible issue as the colliding one',
  function () {
    assert.ok(ctx.firstEval, 'Router has not been evaluated yet');
    assert.ok(
      ctx.lastDeferredOfPair !== null,
      'No pair context — run "exactly one of" or "the other of" step first',
    );
    assert.ok(
      ctx.lastEligibleOfPair !== null,
      'No eligible pair member recorded — run "the other of" step first',
    );

    const deferral = ctx.firstEval.overlapDeferrals.find(
      d => d.issueNumber === ctx.lastDeferredOfPair,
    );
    assert.ok(
      deferral !== undefined,
      `No deferral found for issue ${ctx.lastDeferredOfPair}`,
    );
    assert.strictEqual(
      deferral.blockedBy,
      ctx.lastEligibleOfPair,
      `Expected deferral of issue ${ctx.lastDeferredOfPair} to name issue ${ctx.lastEligibleOfPair} as blocker but got ${deferral.blockedBy}`,
    );
  },
);

Then(
  'the same issue remains deferred behind the same eligible issue',
  function () {
    assert.ok(ctx.firstEval, 'First evaluation has not been run yet');
    assert.ok(ctx.secondEval, 'Second evaluation has not been run yet — run "the issue router re-evaluates the same backlog"');

    const firstDeferrals = ctx.firstEval.overlapDeferrals;
    const secondDeferrals = ctx.secondEval.overlapDeferrals;

    assert.strictEqual(
      firstDeferrals.length,
      secondDeferrals.length,
      `Expected ${firstDeferrals.length} deferral(s) on re-evaluation but got ${secondDeferrals.length}`,
    );

    for (const first of firstDeferrals) {
      const second = secondDeferrals.find(d => d.issueNumber === first.issueNumber);
      assert.ok(
        second !== undefined,
        `Issue ${first.issueNumber} was deferred in the first evaluation but not the second`,
      );
      assert.strictEqual(
        second.blockedBy,
        first.blockedBy,
        `Issue ${first.issueNumber} deferred behind ${first.blockedBy} first time but behind ${second.blockedBy} second time`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// §8 — live-path regression scenarios (production default resolver)
// ---------------------------------------------------------------------------

function makeBodyIssue(number: number, touchedFiles: string): CronIssue {
  const bullets = parsePaths(touchedFiles).map(p => `- \`${p}\``).join('\n');
  return {
    number,
    body: `## Touched Files\n${bullets}\n`,
    comments: [],
    createdAt: OLD_DATE,
    updatedAt: OLD_DATE,
    labels: [],
  };
}

function runFilterLive(): EvalResult {
  const issues = [...ctx.cronIssues.values()];
  const result = filterEligibleIssues(issues, NOW, { spawns: new Set() }, GRACE_PERIOD_MS);
  return { eligible: result.eligible, overlapDeferrals: result.overlapDeferrals };
}

Given(
  'a backlog issue {int} whose body declares touched files {string}',
  function (issueNumber: number, touchedFiles: string) {
    ctx.cronIssues.set(issueNumber, makeBodyIssue(issueNumber, touchedFiles));
  },
);

When(
  'the issue router evaluates the backlog with the live touched-files resolver',
  function () {
    ctx.firstEval = runFilterLive();
  },
);

// ---------------------------------------------------------------------------
// §6 — post-planning overlap recommendation
// ---------------------------------------------------------------------------

Given(
  'an in-flight issue {int} whose plan declares relevant files {string}',
  function (issueNumber: number, relevantFiles: string) {
    const files = parsePaths(relevantFiles);
    ctx.inFlightIssues.push({ issueNumber, relevantFiles: files });
  },
);

When(
  'the post-planning overlap scan runs',
  function () {
    ctx.postPlanRecommendations = scanPostPlanOverlaps(ctx.inFlightIssues);
  },
);

Then(
  'an ordering recommendation is surfaced naming issues {int} and {int} as region-colliding',
  function (issueA: number, issueB: number) {
    const found = ctx.postPlanRecommendations.some(
      r =>
        (r.issueA === issueA && r.issueB === issueB) ||
        (r.issueA === issueB && r.issueB === issueA),
    );
    assert.ok(
      found,
      `Expected an ordering recommendation naming issues ${issueA} and ${issueB} as region-colliding but none was found. Recommendations: ${JSON.stringify(ctx.postPlanRecommendations)}`,
    );
  },
);

// ---------------------------------------------------------------------------
// §9 — durable registration + audit trail
// ---------------------------------------------------------------------------

Given(
  'a deferred issue {int} whose body has a "## Blocked by" section reading {string}',
  function (issueNumber: number, sectionText: string) {
    ctx.regDeferredNumber = issueNumber;
    ctx.regBodyInput = `## Blocked by\n${sectionText}\n\n## Notes\nplaceholder\n`;
  },
);

When(
  'ADW registers a region-overlap blocker behind issue {int} for overlapping path {string}',
  function (blockedBy: number, overlapPath: string) {
    const deferral: OverlapDeferral = {
      issueNumber: ctx.regDeferredNumber,
      blockedBy,
      overlapPaths: [overlapPath],
    };
    const repoInfo = { owner: 'o', repo: 'r' } as RepoInfo;
    registerRegionOverlapBlocker(deferral, ctx.regBodyInput, repoInfo, {
      updateIssueBody: (_n, body) => { ctx.regBody = body; },
      commentOnIssue: (_n, body) => { ctx.regComment = body; },
    });
  },
);

Then(
  "issue {int}'s updated body declares a dependency on issue {int} that the dependency parser detects",
  function (_deferred: number, blockedBy: number) {
    assert.ok(ctx.regBody, 'expected updateIssueBody to be called');
    assert.ok(
      ctx.regBody.includes(`#${blockedBy} <!-- adw:region-overlap -->`),
      `Expected body to contain annotated ref for #${blockedBy}`,
    );
    assert.ok(
      parseDependencies(ctx.regBody).includes(blockedBy),
      `Expected parseDependencies to resolve #${blockedBy} from the updated body`,
    );
  },
);

Then(
  'a one-time region-overlap comment naming issue {int} is posted on issue {int}',
  function (blockedBy: number, _deferred: number) {
    assert.ok(ctx.regComment, 'expected commentOnIssue to be called once');
    assert.ok(
      ctx.regComment.includes(`#${blockedBy}`),
      `Expected comment to name issue #${blockedBy}`,
    );
  },
);
