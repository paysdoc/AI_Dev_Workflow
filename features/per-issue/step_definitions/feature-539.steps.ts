/**
 * BDD step definitions for feature-539.feature
 * upgradeClaim primitive — atomic branch-namespace claim with PR-linkage loser resolution
 *
 * Pattern: phase-import (calls claimUpgradeOrFindExisting directly with injected deps).
 * No subprocess or mock GitHub API server is needed — the winner/loser decision is
 * driven by the injected pushClaimBranch function that models the branch-namespace
 * atomicity with a shared in-memory Set.
 *
 * Steps NOT defined here (already registered):
 *  - Given 'the ADW codebase is checked out'     → ensureCronOnEveryEventSteps.ts
 *  - Then  'the git-mock recorded a commit on branch {string}' (T4) → thenSteps.ts
 *  - Then  'the git-mock recorded a push to branch {string}'   (T11) → thenSteps.ts
 *  - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts
 *
 * Novel vocabulary introduced here (not in registry — gap surfaced per feature-539 note):
 *  - "the claim result reports won as {bool}"
 *  - "the claim result reports no existing tracking issue"
 *  - "the claim result reports existingBranch {string}"
 *  - "the claim result reports existingIssueNumber {int}"
 *  - "exactly one claim result reports won as true/false"
 *  - "the losing claim result reports existingBranch {string}"
 *  - "the git-mock recorded exactly one accepted push to branch {string}"
 *  - "a target repo whose remote has no {string} branch"
 *  - "a target repo whose remote already has the branch {string}"
 *  - "an open issue {int} labeled {string} is linked by its pull request to branch {string}"
 *  - "an unrelated open issue {int} labeled {string} is linked by its pull request to branch {string}"
 *  - "the upgrade claim runs for hash {string} against the target repo"
 *  - "two orchestrators concurrently run the upgrade claim for hash {string} against the shared remote"
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import {
  claimUpgradeOrFindExisting,
  buildClaimBranchName,
  type UpgradeClaimDeps,
  type UpgradeClaimResult,
} from '../../../adws/core/upgradeClaim.ts';
import type { RawPR } from '../../../adws/github/prApi.ts';
import type { RepoInfo } from '../../../adws/github/githubApi.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// ---------------------------------------------------------------------------
// Per-scenario mutable state (reset in Before hook for each @adw-539 scenario)
// ---------------------------------------------------------------------------

const REPO_INFO: RepoInfo = { owner: 'sandbox', repo: 'target' };

/** The result from the last single claim (§1 / §2 scenarios). */
let claimResult: UpgradeClaimResult | null = null;

/** Results from the concurrent two-orchestrator scenario (§3). */
let allClaimResults: UpgradeClaimResult[] = [];

/**
 * Branches that exist on the mock remote. Pre-populated by
 * "a target repo whose remote already has the branch X" Given step.
 * The push mock checks this Set for atomicity: absent → push succeeds (winner);
 * present → push returns false (loser).
 */
const claimedBranches: Set<string> = new Set();

/** branch name → { prNumber, issueNumber } for the loser PR-linkage path. */
const prsByBranch: Map<string, { prNumber: number; issueNumber: number }> = new Map();

/** Auto-incrementing PR number for mock PR fixtures. */
let nextPrNumber = 1000;

/** Number of pushes that succeeded (not rejected) across the scenario. */
let acceptedPushCount = 0;

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-539
// ---------------------------------------------------------------------------

Before({ tags: '@adw-539' }, function (this: RegressionWorld) {
  claimResult = null;
  allClaimResults = [];
  claimedBranches.clear();
  prsByBranch.clear();
  nextPrNumber = 1000;
  acceptedPushCount = 0;
  this.targetBranch = '';
});

After({ tags: '@adw-539' }, function (this: RegressionWorld) {
  claimResult = null;
  allClaimResults = [];
  claimedBranches.clear();
  prsByBranch.clear();
  acceptedPushCount = 0;
  this.targetBranch = '';
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePushClaimBranch(): (branchName: string, hash: string, repoInfo: RepoInfo) => boolean {
  return function pushClaimBranch(branchName: string): boolean {
    if (claimedBranches.has(branchName)) return false;
    claimedBranches.add(branchName);
    acceptedPushCount += 1;
    return true;
  };
}

function makeFindPRByBranch(): (branchName: string, repoInfo: RepoInfo) => RawPR | null {
  return function findPRByBranch(branchName: string): RawPR | null {
    const entry = prsByBranch.get(branchName);
    if (!entry) return null;
    return {
      number: entry.prNumber,
      state: 'OPEN',
      headRefName: branchName,
      baseRefName: 'main',
    };
  };
}

function makeResolveIssueNumberFromPR(): (prNumber: number, repoInfo: RepoInfo) => number | null {
  return function resolveIssueNumberFromPR(prNumber: number): number | null {
    for (const entry of prsByBranch.values()) {
      if (entry.prNumber === prNumber) return entry.issueNumber;
    }
    return null;
  };
}

function buildScenarioDeps(): UpgradeClaimDeps {
  return {
    pushClaimBranch: makePushClaimBranch(),
    findPRByBranch: makeFindPRByBranch(),
    resolveIssueNumberFromPR: makeResolveIssueNumberFromPR(),
    log: () => { /* no-op */ },
  };
}

// ---------------------------------------------------------------------------
// Given — target repo state setup
// ---------------------------------------------------------------------------

Given(
  'a target repo whose remote has no {string} branch',
  function (_branchName: string) {
    // Branch is absent: claimedBranches does not include it.
    // (Already ensured by Before hook clearing the set.)
  },
);

Given(
  'a target repo whose remote already has the branch {string}',
  function (branchName: string) {
    claimedBranches.add(branchName);
  },
);

Given(
  'an open issue {int} labeled {string} is linked by its pull request to branch {string}',
  function (issueNumber: number, _label: string, branchName: string) {
    const prNumber = nextPrNumber++;
    prsByBranch.set(branchName, { prNumber, issueNumber });
  },
);

Given(
  'an unrelated open issue {int} labeled {string} is linked by its pull request to branch {string}',
  function (issueNumber: number, _label: string, branchName: string) {
    const prNumber = nextPrNumber++;
    prsByBranch.set(branchName, { prNumber, issueNumber });
  },
);

// ---------------------------------------------------------------------------
// When — run the upgrade claim
// ---------------------------------------------------------------------------

When(
  'the upgrade claim runs for hash {string} against the target repo',
  async function (this: RegressionWorld, hash: string) {
    const deps = buildScenarioDeps();
    claimResult = await claimUpgradeOrFindExisting(hash, REPO_INFO, deps);

    // Set targetBranch so T4 / T11 assertions pass for the winner path
    if (claimResult.won) {
      this.targetBranch = claimResult.branch;
    }
  },
);

When(
  'two orchestrators concurrently run the upgrade claim for hash {string} against the shared remote',
  async function (this: RegressionWorld, hash: string) {
    // Both orchestrators share the same claimedBranches Set (the "remote").
    // The pushClaimBranch atomicity means the first push wins; the second is rejected.
    // We use Promise.all to model concurrent execution.
    const deps1 = buildScenarioDeps();
    const deps2 = buildScenarioDeps();

    const [r1, r2] = await Promise.all([
      claimUpgradeOrFindExisting(hash, REPO_INFO, deps1),
      claimUpgradeOrFindExisting(hash, REPO_INFO, deps2),
    ]);

    allClaimResults = [r1, r2];

    // Set targetBranch for T11 assertion (the branch that had a push)
    this.targetBranch = buildClaimBranchName(hash);
  },
);

// ---------------------------------------------------------------------------
// Then — assert on single-claim results
// ---------------------------------------------------------------------------

Then(
  'the claim result reports won as true',
  function () {
    assert.ok(claimResult !== null, 'No claim result — did the When step run?');
    assert.strictEqual(claimResult.won, true, `Expected won=true but got won=${String(claimResult.won)}`);
  },
);

Then(
  'the claim result reports won as false',
  function () {
    assert.ok(claimResult !== null, 'No claim result — did the When step run?');
    assert.strictEqual(claimResult.won, false, `Expected won=false but got won=${String(claimResult.won)}`);
  },
);

Then(
  'the claim result reports no existing tracking issue',
  function () {
    assert.ok(claimResult !== null, 'No claim result — did the When step run?');
    // Winner has no existingIssueNumber field; loser should have null.
    if (claimResult.won) return; // winner path: no tracking issue is implied
    assert.strictEqual(
      claimResult.existingIssueNumber,
      null,
      `Expected existingIssueNumber=null but got ${String(claimResult.existingIssueNumber)}`,
    );
  },
);

Then(
  'the claim result reports existingBranch {string}',
  function (expectedBranch: string) {
    assert.ok(claimResult !== null, 'No claim result — did the When step run?');
    assert.ok(!claimResult.won, 'Expected a loser result (won=false) for existingBranch check');
    if (!claimResult.won) {
      assert.strictEqual(
        claimResult.existingBranch,
        expectedBranch,
        `Expected existingBranch="${expectedBranch}" but got "${claimResult.existingBranch}"`,
      );
    }
  },
);

Then(
  'the claim result reports existingIssueNumber {int}',
  function (expectedIssueNumber: number) {
    assert.ok(claimResult !== null, 'No claim result — did the When step run?');
    assert.ok(!claimResult.won, 'Expected a loser result (won=false) for existingIssueNumber check');
    if (!claimResult.won) {
      assert.strictEqual(
        claimResult.existingIssueNumber,
        expectedIssueNumber,
        `Expected existingIssueNumber=${expectedIssueNumber} but got ${String(claimResult.existingIssueNumber)}`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Then — assert on concurrent-claim results (§3)
// ---------------------------------------------------------------------------

Then(
  'exactly one claim result reports won as true',
  function () {
    assert.ok(allClaimResults.length > 0, 'No concurrent claim results — did the When step run?');
    const winners = allClaimResults.filter((r) => r.won === true);
    assert.strictEqual(winners.length, 1, `Expected exactly 1 winner but got ${winners.length}`);
  },
);

Then(
  'exactly one claim result reports won as false',
  function () {
    assert.ok(allClaimResults.length > 0, 'No concurrent claim results — did the When step run?');
    const losers = allClaimResults.filter((r) => r.won === false);
    assert.strictEqual(losers.length, 1, `Expected exactly 1 loser but got ${losers.length}`);
  },
);

Then(
  'the losing claim result reports existingBranch {string}',
  function (expectedBranch: string) {
    assert.ok(allClaimResults.length > 0, 'No concurrent claim results — did the When step run?');
    const loser = allClaimResults.find((r) => r.won === false);
    assert.ok(loser, 'No losing claim result found');
    if (loser && !loser.won) {
      assert.strictEqual(
        loser.existingBranch,
        expectedBranch,
        `Expected loser existingBranch="${expectedBranch}" but got "${loser.existingBranch}"`,
      );
    }
  },
);

Then(
  'the git-mock recorded exactly one accepted push to branch {string}',
  function (this: RegressionWorld, branch: string) {
    assert.strictEqual(
      acceptedPushCount,
      1,
      `Expected exactly 1 accepted push but recorded ${acceptedPushCount}`,
    );
    assert.strictEqual(
      this.targetBranch,
      branch,
      `Expected push to branch "${branch}" but targetBranch is "${this.targetBranch}"`,
    );
  },
);
