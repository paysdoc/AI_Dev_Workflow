/**
 * BDD step definitions for feature-524.feature
 * branchName persistence — one branch per adwId across workflow re-entry
 *
 * Design: §§1-5 drive branchNameResolution directly via
 * _resolveWorkflowBranchNameForTest (the test-only export that accepts an
 * injected agent function), rather than spawning a full orchestrator subprocess.
 * This keeps the scenarios fast and deterministic while still asserting against
 * the same artefact (agents/{adwId}/state.json) that initializeWorkflow writes.
 *
 * The canonical "only one branch/worktree created" unit test lives at
 * adws/phases/__tests__/workflowInit.test.ts. These BDD steps verify the same
 * property at the resolver level: agent invoked once ⟹ one branch name ⟹
 * one branch/worktree.
 *
 * §5 (sibling-worktree plan search, criterion 4) is the explicit optional
 * follow-up — steps are defined but return 'pending'.
 * §6 (type-check) delegates to the shared step in feature-504.steps.ts.
 *
 * Steps NOT defined here (already available):
 *  - Given 'the ADW codebase is checked out'   → ensureCronOnEveryEventSteps.ts
 *  - Given 'an issue {int} exists in the mock issue tracker' → givenSteps.ts
 *  - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts
 */

import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/index.ts';
import { _resolveWorkflowBranchNameForTest } from '../../../adws/phases/branchNameResolution.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { IssueClassSlashCommand, GitHubIssue, RecoveryState } from '../../../adws/core/index.ts';

// ---------------------------------------------------------------------------
// Per-scenario mutable state (reset in Before hook for each @adw-524 scenario)
// ---------------------------------------------------------------------------

let agentCallCount = 0;
/** Queue of factories: each returns the full branch name for the given issue number. */
let agentResponseQueue: Array<(issueNumber: number) => string> = [];
/** Error captured from the last runWorkflowInit call; null if the call succeeded. */
let lastWorkflowError: Error | null = null;
/**
 * When set, the mock agent writes this branch name back to the top-level state
 * during its execution, simulating a concurrent writer active during the LLM
 * call. This is the mechanism that triggers the mismatch guard (criterion 2).
 */
let concurrentWriterName: string | null = null;
/** adwId → agents/{adwId} directories to clean up in After. */
const cleanupAdwIds = new Set<string>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const nullRecoveryState: RecoveryState = {
  lastCompletedStage: null,
  adwId: null,
  branchName: null,
  planPath: null,
  prUrl: null,
  canResume: false,
};

function makeTestIssue(number: number): GitHubIssue {
  return {
    number,
    title: `Test issue ${number}`,
    body: '',
    state: 'open',
    author: { login: 'test', isBot: false },
    assignees: [],
    labels: [],
    comments: [],
    createdAt: '',
    updatedAt: '',
    closedAt: null,
    url: '',
  };
}

type AgentFn = Parameters<typeof _resolveWorkflowBranchNameForTest>[1];

function makeScenarioAgentFn(adwId: string): AgentFn {
  return async (_issueType: IssueClassSlashCommand, issue: GitHubIssue, _logsDir: string) => {
    agentCallCount++;
    if (agentResponseQueue.length === 0) {
      throw new Error(
        `[feature-524 mock agent] No more responses configured for adwId "${adwId}". ` +
          'Did a Given step forget to push to agentResponseQueue?',
      );
    }
    const factory = agentResponseQueue.shift()!;
    const branchName = factory(issue.number);

    // Simulate concurrent write during the LLM call.
    // Set concurrentWriterName in the "forced to run again" Given step.
    if (concurrentWriterName) {
      AgentStateManager.writeTopLevelState(adwId, { branchName: concurrentWriterName });
    }

    return {
      branchName,
      success: true,
      output: '',
      sessionId: 'test-session',
      totalCostUsd: 0,
      modelUsage: {} as Record<string, unknown>,
    };
  };
}

function cleanupAdwId(adwId: string): void {
  const dir = join(AGENTS_STATE_DIR, adwId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

async function runWorkflowInit(adwId: string, issueNumber: number): Promise<void> {
  cleanupAdwIds.add(adwId);
  try {
    await _resolveWorkflowBranchNameForTest(
      {
        adwId,
        issueType: '/feature' as IssueClassSlashCommand,
        issue: makeTestIssue(issueNumber),
        logsDir: '/tmp/feature-524-bdd-logs',
        recoveryState: nullRecoveryState,
      },
      makeScenarioAgentFn(adwId),
    );
  } catch (err) {
    lastWorkflowError = err as Error;
  }
}

// ---------------------------------------------------------------------------
// Before / After hooks
// ---------------------------------------------------------------------------

Before({ tags: '@adw-524' }, async function (this: RegressionWorld) {
  // initialise mockContext so the shared "an issue {int} exists" step works
  this.mockContext = await setupMockInfrastructure();
  // reset per-scenario state
  agentCallCount = 0;
  agentResponseQueue = [];
  lastWorkflowError = null;
  concurrentWriterName = null;
  cleanupAdwIds.clear();
});

After({ tags: '@adw-524' }, async function (this: RegressionWorld) {
  for (const adwId of cleanupAdwIds) {
    cleanupAdwId(adwId);
  }
  await teardownMockInfrastructure();
  this.mockContext = null;
});

// ---------------------------------------------------------------------------
// Given — documentation steps (no-ops; confirm starting conditions)
// ---------------------------------------------------------------------------

Given('no resumable branch is recorded for issue {int}', (_issueNumber: number) => {
  // recovery state passed to resolveWorkflowBranchName is nullRecoveryState — no-op
});

Given(
  'worktree discovery by issue pattern is unavailable for issue {int}',
  (_issueNumber: number) => {
    // resolveWorkflowBranchName does not perform worktree discovery — no-op
  },
);

// ---------------------------------------------------------------------------
// Given — state seeding
// ---------------------------------------------------------------------------

Given(
  'a branch name {string} is already persisted in the top-level state for adwId {string}',
  (branchName: string, adwId: string) => {
    cleanupAdwIds.add(adwId);
    AgentStateManager.writeTopLevelState(adwId, { branchName });
  },
);

// ---------------------------------------------------------------------------
// Given — agent mock configuration
// ---------------------------------------------------------------------------

Given('the branch-name agent is configured to return slug {string}', (slug: string) => {
  agentResponseQueue.push((n: number) => `feature-issue-${n}-${slug}`);
});

Given(
  'the branch-name agent is configured to return slug {string} on its first call and {string} on its second call',
  (slugA: string, slugB: string) => {
    agentResponseQueue.push((n: number) => `feature-issue-${n}-${slugA}`);
    agentResponseQueue.push((n: number) => `feature-issue-${n}-${slugB}`);
  },
);

Given(
  'the branch-name agent is forced to run again and is configured to return slug {string}',
  (slug: string) => {
    // "Forced to run again" means: clear the persisted state so readPersistedBranchName
    // returns undefined and the resolver falls through to the agent. We also set up
    // concurrentWriterName so the mock agent re-persists the ORIGINAL name during
    // the LLM call, triggering the mismatch guard when the returned slug differs.
    const adwId = [...cleanupAdwIds][0];
    assert.ok(
      adwId,
      'Expected an adwId in cleanupAdwIds before "forced to run again" step. ' +
        'The "a branch name X is already persisted for adwId Y" Given must precede this step.',
    );

    // Save the currently persisted name (the "original" that a concurrent writer would restore)
    const originalName = AgentStateManager.readTopLevelState(adwId)?.branchName ?? null;

    // Clear the persisted state so the resolver falls through to the agent
    cleanupAdwId(adwId);
    cleanupAdwIds.add(adwId); // re-add so After hook still cleans up

    // Configure the concurrent writer to re-persist the original name during the agent call
    concurrentWriterName = originalName;

    // Queue the agent's return value
    agentResponseQueue.push((n: number) => `feature-issue-${n}-${slug}`);
  },
);

// ---------------------------------------------------------------------------
// When — workflow initialisation
// ---------------------------------------------------------------------------

When(
  'the workflow is initialised for adwId {string} and issue {int}',
  async (adwId: string, issueNumber: number) => {
    await runWorkflowInit(adwId, issueNumber);
  },
);

When(
  'the workflow is initialised again for adwId {string} and issue {int}',
  async (adwId: string, issueNumber: number) => {
    // Reset error state so a fresh error (or success) is captured for this call
    lastWorkflowError = null;
    await runWorkflowInit(adwId, issueNumber);
  },
);

// ---------------------------------------------------------------------------
// Then — top-level state file assertions
// ---------------------------------------------------------------------------

Then(
  'the top-level state file for adwId {string} records a non-empty branchName',
  (adwId: string) => {
    const state = AgentStateManager.readTopLevelState(adwId);
    assert.ok(
      state?.branchName,
      `Expected a non-empty branchName in agents/${adwId}/state.json but got: ${state?.branchName ?? 'undefined'}`,
    );
  },
);

Then(
  'the top-level state file for adwId {string} records branchName {string}',
  (adwId: string, expectedBranchName: string) => {
    const state = AgentStateManager.readTopLevelState(adwId);
    assert.strictEqual(
      state?.branchName,
      expectedBranchName,
      `Expected branchName "${expectedBranchName}" in agents/${adwId}/state.json but got: "${state?.branchName}"`,
    );
  },
);

Then(
  'the top-level state file for adwId {string} still records branchName {string}',
  (adwId: string, expectedBranchName: string) => {
    const state = AgentStateManager.readTopLevelState(adwId);
    assert.strictEqual(
      state?.branchName,
      expectedBranchName,
      `Expected branchName to still be "${expectedBranchName}" in agents/${adwId}/state.json but got: "${state?.branchName}"`,
    );
  },
);

// ---------------------------------------------------------------------------
// Then — agent invocation assertions
// ---------------------------------------------------------------------------

Then(
  'the branch-name agent is not invoked for adwId {string}',
  (_adwId: string) => {
    assert.strictEqual(
      agentCallCount,
      0,
      `Expected branch-name agent NOT to be invoked for adwId "${_adwId}" but it was called ${agentCallCount} time(s)`,
    );
  },
);

Then(
  'the branch-name agent is invoked exactly once across both initialisations for adwId {string}',
  (_adwId: string) => {
    assert.strictEqual(
      agentCallCount,
      1,
      `Expected branch-name agent to be invoked exactly once for adwId "${_adwId}" but it was called ${agentCallCount} time(s)`,
    );
  },
);

// ---------------------------------------------------------------------------
// Then — branch / worktree creation (proxy via agent call count)
//
// One agent call ⟹ one branch name generated ⟹ one branch/worktree created.
// ---------------------------------------------------------------------------

Then(
  'only one branch is created for issue {int} across both initialisations',
  (_issueNumber: number) => {
    assert.strictEqual(
      agentCallCount,
      1,
      `Expected exactly one branch to be created (agent called once) but agent was called ${agentCallCount} time(s)`,
    );
  },
);

Then(
  'only one worktree is created for issue {int} across both initialisations',
  (_issueNumber: number) => {
    assert.strictEqual(
      agentCallCount,
      1,
      `Expected exactly one worktree to be created (agent called once) but agent was called ${agentCallCount} time(s)`,
    );
  },
);

Then('only one worktree is created for issue {int}', (_issueNumber: number) => {
  assert.ok(
    agentCallCount <= 1,
    `Expected at most one worktree to be created (agent called ≤ once) but agent was called ${agentCallCount} time(s)`,
  );
});

Then('no second worktree is created for issue {int}', (_issueNumber: number) => {
  // The mismatch guard threw before any second worktree could be created.
  // If the guard fired, lastWorkflowError is set — that proves no second creation happened.
  assert.ok(
    lastWorkflowError,
    `Expected the mismatch guard to have thrown (preventing second worktree creation) but workflow succeeded`,
  );
});

// ---------------------------------------------------------------------------
// Then — workflow outcome assertions
// ---------------------------------------------------------------------------

Then(
  'the workflow initialisation fails with an error that names the persisted branch {string}',
  (persistedBranchName: string) => {
    assert.ok(
      lastWorkflowError,
      `Expected workflow initialisation to fail but it succeeded`,
    );
    assert.ok(
      lastWorkflowError.message.includes(persistedBranchName),
      `Expected error message to name the persisted branch "${persistedBranchName}" but got: "${lastWorkflowError.message}"`,
    );
  },
);

Then('the workflow initialisation completes without error', () => {
  assert.strictEqual(
    lastWorkflowError,
    null,
    `Expected workflow initialisation to succeed but it failed: "${lastWorkflowError?.message}"`,
  );
});

// ---------------------------------------------------------------------------
// §5 Optional follow-up (criterion 4) — sibling-worktree plan search
// Deferred per the implementation plan; steps are pending until a follow-up issue
// implements findPlanFile sibling search.
// ---------------------------------------------------------------------------

Given(
  'a worktree for adwId {string} exists at branch {string} with no plan file',
  (_adwId: string, _branch: string) => {
    return 'pending';
  },
);

Given(
  'a sibling worktree for issue {int} at branch {string} holds the plan file {string}',
  (_issueNumber: number, _branch: string, _planFile: string) => {
    return 'pending';
  },
);

When(
  'the plan file for issue {int} is resolved from the worktree for adwId {string}',
  (_issueNumber: number, _adwId: string) => {
    return 'pending';
  },
);

Then(
  'the plan resolution error names the orphan worktree at branch {string}',
  (_branch: string) => {
    return 'pending';
  },
);
