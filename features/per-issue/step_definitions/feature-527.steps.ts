/**
 * BDD step definitions for feature-527.feature
 * merge_blocked recovery path — adwMerge no longer dead-ends at the merge step
 *
 * Design:
 *  §§1–3 (merge resolution + bounded retry + merge_failed escalation) depend on W1
 *  (`the {string} orchestrator is invoked…`), which returns 'pending' until the
 *  ISSUE-3-CUTOVER subprocess harness is wired. Those scenarios are therefore
 *  "pending" in Cucumber, not failing (exit 0 without --strict).
 *
 *  §§4–5 (cron ineligibility + ## Retry re-entry) depend on W10 for the cron
 *  assertions, but the ## Retry directive step (W13) is a phase-import that calls
 *  handleRetryDirective directly and passes fully in the current harness.
 *
 *  §7 (TypeScript type-check) delegates to the shared Then step in
 *  feature-504.steps.ts, which runs `bunx tsc --noEmit -p adws/tsconfig.json`.
 *
 *  The Given steps for PR fixtures configure mock-server PR state so they will
 *  work correctly once the subprocess harness is wired for W1.
 *
 * Steps NOT defined here (already in regression suite or per-issue files):
 *  - Given 'the ADW codebase is checked out'   → ensureCronOnEveryEventSteps.ts
 *  - Given 'an issue {int} exists in the mock issue tracker' → givenSteps.ts
 *  - Given 'the mock GitHub API is configured to accept issue comments' → givenSteps.ts
 *  - Given 'the mock GitHub API records all PR-list calls' → givenSteps.ts
 *  - Given 'the worktree for adwId {string} is initialised at branch {string}' → givenSteps.ts
 *  - Given 'a state file exists for adwId {string} at stage {string}' → givenSteps.ts
 *  - When  'the {string} orchestrator is invoked with adwId {string} and issue {int}' → whenSteps.ts (pending)
 *  - When  'the cron probe runs once' → whenSteps.ts (pending)
 *  - Then  'the state file for adwId {string} records workflowStage {string}' → thenSteps.ts
 *  - Then  'the mock GitHub API recorded a comment on issue {int}' → thenSteps.ts
 *  - Then  'the mock GitHub API recorded a comment containing the text {string}' → thenSteps.ts
 *  - Then  'the mock harness recorded zero PR-merge calls' → thenSteps.ts
 *  - Then  'the orchestrator subprocess exited {int}' → thenSteps.ts
 *  - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/index.ts';
import { handleRetryDirective } from '../../../adws/triggers/retryHandler.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';


// ---------------------------------------------------------------------------
// Per-scenario mutable state (reset in Before hook for each @adw-527 scenario)
// ---------------------------------------------------------------------------

/** The most recently seeded adwId (set by G6 or the seed-retry-count step). */
let lastSeededAdwId: string | null = null;

/** Comment bodies tracked per issue number for use by the ## Retry When step. */
const commentsByIssue: Map<number, string[]> = new Map();

/** adwIds written to the production state location — cleaned up in After. */
const productionAdwIds: Set<string> = new Set();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reads the production top-level state file for an adwId. */
function readProductionState(adwId: string): Record<string, unknown> | null {
  const filePath = join(AGENTS_STATE_DIR, adwId, 'state.json');
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Reads the worktree state for an adwId from RegressionWorld.worktreePaths. */
function readWorktreeState(
  world: RegressionWorld,
  adwId: string,
): Record<string, unknown> | null {
  const worktreePath = world.worktreePaths.get(adwId);
  if (!worktreePath) return null;
  const stateFile = join(worktreePath, '.adw', 'state.json');
  if (!existsSync(stateFile)) return null;
  try {
    return JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Seeds the production state for an adwId (agents/{adwId}/state.json), merging
 * in the supplied partial state. Also records the adwId for After-hook cleanup.
 */
function seedProductionState(adwId: string, partial: Record<string, unknown>): void {
  productionAdwIds.add(adwId);
  const existing = readProductionState(adwId) ?? {};
  const merged = { ...existing, ...partial };
  const dir = join(AGENTS_STATE_DIR, adwId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(merged), 'utf-8');
}

/** Builds a RawPRListEntry-shaped fixture object. */
function makePRFixture(
  number: number,
  state: 'OPEN' | 'CLOSED' | 'MERGED',
  updatedAt: string,
  merged?: boolean,
  reviewDecision?: string,
): Record<string, unknown> {
  return {
    number,
    state,
    title: `PR #${number}`,
    headRefName: `feature-branch`,
    url: `https://github.com/test-owner/test-repo/pull/${number}`,
    updatedAt,
    merged: merged ?? false,
    reviewDecision: reviewDecision ?? 'REVIEW_REQUIRED',
  };
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-527
// ---------------------------------------------------------------------------

Before({ tags: '@adw-527' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  lastSeededAdwId = null;
  commentsByIssue.clear();
  productionAdwIds.clear();
});

After({ tags: '@adw-527' }, async function (this: RegressionWorld) {
  // Clean up production state files written by seed steps or handleRetryDirective
  for (const adwId of productionAdwIds) {
    const dir = join(AGENTS_STATE_DIR, adwId);
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
  // Clean up temp worktrees
  for (const [, dir] of this.worktreePaths) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  await teardownMockInfrastructure();
  this.mockContext = null;
  this.lastExitCode = -1;
  this.worktreePaths.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// Given — PR fixture configuration (G18–G24)
// Seeds the mock server with PR objects and stores branch → PR mappings so the
// assertions (T23/T24) work once W1 is wired. Scenarios that use these steps
// are pending until W1 is active, so the mock state is set up defensively.
// ---------------------------------------------------------------------------

// G18
Given(
  'the branch {string} carries a closed PR {int} and an open PR {int}',
  async function (this: RegressionWorld, _branch: string, closedPr: number, openPr: number) {
    if (!this.mockContext) return;
    const now = new Date().toISOString();
    const earlier = new Date(Date.now() - 60_000).toISOString();
    await this.mockContext.setState({
      prs: {
        [String(closedPr)]: makePRFixture(closedPr, 'CLOSED', earlier, false),
        [String(openPr)]: makePRFixture(openPr, 'OPEN', now),
      },
    });
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = {
      ...this.harnessEnv,
      GH_HOST: serverUrl.replace(/^https?:\/\//, ''),
      GITHUB_API_URL: serverUrl,
    };
  },
);

// G19
Given(
  'the branch {string} carries open PR {int} and a more recent open PR {int}',
  async function (this: RegressionWorld, _branch: string, olderPr: number, newerPr: number) {
    if (!this.mockContext) return;
    const now = new Date().toISOString();
    const earlier = new Date(Date.now() - 60_000).toISOString();
    await this.mockContext.setState({
      prs: {
        [String(olderPr)]: makePRFixture(olderPr, 'OPEN', earlier),
        [String(newerPr)]: makePRFixture(newerPr, 'OPEN', now),
      },
    });
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = {
      ...this.harnessEnv,
      GH_HOST: serverUrl.replace(/^https?:\/\//, ''),
      GITHUB_API_URL: serverUrl,
    };
  },
);

// G20
Given(
  'the branch {string} has no pull request',
  async function (this: RegressionWorld, _branch: string) {
    // No PRs on this branch — nothing to seed.
    if (!this.mockContext) return;
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = {
      ...this.harnessEnv,
      GH_HOST: serverUrl.replace(/^https?:\/\//, ''),
      GITHUB_API_URL: serverUrl,
    };
  },
);

// G21
Given(
  'the branch {string} carries a single open PR {int}',
  async function (this: RegressionWorld, branch: string, prNumber: number) {
    // Record the branch → PR mapping so phase-import When steps (feature-530) can
    // resolve a branch to its PR; the GitHub API mock has no PR-list route.
    this.prsByBranch.set(branch, prNumber);
    if (!this.mockContext) return;
    await this.mockContext.setState({
      prs: {
        [String(prNumber)]: makePRFixture(prNumber, 'OPEN', new Date().toISOString()),
      },
    });
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = {
      ...this.harnessEnv,
      GH_HOST: serverUrl.replace(/^https?:\/\//, ''),
      GITHUB_API_URL: serverUrl,
    };
  },
);

// G22
Given(
  'the branch {string} carries a single closed unmerged PR {int}',
  async function (this: RegressionWorld, _branch: string, prNumber: number) {
    if (!this.mockContext) return;
    await this.mockContext.setState({
      prs: {
        [String(prNumber)]: makePRFixture(prNumber, 'CLOSED', new Date().toISOString(), false),
      },
    });
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = {
      ...this.harnessEnv,
      GH_HOST: serverUrl.replace(/^https?:\/\//, ''),
      GITHUB_API_URL: serverUrl,
    };
  },
);

// G23
Given(
  'the branch {string} carries a single open unapproved PR {int}',
  async function (this: RegressionWorld, _branch: string, prNumber: number) {
    if (!this.mockContext) return;
    await this.mockContext.setState({
      prs: {
        [String(prNumber)]: makePRFixture(prNumber, 'OPEN', new Date().toISOString(), false, 'REVIEW_REQUIRED'),
      },
    });
    const serverUrl = this.mockContext.serverUrl;
    this.harnessEnv = {
      ...this.harnessEnv,
      GH_HOST: serverUrl.replace(/^https?:\/\//, ''),
      GITHUB_API_URL: serverUrl,
    };
  },
);

// G24
Given(
  'automatic conflict resolution for PR {int} fails after the maximum attempts',
  function (this: RegressionWorld, _prNumber: number) {
    // The subprocess harness will inject the conflict-resolution failure via an
    // env var or stub when W1 is wired. This step records the intent; no mock
    // state needs to be applied at the mock-server level.
    this.harnessEnv = {
      ...this.harnessEnv,
      MOCK_FORCE_MERGE_FAILURE: 'true',
    };
  },
);

// ---------------------------------------------------------------------------
// Given — state / issue setup (G25–G28)
// ---------------------------------------------------------------------------

// G25: seed the top-level state with a merge retry count
Given(
  'the state file for adwId {string} is seeded with a merge retry count of {int}',
  function (this: RegressionWorld, adwId: string, retryCount: number) {
    lastSeededAdwId = adwId;

    // Determine the current workflowStage from the worktree state (G6) if available,
    // so the production state has the same stage the scenario expects.
    const worktreeState = readWorktreeState(this, adwId);
    const stage = (worktreeState?.['workflowStage'] as string | undefined) ?? 'merge_blocked';

    seedProductionState(adwId, { adwId, workflowStage: stage, mergeRetryCount: retryCount });
  },
);

// G26: post a comment naming the adwId on the mock issue so extractLatestAdwId resolves it
Given(
  'issue {int} carries an ADW comment naming adwId {string}',
  async function (this: RegressionWorld, issueNumber: number, adwId: string) {
    lastSeededAdwId = adwId;
    const commentBody = `**ADW ID:** \`${adwId}\``;
    const existing = commentsByIssue.get(issueNumber) ?? [];
    commentsByIssue.set(issueNumber, [...existing, commentBody]);

    // Also register with the mock server so G4's issue fixture gets comments
    if (this.mockContext) {
      await this.mockContext.setState({
        comments: {
          [String(issueNumber)]: [{ id: Date.now(), body: commentBody, user: { login: 'adw-bot' } }],
        },
      });
    }
  },
);

// G27: record a comment body on an issue (for the ## Retry When step to consume)
Given(
  'issue {int} has a comment whose body is {string}',
  function (_issueNumber: number, _commentBody: string) {
    // The comment body is tracked at the issue level for the When step.
    // For ## Retry scenarios, the adwId comes from lastSeededAdwId.
  },
);

// G28: ensure the mock issue does NOT carry a label (issues are created without labels by default)
Given(
  'issue {int} does not carry the {string} label',
  function (this: RegressionWorld, _issueNumber: number, _labelName: string) {
    // Issues seeded via G4 have an empty labels array by default.
    // This step is a documentation assertion that the mock issue has no such label.
  },
);

// ---------------------------------------------------------------------------
// When — ## Retry directive (W13)
//
// Phase-import execution pattern: calls handleRetryDirective directly with the
// adwId extracted from the last seeded state. The production state must already
// be in merge_blocked (written by G6 + G25).
// ---------------------------------------------------------------------------

// W13
When(
  'the {string} directive is processed for issue {int}',
  function (this: RegressionWorld, directiveName: string, issueNumber: number) {
    if (directiveName !== '## Retry') {
      throw new Error(`Unknown directive "${directiveName}" — only "## Retry" is implemented here`);
    }

    assert.ok(
      lastSeededAdwId,
      `No adwId has been seeded for issue ${issueNumber}. ` +
        'A "a state file exists for adwId …" or "issue … carries an ADW comment naming adwId …" Given step must precede this When step.',
    );

    const adwId = lastSeededAdwId;

    // Build the comments array that handleRetryDirective needs to extract the adwId.
    // This mirrors the real production path: the cron reads issue comments and passes
    // them to handleRetryDirective.
    const comments = [{ body: `**ADW ID:** \`${adwId}\`` }];

    // Ensure the production state is populated with the correct stage before calling
    // the handler. If the seed step (G25) hasn't written the production state yet,
    // fall back to reading from the worktree state (G6).
    const existingProduction = readProductionState(adwId);
    if (!existingProduction) {
      const worktreeState = readWorktreeState(this, adwId);
      const stage = (worktreeState?.['workflowStage'] as string | undefined) ?? 'merge_blocked';
      seedProductionState(adwId, { adwId, workflowStage: stage });
    } else {
      // Ensure cleanup tracks this adwId
      productionAdwIds.add(adwId);
    }

    // Track so After hook cleans up what handleRetryDirective writes
    productionAdwIds.add(adwId);

    handleRetryDirective(issueNumber, comments);
  },
);

// ---------------------------------------------------------------------------
// Then — merge retry count assertion (T22)
// ---------------------------------------------------------------------------

// T22
Then(
  'the state file for adwId {string} records a merge retry count of {int}',
  function (this: RegressionWorld, adwId: string, expectedCount: number) {
    // T1 reads production first, then worktree. We do the same for the retry counter.
    const productionState = readProductionState(adwId);
    const worktreeState = readWorktreeState(this, adwId);
    const state = productionState ?? worktreeState;

    assert.ok(
      state !== null,
      `State file not found for adwId "${adwId}" (checked production agents/${adwId}/state.json and worktree .adw/state.json)`,
    );

    const actualCount = state['mergeRetryCount'];
    assert.strictEqual(
      actualCount,
      expectedCount,
      `Expected mergeRetryCount ${expectedCount} for adwId "${adwId}" but got ${String(actualCount)}`,
    );
  },
);

// ---------------------------------------------------------------------------
// Then — PR-merge call assertions (T23–T24)
// ---------------------------------------------------------------------------

// T23
Then(
  'the mock GitHub API recorded a PR-merge call for PR {int}',
  function (this: RegressionWorld, prNumber: number) {
    const requests = this.getRecordedRequests();
    // gh pr merge uses PUT /repos/:owner/:repo/pulls/:prNumber/merge
    const mergeCall = requests.find(
      (r: RecordedRequest) =>
        r.method === 'PUT' && r.url.includes(`/pulls/${prNumber}/merge`),
    );
    assert.ok(
      mergeCall,
      `Expected a PUT .../pulls/${prNumber}/merge call but none was recorded. ` +
        `Recorded URLs: ${requests.map((r) => r.url).join(', ')}`,
    );
  },
);

// T24
Then(
  'the mock harness recorded no PR-merge call for PR {int}',
  function (this: RegressionWorld, prNumber: number) {
    const requests = this.getRecordedRequests();
    const mergeCall = requests.find(
      (r: RecordedRequest) =>
        r.method === 'PUT' && r.url.includes(`/pulls/${prNumber}/merge`),
    );
    assert.ok(
      !mergeCall,
      `Expected no PUT .../pulls/${prNumber}/merge call but one was recorded.`,
    );
  },
);

// ---------------------------------------------------------------------------
// Then — merge-blocked escalation comment assertions (T25–T27)
// ---------------------------------------------------------------------------

// T25 — matches "the merge-blocked escalation comment on issue {int} names the blocking cause"
Then(
  'the merge-blocked escalation comment on issue {int} names the blocking cause',
  function (this: RegressionWorld, issueNumber: number) {
    assertMergeBlockedComment(this, issueNumber);
  },
);

// T26 — matches "the merge-blocked escalation comment for issue {int} names the blocking cause"
Then(
  'the merge-blocked escalation comment for issue {int} names the blocking cause',
  function (this: RegressionWorld, issueNumber: number) {
    assertMergeBlockedComment(this, issueNumber);
  },
);

function assertMergeBlockedComment(world: RegressionWorld, issueNumber: number): void {
  const requests = world.getRecordedRequests();
  const commentPosts = requests.filter(
    (r: RecordedRequest) =>
      r.method === 'POST' && r.url.includes(`/issues/${issueNumber}/comments`),
  );

  const found = commentPosts.some((r: RecordedRequest) => {
    try {
      const body = JSON.parse(r.body) as Record<string, unknown>;
      const text = typeof body['body'] === 'string' ? body['body'] : '';
      // The escalation comment must contain the "Merge Blocked" header and a Cause line
      return text.includes('Merge Blocked') && (text.includes('Cause') || text.includes('cause'));
    } catch {
      return false;
    }
  });

  assert.ok(
    found,
    `Expected a merge-blocked escalation comment on issue ${issueNumber} containing "Merge Blocked" ` +
      `and a cause line, but none was found. Recorded comment posts: ${commentPosts.length}`,
  );
}

// T27
Then(
  'the mock GitHub API recorded a comment on issue {int} containing the text {string}',
  function (this: RegressionWorld, issueNumber: number, expectedText: string) {
    const requests = this.getRecordedRequests();
    const commentPosts = requests.filter(
      (r: RecordedRequest) =>
        r.method === 'POST' && r.url.includes(`/issues/${issueNumber}/comments`),
    );

    const found = commentPosts.some((r: RecordedRequest) => {
      try {
        const body = JSON.parse(r.body) as Record<string, unknown>;
        return typeof body['body'] === 'string' && body['body'].includes(expectedText);
      } catch {
        return false;
      }
    });

    assert.ok(
      found,
      `Expected a comment on issue ${issueNumber} containing "${expectedText}" ` +
        `but none was found in ${commentPosts.length} comment POST(s). ` +
        `Recorded URLs: ${requests.map((r) => r.url).join(', ')}`,
    );
  },
);

// ---------------------------------------------------------------------------
// Then — cron dispatch / spawn assertions (T28–T30)
// These assert against the output of W10 (cron probe). Since W10 is pending,
// the steps are defined here but will only execute once W10 is wired.
// ---------------------------------------------------------------------------

// T28: 'no orchestrator is spawned for issue {int}' is defined in feature-504.steps.ts

// T29
Then(
  'no merge orchestrator is dispatched for issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    const requests = this.getRecordedRequests();
    const mergeCalls = requests.filter(
      (r: RecordedRequest) =>
        r.method === 'POST' &&
        r.body.includes('merge') &&
        r.body.includes(String(issueNumber)),
    );
    assert.strictEqual(
      mergeCalls.length,
      0,
      `Expected no merge orchestrator dispatch for issue ${issueNumber} but found ${mergeCalls.length}`,
    );
  },
);

// T30
Then(
  'the merge orchestrator is dispatched for issue {int}',
  function (this: RegressionWorld, issueNumber: number) {
    // When W10 is wired, the cron probe's spawn records will be available.
    // The assertion checks that an adwMerge spawn was triggered for this issue.
    const requests = this.getRecordedRequests();
    const dispatchCall = requests.find(
      (r: RecordedRequest) =>
        r.method === 'POST' &&
        (r.url.includes('/spawn') || r.url.includes('/dispatch')) &&
        r.body.includes(String(issueNumber)),
    );
    assert.ok(
      dispatchCall,
      `Expected a merge orchestrator dispatch for issue ${issueNumber} but none was recorded.`,
    );
  },
);

