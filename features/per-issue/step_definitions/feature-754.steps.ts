/**
 * BDD step definitions for feature-754.feature
 * A fresh unlabeled cron candidate is spawn-eligible for downstream LLM
 * classification, not filtered as no_adw_label.
 *
 * Design
 * ------
 * Drives `evaluateLabelRecovery` (cronLabelEligibility.ts) directly with a
 * single seeded fresh issue and asserts the returned decision — the
 * pure-decision, in-process altitude the feature's rot-prevention note calls
 * for. No source file is read as text; every assertion targets the function's
 * return value.
 *
 * Steps reused from existing files (NOT redefined here):
 *   - Given 'the ADW codebase is checked out' → ensureCronOnEveryEventSteps.ts
 *
 * Phrasing here is deliberately distinct from feature-545.steps.ts's
 * issue-numbered "cron recovery scan" phrases (e.g. "the issue {int} carries
 * the labels {string}") so the two per-issue step-definition modules — both
 * loaded globally by cucumber — do not collide.
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { evaluateLabelRecovery } from '../../../adws/triggers/cronLabelEligibility.ts';
import type { LabelRecoveryResult, LabelRecoveryIssue } from '../../../adws/triggers/cronLabelEligibility.ts';
import type { LinkedPRRef } from '../../../adws/forge/linkedPrDetector.ts';

// ── Per-scenario state ─────────────────────────────────────────────────────────

const ADW_WORKFLOW_COMMENT = '## :rocket: ADW Workflow Started\n<!-- adw-bot -->';
const FRESH_ISSUE_NUMBER = 7540;

interface Ctx754 {
  labels: string[];
  comments: string[];
  hasLinkedMergedPR: boolean;
  hasLinkedClosedPR: boolean;
  result: LabelRecoveryResult | null;
}

const ctx: Ctx754 = {
  labels: [],
  comments: [],
  hasLinkedMergedPR: false,
  hasLinkedClosedPR: false,
  result: null,
};

function resetCtx(): void {
  ctx.labels = [];
  ctx.comments = [];
  ctx.hasLinkedMergedPR = false;
  ctx.hasLinkedClosedPR = false;
  ctx.result = null;
}

// ── Hooks ───────────────────────────────────────────────────────────────────────

Before({ tags: '@adw-754' }, function () {
  resetCtx();
});

After({ tags: '@adw-754' }, function () {
  resetCtx();
});

// ── Given: seed the fresh candidate's labels / comment / linked-PR state ────

Given('a fresh cron candidate issue carrying no adw:* label', function () {
  ctx.labels = [];
});

Given('a fresh cron candidate issue carrying the labels {string}', function (labelsCsv: string) {
  ctx.labels = labelsCsv.split(',').map((s) => s.trim()).filter(Boolean);
});

Given('the fresh issue has an in-progress ADW workflow comment', function () {
  ctx.comments = [ADW_WORKFLOW_COMMENT];
});

Given('the fresh issue has a linked merged pull request', function () {
  ctx.hasLinkedMergedPR = true;
});

Given('the fresh issue has a linked closed pull request', function () {
  ctx.hasLinkedClosedPR = true;
});

// ── When: evaluate the pure decision ─────────────────────────────────────────

function buildLinkedPrs(): LinkedPRRef[] {
  const prs: LinkedPRRef[] = [];
  if (ctx.hasLinkedMergedPR) {
    prs.push({
      number: 8000,
      body: `Implements #${FRESH_ISSUE_NUMBER}`,
      state: 'MERGED',
      mergedAt: '2024-01-01T00:00:00Z',
    });
  }
  if (ctx.hasLinkedClosedPR) {
    prs.push({
      number: 8001,
      body: `Implements #${FRESH_ISSUE_NUMBER}`,
      state: 'CLOSED',
      mergedAt: null,
    });
  }
  return prs;
}

When('its cron label eligibility is evaluated', function () {
  const issue: LabelRecoveryIssue = {
    number: FRESH_ISSUE_NUMBER,
    labels: ctx.labels.map((name) => ({ name })),
    comments: ctx.comments.map((body) => ({ body })),
  };
  ctx.result = evaluateLabelRecovery(issue, buildLinkedPrs());
});

// ── Then: assert the decision ─────────────────────────────────────────────────

Then('the fresh issue is eligible for spawn', function () {
  assert.ok(ctx.result, 'its cron label eligibility is evaluated was never run');
  assert.strictEqual(
    ctx.result!.eligible,
    true,
    `Expected the fresh issue to be eligible but got: ${JSON.stringify(ctx.result)}`,
  );
});

Then('the eligibility decision attaches no deterministic classification', function () {
  assert.ok(ctx.result, 'its cron label eligibility is evaluated was never run');
  assert.strictEqual(
    ctx.result!.classification,
    undefined,
    `Expected no deterministic classification but got: ${JSON.stringify(ctx.result)}`,
  );
});

Then('the fresh issue is not eligible, with reason {string}', function (expectedReason: string) {
  assert.ok(ctx.result, 'its cron label eligibility is evaluated was never run');
  assert.strictEqual(
    ctx.result!.eligible,
    false,
    `Expected the fresh issue to be ineligible but got: ${JSON.stringify(ctx.result)}`,
  );
  assert.strictEqual(
    ctx.result!.reason,
    expectedReason,
    `Expected reason "${expectedReason}" but got: ${JSON.stringify(ctx.result)}`,
  );
});

Then('the eligibility decision attaches the deterministic classification {string}', function (expectedClassification: string) {
  assert.ok(ctx.result, 'its cron label eligibility is evaluated was never run');
  assert.strictEqual(
    ctx.result!.classification,
    expectedClassification,
    `Expected classification "${expectedClassification}" but got: ${JSON.stringify(ctx.result)}`,
  );
});
