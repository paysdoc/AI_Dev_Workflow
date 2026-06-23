/**
 * BDD step definitions for feature-653.feature
 *
 * §1–§4 drive evaluateIssue and filterEligibleIssues (cronIssueFilter) with a
 *        NON-EMPTY in-memory spawn-dedup set (processedSpawns), asserting that
 *        recoverable stages (abandoned, phase_timeout) remain eligible for
 *        takeover while fresh-stage and active-stage issues stay excluded.
 * §5    delegates to the shared T22 type-check step (feature-504.steps.ts).
 *
 * Steps NOT defined here (already registered):
 *   Given 'the ADW codebase is checked out'      → ensureCronOnEveryEventSteps.ts (G18)
 *   Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts (T22)
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { evaluateIssue, filterEligibleIssues } from '../../../adws/triggers/cronIssueFilter.ts';
import type { CronIssue, EligibleIssue, FilterResult } from '../../../adws/triggers/cronIssueFilter.ts';
import type { StageResolution } from '../../../adws/triggers/cronStageResolver.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OLD_DATE = new Date('2024-01-01T00:00:00Z').toISOString();
const GRACE_PERIOD_MS = 60_000;
const FIXED_ADW_ID = 'adw-653-test';

// ---------------------------------------------------------------------------
// Module-level scenario state (reset in Before/After hooks)
// ---------------------------------------------------------------------------

interface Ctx653 {
  issueNumber: number;
  stage: string | null;
  adwId: string | null;
  lastActivityMs: number;
  filterResult: FilterResult | null;
  sweepResult: { eligible: EligibleIssue[]; filteredAnnotations: string[] } | null;
}

const ctx: Ctx653 = {
  issueNumber: 0,
  stage: null,
  adwId: null,
  lastActivityMs: 0,
  filterResult: null,
  sweepResult: null,
};

Before({ tags: '@adw-653' }, function () {
  ctx.issueNumber = 0;
  ctx.stage = null;
  ctx.adwId = null;
  ctx.lastActivityMs = 0;
  ctx.filterResult = null;
  ctx.sweepResult = null;
});

After({ tags: '@adw-653' }, function () {
  ctx.filterResult = null;
  ctx.sweepResult = null;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIssue(number: number, lastActivityMs: number): CronIssue {
  const updatedAt = new Date(lastActivityMs).toISOString();
  return {
    number,
    comments: [],
    createdAt: OLD_DATE,
    updatedAt,
    labels: [],
  };
}

function makeResolution(stage: string | null, adwId: string | null, lastActivityMs: number): StageResolution {
  return { stage, adwId, lastActivityMs };
}

// ---------------------------------------------------------------------------
// Given steps — set up an issue already in the cron's spawn-dedup set
// ---------------------------------------------------------------------------

Given(
  'a backlog issue {int} the live cron already spawned earlier this lifetime, now idle past the grace period with its latest ADW run recorded at stage {string}',
  function (issueNumber: number, stage: string) {
    ctx.issueNumber = issueNumber;
    ctx.stage = stage;
    ctx.adwId = FIXED_ADW_ID;
    ctx.lastActivityMs = Date.now() - 200_000;
    ctx.filterResult = null;
    ctx.sweepResult = null;
  },
);

Given(
  'a backlog issue {int} the live cron already spawned earlier this lifetime whose spawned run has not yet recorded any state, now idle past the grace period',
  function (issueNumber: number) {
    ctx.issueNumber = issueNumber;
    ctx.stage = null;
    ctx.adwId = null;
    ctx.lastActivityMs = Date.now() - 200_000;
    ctx.filterResult = null;
    ctx.sweepResult = null;
  },
);

// ---------------------------------------------------------------------------
// When steps
// ---------------------------------------------------------------------------

When('the cron backlog filter re-evaluates the issue against its in-memory spawn-dedup set', function () {
  const now = Date.now();
  const issue = makeIssue(ctx.issueNumber, ctx.lastActivityMs);
  const resolution = makeResolution(ctx.stage, ctx.adwId, ctx.lastActivityMs);
  const resolveStage = (_: { body: string }[]): StageResolution => resolution;

  ctx.filterResult = evaluateIssue(
    issue,
    now,
    { spawns: new Set([ctx.issueNumber]) },
    GRACE_PERIOD_MS,
    resolveStage,
  );
});

When('the cron runs its backlog sweep against its in-memory spawn-dedup set', function () {
  const now = Date.now();
  const issue = makeIssue(ctx.issueNumber, ctx.lastActivityMs);
  const resolution = makeResolution(ctx.stage, ctx.adwId, ctx.lastActivityMs);
  const resolveStage = (_: { body: string }[]): StageResolution => resolution;

  const result = filterEligibleIssues(
    [issue],
    now,
    { spawns: new Set([ctx.issueNumber]) },
    GRACE_PERIOD_MS,
    resolveStage,
  );

  ctx.sweepResult = { eligible: result.eligible, filteredAnnotations: result.filteredAnnotations };
});

// ---------------------------------------------------------------------------
// Then steps
// ---------------------------------------------------------------------------

Then('the cron backlog filter marks the issue eligible to re-spawn its recorded ADW run', function () {
  assert.ok(ctx.filterResult !== null, 'Expected filterResult to be set');
  assert.strictEqual(
    ctx.filterResult.eligible,
    true,
    `Expected eligible:true but got eligible:${ctx.filterResult.eligible} (reason: ${ctx.filterResult.reason})`,
  );
  assert.strictEqual(
    ctx.filterResult.action,
    'spawn',
    `Expected action:'spawn' but got action:'${ctx.filterResult.action}'`,
  );
  assert.strictEqual(
    ctx.filterResult.adwId,
    FIXED_ADW_ID,
    `Expected adwId:'${FIXED_ADW_ID}' but got adwId:'${ctx.filterResult.adwId}'`,
  );
});

Then('the cron backlog filter still excludes the issue from the sweep', function () {
  assert.ok(ctx.filterResult !== null, 'Expected filterResult to be set');
  assert.strictEqual(
    ctx.filterResult.eligible,
    false,
    `Expected eligible:false but got eligible:${ctx.filterResult.eligible}`,
  );
});

Then('the cron sweep makes the issue eligible to re-spawn rather than filtering it as already-processed', function () {
  assert.ok(ctx.sweepResult !== null, 'Expected sweepResult to be set');

  const eligibleNumbers = ctx.sweepResult.eligible.map(e => e.issue.number);
  assert.ok(
    eligibleNumbers.includes(ctx.issueNumber),
    `Expected issue #${ctx.issueNumber} to be in eligible list but got: [${eligibleNumbers.join(', ')}]`,
  );

  const eligibleEntry = ctx.sweepResult.eligible.find(e => e.issue.number === ctx.issueNumber);
  assert.strictEqual(
    eligibleEntry?.action,
    'spawn',
    `Expected action:'spawn' for issue #${ctx.issueNumber} but got action:'${eligibleEntry?.action}'`,
  );

  const processedAnnotation = `#${ctx.issueNumber}(processed)`;
  assert.ok(
    !ctx.sweepResult.filteredAnnotations.includes(processedAnnotation),
    `Expected issue #${ctx.issueNumber} NOT to appear as '${processedAnnotation}' in filteredAnnotations but found it: ${ctx.sweepResult.filteredAnnotations.join(', ')}`,
  );
});
