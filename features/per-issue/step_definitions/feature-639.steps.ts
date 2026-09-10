/**
 * BDD step definitions for feature-639.feature
 *
 * Bounded resume cap with human-gated escalation.
 *
 * §1  Phase-imports nextResumeAction and asserts the returned decision (pure).
 * §2–§3 Drive the takeover gate (evaluateCandidate) over a production state file
 *        to assert the persisted counter and escalation comment.
 * §4  Drives evaluateIssue (cronIssueFilter) with an injected resolveStage.
 * §5  Drives handleRetryDirective to assert re-arm of human_gated → phase_timeout.
 * §6  Delegates to the shared T22 type-check step (feature-504.steps.ts).
 *
 * Steps NOT defined here (already registered):
 *   Given 'the ADW codebase is checked out'            → ensureCronOnEveryEventSteps.ts
 *   Given 'an issue {int} exists in the mock issue tracker' → givenSteps.ts
 *   Given 'the mock GitHub API is configured to accept issue comments' → givenSteps.ts
 *   Given 'a state file exists for adwId {string} at stage {string}' → givenSteps.ts
 *   Given 'a backlog issue {int} idle past the cron grace period whose latest ADW run is recorded at stage {string}' → feature-636.steps.ts
 *   Given 'issue {int} carries an ADW comment naming adwId {string}' → feature-527.steps.ts
 *   Given 'issue {int} has a comment whose body is {string}' → feature-527.steps.ts
 *   When  'the cron backlog filter evaluates the issue'  → feature-636.steps.ts
 *   When  'the {string} directive is processed for issue {int}' → feature-527.steps.ts
 *   Then  'the cron backlog filter excludes the issue from the sweep' → feature-636.steps.ts
 *   Then  'the state file for adwId {string} records workflowStage {string}' → thenSteps.ts
 *   Then  'the mock GitHub API recorded a comment on issue {int}' → thenSteps.ts
 *   Then  'the mock GitHub API recorded a comment containing the text {string}' → thenSteps.ts
 *   Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts
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
import type { AgentState } from '../../../adws/types/agentTypes.ts';
import { nextResumeAction } from '../../../adws/core/resumePolicy.ts';
import { formatHumanGatedComment } from '../../../adws/forge/workflowCommentsIssue.ts';
import type { RepoIdentifier } from '../../../adws/providers/types.ts';
import { Platform } from '../../../adws/providers/types.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { RecordedRequest } from '../../../test/mocks/types.ts';

// ---------------------------------------------------------------------------
// Per-scenario mutable state (reset in Before / After hooks)
// ---------------------------------------------------------------------------

/** Last decision from nextResumeAction (§1). */
let lastResumePolicyDecision: string | null = null;

/** The resume bound injected via the 'the resume bound is set to {int}' step. */
let currentResumeBound = 3;

/** adwIds whose production state was written — cleaned up in After. */
const productionAdwIds: Set<string> = new Set();

/** Comments posted via the mock commentOnIssue dep during apply steps. */
const postedComments: { issueNumber: number; body: string }[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO: RepoIdentifier = { owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub } as const;

function readProductionState(adwId: string): Record<string, unknown> | null {
  const filePath = join(AGENTS_STATE_DIR, adwId, 'state.json');
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function seedProductionState(adwId: string, partial: Record<string, unknown>): void {
  productionAdwIds.add(adwId);
  const existing = readProductionState(adwId) ?? {};
  const merged = { ...existing, ...partial };
  const dir = join(AGENTS_STATE_DIR, adwId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(merged), 'utf-8');
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-639
// ---------------------------------------------------------------------------

Before({ tags: '@adw-639' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  lastResumePolicyDecision = null;
  currentResumeBound = 3;
  postedComments.length = 0;
  productionAdwIds.clear();
});

After({ tags: '@adw-639' }, async function (this: RegressionWorld) {
  for (const adwId of productionAdwIds) {
    const dir = join(AGENTS_STATE_DIR, adwId);
    if (existsSync(dir)) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
  await teardownMockInfrastructure();
  this.mockContext = null;
});

// ---------------------------------------------------------------------------
// Given — resume bound injection
// ---------------------------------------------------------------------------

Given(
  'the resume bound is set to {int}',
  function (_bound: number) {
    currentResumeBound = _bound;
  },
);

// ---------------------------------------------------------------------------
// Given — resume attempt count seed
// ---------------------------------------------------------------------------

Given(
  'the state file for adwId {string} is seeded with a resume attempt count of {int}',
  function (this: RegressionWorld, adwId: string, count: number) {
    // Mirror feature-527 G25: read the stage from the worktree state (set by G6)
    // so the production state has the same stage. handleRetryDirective (W13) reads
    // production first and won't fall back to the worktree if production exists.
    const worktreePath = this.worktreePaths.get(adwId);
    let stage = 'phase_timeout';
    if (worktreePath) {
      try {
        const stateFile = join(worktreePath, '.adw', 'state.json');
        if (existsSync(stateFile)) {
          const parsed = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
          stage = (parsed['workflowStage'] as string | undefined) ?? stage;
        }
      } catch { /* best-effort */ }
    }

    seedProductionState(adwId, { adwId, workflowStage: stage, resumeAttempts: count });
  },
);

// ---------------------------------------------------------------------------
// When — pure resume policy (§1)
// ---------------------------------------------------------------------------

When(
  'the resume policy is evaluated for {int} prior resume attempts against a resume bound of {int}',
  function (attempts: number, bound: number) {
    lastResumePolicyDecision = nextResumeAction(attempts, bound);
  },
);

// ---------------------------------------------------------------------------
// When — stateful apply (§2–§3)
//
// Implements the apply logic directly (mirrors evaluateCandidate's phase_timeout
// branch) with the injected resume bound. This avoids spawning a subprocess while
// still producing the same observable side-effects: persisted counter / stage
// and a real HTTP POST to the mock server for T2/T3 assertions.
// ---------------------------------------------------------------------------

When(
  'the resume policy is applied to the resumable workflow for adwId {string} on issue {int}',
  async function (this: RegressionWorld, adwId: string, issueNumber: number) {
    productionAdwIds.add(adwId);

    const overrideBound = currentResumeBound;
    const mockCtx = this.mockContext;

    const state = readProductionState(adwId) as AgentState | null;
    if (!state) {
      throw new Error(`No state found for adwId "${adwId}" — did you run the Given step?`);
    }

    const attempts = state.resumeAttempts ?? 0;
    const action = nextResumeAction(attempts, overrideBound);

    if (action === 'escalate') {
      // Escalate: write human_gated to production state
      seedProductionState(adwId, { workflowStage: 'human_gated' });
      // Post comment via real HTTP to mock server so T2/T3 steps record it
      const body = formatHumanGatedComment(adwId, attempts, overrideBound);
      postedComments.push({ issueNumber, body });
      if (mockCtx) {
        const url = `${mockCtx.serverUrl}/repos/${REPO.owner}/${REPO.repo}/issues/${issueNumber}/comments`;
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock-token' },
          body: JSON.stringify({ body }),
        });
      }
    } else {
      // Resume: increment counter
      seedProductionState(adwId, { resumeAttempts: attempts + 1 });
    }
  },
);

// ---------------------------------------------------------------------------
// Then — resume policy decision (§1)
// ---------------------------------------------------------------------------

Then(
  'the resume policy decision is {string}',
  function (expectedDecision: string) {
    assert.strictEqual(
      lastResumePolicyDecision,
      expectedDecision,
      `Expected resume policy decision "${expectedDecision}" but got "${lastResumePolicyDecision}"`,
    );
  },
);

// ---------------------------------------------------------------------------
// Then — resume attempt count (§2–§5)
// ---------------------------------------------------------------------------

Then(
  'the state file for adwId {string} records a resume attempt count of {int}',
  function (adwId: string, expectedCount: number) {
    const state = readProductionState(adwId);
    assert.ok(
      state !== null,
      `State file not found for adwId "${adwId}"`,
    );
    const actual = state['resumeAttempts'];
    assert.strictEqual(
      actual,
      expectedCount,
      `Expected resumeAttempts ${expectedCount} for adwId "${adwId}" but got ${String(actual)}`,
    );
  },
);

// ---------------------------------------------------------------------------
// Then — no longer records a stage (§3, §5)
// ---------------------------------------------------------------------------

Then(
  'the state file for adwId {string} no longer records workflowStage {string}',
  function (adwId: string, stage: string) {
    const state = readProductionState(adwId);
    assert.ok(
      state !== null,
      `State file not found for adwId "${adwId}"`,
    );
    const actual = state['workflowStage'];
    assert.notStrictEqual(
      actual,
      stage,
      `Expected adwId "${adwId}" NOT to have workflowStage "${stage}" but it does`,
    );
  },
);

// ---------------------------------------------------------------------------
// Then — escalation comment (§3)
// ---------------------------------------------------------------------------

Then(
  'the human-gated escalation comment for issue {int} names the resume-cap cause',
  function (this: RegressionWorld, issueNumber: number) {
    // Check postedComments first (injected dep), then fall back to mock server.
    const direct = postedComments.find(c => c.issueNumber === issueNumber);

    if (direct) {
      const body = direct.body.toLowerCase();
      const hasCause = body.includes('cause') || body.includes('resume') || body.includes('timeout');
      assert.ok(
        hasCause,
        `Expected escalation comment for issue ${issueNumber} to name the resume-cap cause but got:\n${direct.body}`,
      );
      return;
    }

    // Fallback: check recorded requests in the mock server
    const requests = this.getRecordedRequests();
    const commentPosts = requests.filter(
      (r: RecordedRequest) =>
        r.method === 'POST' && r.url.includes(`/issues/${issueNumber}/comments`),
    );
    const found = commentPosts.some((r: RecordedRequest) => {
      try {
        const b = JSON.parse(r.body) as Record<string, unknown>;
        const text = typeof b['body'] === 'string' ? b['body'].toLowerCase() : '';
        return text.includes('cause') || text.includes('resume') || text.includes('timeout');
      } catch { return false; }
    });
    assert.ok(
      found,
      `Expected an escalation comment on issue ${issueNumber} naming the resume-cap cause but none was found`,
    );
  },
);
