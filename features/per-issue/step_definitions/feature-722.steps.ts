/**
 * BDD step definitions for feature-722.feature
 *
 * Consolidate to one adwId per issue — `resolvePrReviewTarget` reuse/fresh/skip.
 *
 * §1  resolvePrReviewTarget routes by issue-link + existing adwId (pure resolver)
 * §2  Discovery matches cron; one adwId per issue
 * §3  TypeScript type-check backstop (handled by feature-504.steps.ts T22)
 *
 * Novel steps defined here:
 *   Given 'a pull request {int} that links issue {int} in its body'
 *   Given 'a pull request {int} that links issue {int} via its branch name'
 *   Given 'a pull request {int} that links no issue'
 *   Given "the issue's comments record adwId {string} as its latest ADW run"
 *   Given "the issue's comments record an earlier adwId {string} then a later adwId {string}"
 *   Given "the issue's comments record no ADW run"
 *   Given 'the adwId generator is primed to produce {string}'
 *   When  'the PR-review target is resolved for that pull request'
 *   Then  'the PR-review target reuses adwId {string} for issue {int}'
 *   Then  "the PR-review target reuses the same adwId cron resolves from the issue's comments"
 *   Then  'the PR-review target generates the fresh adwId {string} for issue {int}'
 *   Then  'the PR-review target skips the pull request as not issue-linked'
 *   Then  'the adwId generator was invoked once'
 *   Then  'the adwId generator was not invoked'
 *
 * Steps NOT defined here (already registered):
 *   - Given 'the ADW codebase is checked out'  → ensureCronOnEveryEventSteps.ts (G18)
 *   - Then  'the ADW TypeScript type-check passes'  → feature-504.steps.ts (T22)
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import {
  resolvePrReviewTarget,
  type PrReviewTarget,
  type PrReviewTargetInput,
} from '../../../adws/core/resolvePrReviewTarget.ts';
import { extractLatestAdwId } from '../../../adws/triggers/cronStageResolver.ts';

// ---------------------------------------------------------------------------
// Per-scenario mutable state (reset in Before / After hooks)
// ---------------------------------------------------------------------------

interface ScenarioState {
  pr: PrReviewTargetInput | null;
  seededComments: { body: string }[];
  primedAdwId: string;
  generateCallCount: number;
  lastResult: PrReviewTarget | null;
}

const state: ScenarioState = {
  pr: null,
  seededComments: [],
  primedAdwId: '',
  generateCallCount: 0,
  lastResult: null,
};

function makeAdwComment(adwId: string): { body: string } {
  return { body: `**ADW ID:** \`${adwId}\`` };
}

function reset(): void {
  state.pr = null;
  state.seededComments = [];
  state.primedAdwId = '';
  state.generateCallCount = 0;
  state.lastResult = null;
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-722
// ---------------------------------------------------------------------------

Before({ tags: '@adw-722' }, function () {
  reset();
});

After({ tags: '@adw-722' }, function () {
  reset();
});

// ---------------------------------------------------------------------------
// §1 / §2 — Given: build in-memory PR details
// ---------------------------------------------------------------------------

Given(
  'a pull request {int} that links issue {int} in its body',
  function (prNumber: number, issueNumber: number) {
    state.pr = { issueNumber, title: `PR #${prNumber} implementing issue #${issueNumber}` };
  },
);

Given(
  'a pull request {int} that links issue {int} via its branch name',
  function (prNumber: number, issueNumber: number) {
    state.pr = { issueNumber, title: `PR #${prNumber} for issue-${issueNumber}` };
  },
);

Given(
  'a pull request {int} that links no issue',
  function (prNumber: number) {
    state.pr = { issueNumber: null, title: `PR #${prNumber} (no linked issue)` };
  },
);

// ---------------------------------------------------------------------------
// §1 / §2 — Given: seed the injected issue-comment fetcher
// ---------------------------------------------------------------------------

Given(
  "the issue's comments record adwId {string} as its latest ADW run",
  function (adwId: string) {
    state.seededComments = [makeAdwComment(adwId)];
  },
);

Given(
  "the issue's comments record an earlier adwId {string} then a later adwId {string}",
  function (olderAdwId: string, newerAdwId: string) {
    state.seededComments = [makeAdwComment(olderAdwId), makeAdwComment(newerAdwId)];
  },
);

Given("the issue's comments record no ADW run", function () {
  state.seededComments = [];
});

// ---------------------------------------------------------------------------
// §1 / §2 — Given: prime the injected adwId generator spy
// ---------------------------------------------------------------------------

Given(
  'the adwId generator is primed to produce {string}',
  function (primedId: string) {
    state.primedAdwId = primedId;
    state.generateCallCount = 0;
  },
);

// ---------------------------------------------------------------------------
// §1 / §2 — When: call the pure resolver
// ---------------------------------------------------------------------------

When('the PR-review target is resolved for that pull request', function () {
  assert.ok(state.pr !== null, 'Expected a PR to be set via a Given step');
  const seenComments = state.seededComments;
  const primedId = state.primedAdwId;
  let callCount = 0;
  state.lastResult = resolvePrReviewTarget(state.pr, {
    fetchIssueComments: () => seenComments,
    generateAdwId: () => {
      callCount++;
      state.generateCallCount = callCount;
      return primedId;
    },
  });
});

// ---------------------------------------------------------------------------
// §1 / §2 — Then: assert resolver disposition
// ---------------------------------------------------------------------------

Then(
  'the PR-review target reuses adwId {string} for issue {int}',
  function (expectedAdwId: string, expectedIssueNumber: number) {
    assert.ok(state.lastResult !== null, 'Expected resolver result — run the When step first');
    assert.notStrictEqual(
      state.lastResult.kind,
      'skip',
      `Expected a reuse result but got skip (reason: ${state.lastResult.kind === 'skip' ? state.lastResult.reason : ''})`,
    );
    assert.strictEqual(
      state.lastResult.kind,
      'reuse',
      `Expected kind "reuse" but got "${state.lastResult.kind}"`,
    );
    if (state.lastResult.kind === 'reuse') {
      assert.strictEqual(
        state.lastResult.adwId,
        expectedAdwId,
        `Expected adwId "${expectedAdwId}" but got "${state.lastResult.adwId}"`,
      );
      assert.strictEqual(
        state.lastResult.issueNumber,
        expectedIssueNumber,
        `Expected issueNumber ${expectedIssueNumber} but got ${state.lastResult.issueNumber}`,
      );
    }
  },
);

Then(
  "the PR-review target reuses the same adwId cron resolves from the issue's comments",
  function () {
    assert.ok(state.lastResult !== null, 'Expected resolver result — run the When step first');
    assert.strictEqual(
      state.lastResult.kind,
      'reuse',
      `Expected kind "reuse" but got "${state.lastResult.kind}"`,
    );
    const cronResolved = extractLatestAdwId(state.seededComments);
    assert.ok(cronResolved !== null, 'Expected extractLatestAdwId to find an adwId in seeded comments');
    if (state.lastResult.kind === 'reuse') {
      assert.strictEqual(
        state.lastResult.adwId,
        cronResolved,
        `Expected resolver adwId "${state.lastResult.adwId}" to equal cron's "${cronResolved}"`,
      );
    }
  },
);

Then(
  'the PR-review target generates the fresh adwId {string} for issue {int}',
  function (expectedAdwId: string, expectedIssueNumber: number) {
    assert.ok(state.lastResult !== null, 'Expected resolver result — run the When step first');
    assert.strictEqual(
      state.lastResult.kind,
      'fresh',
      `Expected kind "fresh" but got "${state.lastResult.kind}"`,
    );
    if (state.lastResult.kind === 'fresh') {
      assert.strictEqual(
        state.lastResult.adwId,
        expectedAdwId,
        `Expected adwId "${expectedAdwId}" but got "${state.lastResult.adwId}"`,
      );
      assert.strictEqual(
        state.lastResult.issueNumber,
        expectedIssueNumber,
        `Expected issueNumber ${expectedIssueNumber} but got ${state.lastResult.issueNumber}`,
      );
    }
  },
);

Then('the PR-review target skips the pull request as not issue-linked', function () {
  assert.ok(state.lastResult !== null, 'Expected resolver result — run the When step first');
  assert.strictEqual(
    state.lastResult.kind,
    'skip',
    `Expected kind "skip" but got "${state.lastResult.kind}"`,
  );
});

Then('the adwId generator was invoked once', function () {
  assert.strictEqual(
    state.generateCallCount,
    1,
    `Expected generator to be called once but was called ${state.generateCallCount} time(s)`,
  );
});

Then('the adwId generator was not invoked', function () {
  assert.strictEqual(
    state.generateCallCount,
    0,
    `Expected generator to NOT be called but was called ${state.generateCallCount} time(s)`,
  );
});
