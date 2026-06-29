/**
 * BDD step definitions for feature-720.feature
 *
 * review_failed blocking stage + SDLC blocks on review exhaustion
 *
 * §1  pure gate extensions — fail selects review_failed + skip-doc/PR
 * §2  SDLC review exhaustion blocks (state + comment)
 * §3  cron money-fire pin (handled by feature-636/639 shared steps)
 * §4  ## Retry re-arms (handled by feature-527/639 shared steps)
 * §5  TypeScript type-check backstop (handled by feature-504 shared step T22)
 *
 * Steps NOT defined here (already registered):
 *   - Given 'the ADW codebase is checked out'                                         → ensureCronOnEveryEventSteps.ts (G18)
 *   - Given 'an issue {int} exists in the mock issue tracker'                          → givenSteps.ts (G4)
 *   - Given 'the mock GitHub API is configured to accept issue comments'               → givenSteps.ts (G1)
 *   - Given 'a state file exists for adwId {string} at stage {string}'                → givenSteps.ts (G6)
 *   - Given 'the worktree for adwId {string} is initialised at branch {string}'       → givenSteps.ts (G11)
 *   - Given 'a backlog issue {int} idle past the cron grace period ...'               → feature-636.steps.ts
 *   - Given 'issue {int} carries an ADW comment naming adwId {string}'               → feature-527.steps.ts
 *   - Given 'the state file for adwId {string} is seeded with a resume attempt count' → feature-639.steps.ts
 *   - Given 'issue {int} has a comment whose body is {string}'                        → feature-527.steps.ts
 *   - When  'the post-review outcome is decided for a passing/failing review'         → feature-719.steps.ts
 *   - When  'the cron backlog filter evaluates the issue'                             → feature-636.steps.ts
 *   - When  'the {string} directive is processed for issue {int}'                     → feature-527.steps.ts
 *   - Then  'the state file for adwId {string} records workflowStage {string}'       → thenSteps.ts (T1)
 *   - Then  'the mock harness recorded zero PR creations for issue {int}'             → feature-541.steps.ts
 *   - Then  'the mock GitHub API recorded a comment on issue {int}'                   → thenSteps.ts (T2)
 *   - Then  'the mock GitHub API recorded a comment containing the text {string}'     → thenSteps.ts (T3)
 *   - Then  'the cron backlog filter excludes the issue from the sweep'               → feature-636.steps.ts
 *   - Then  'the state file for adwId {string} records a resume attempt count of {int}' → feature-639.steps.ts
 *   - Then  'the ADW TypeScript type-check passes'                                    → feature-504.steps.ts (T22)
 */

import { Before, After, Then, When } from '@cucumber/cucumber';
import { existsSync, rmSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/index.ts';
import { executeSdlcReviewFailedHandoff } from '../../../adws/phases/sdlcReviewHandoff.ts';
import { getLastPostReviewOutcome } from './feature-719.steps.ts';
import { Platform } from '../../../adws/providers/types.ts';
import type { RepoContext } from '../../../adws/providers/types.ts';
import type { WorkflowContext } from '../../../adws/github/workflowCommentsIssue.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------
// Production adwIds written in §2 — cleaned up in After hook
// ---------------------------------------------------------------------------

const productionAdwIds = new Set<string>();

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-720
// ---------------------------------------------------------------------------

Before({ tags: '@adw-720' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  productionAdwIds.clear();
});

After({ tags: '@adw-720' }, async function (this: RegressionWorld) {
  for (const adwId of productionAdwIds) {
    const dir = join(AGENTS_STATE_DIR, adwId);
    if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
  productionAdwIds.clear();

  for (const [, dir] of this.worktreePaths) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  await teardownMockInfrastructure();
  this.mockContext = null;
  this.worktreePaths.clear();
  this.prsByBranch.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// §1 — Pure gate extension: fail selects review_failed + skip-doc/PR
// ---------------------------------------------------------------------------

Then('the post-review outcome selects the review_failed blocking stage', function () {
  const outcome = getLastPostReviewOutcome();
  assert.ok(outcome !== null, 'Expected a post-review outcome to be set via a When step');
  assert.strictEqual(
    outcome.workflowStage,
    'review_failed',
    `Expected workflowStage "review_failed" but got "${String(outcome.workflowStage)}"`,
  );
});

Then('the post-review outcome signals the SDLC orchestrator to skip document and PR creation', function () {
  const outcome = getLastPostReviewOutcome();
  assert.ok(outcome !== null, 'Expected a post-review outcome to be set via a When step');
  assert.strictEqual(
    outcome.skipDocAndPR,
    true,
    'Expected skipDocAndPR to be true for a failing review',
  );
});

Then('the post-review outcome proceeds with document and PR creation', function () {
  const outcome = getLastPostReviewOutcome();
  assert.ok(outcome !== null, 'Expected a post-review outcome to be set via a When step');
  assert.strictEqual(
    outcome.skipDocAndPR,
    false,
    'Expected skipDocAndPR to be false for a passing review',
  );
});

// ---------------------------------------------------------------------------
// §2 — SDLC review-failure handoff (state write + branch-pointing comment)
// ---------------------------------------------------------------------------

When(
  'the SDLC post-review handoff is executed for adwId {string} on issue {int} after a failing review',
  async function (this: RegressionWorld, adwId: string, issueNumber: number) {
    assert.ok(this.mockContext, 'mockContext must be initialised (Before hook must run)');
    productionAdwIds.add(adwId);

    const branchName = this.targetBranch || undefined;
    const mockServerUrl = this.mockContext.serverUrl;

    // Capture the comment posted by executeSdlcReviewFailedHandoff without
    // routing through the gh CLI (which would require a full git remote).
    // Then post the captured comment to the mock server via fetch so T2/T3
    // can find it in the recorded requests — the same pattern feature-639 §3 uses.
    let capturedIssueNumber: number | null = null;
    let capturedBody: string | null = null;

    const mockRC = {
      issueTracker: {
        commentOnIssue(n: number, body: string) {
          capturedIssueNumber = n;
          capturedBody = body;
        },
        fetchIssue: async () => null as never,
        deleteComment: () => undefined,
        closeIssue: async () => false,
        getIssueState: () => 'open',
        fetchComments: () => [],
        moveToStatus: async () => {},
      },
      codeHost: {
        getRepoIdentifier: () => ({ owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub }),
      },
      cwd: this.worktreePaths.get(adwId) ?? ROOT,
      repoId: { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub },
    } as unknown as RepoContext;

    const ctx: WorkflowContext = {
      adwId,
      issueNumber: null,
      branchName,
    };

    executeSdlcReviewFailedHandoff({ adwId, issueNumber, repoContext: mockRC, ctx });

    // Forward the captured comment to the mock server so T2/T3 find it in
    // recorded requests (the mock server records all non-/_mock/ requests).
    if (capturedIssueNumber !== null && capturedBody !== null) {
      await fetch(
        `${mockServerUrl}/repos/test-owner/test-repo/issues/${capturedIssueNumber}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: capturedBody }),
        },
      );
    }
  },
);
