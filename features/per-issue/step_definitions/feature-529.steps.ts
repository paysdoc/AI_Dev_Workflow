/**
 * BDD step definitions for feature-529.feature
 * orchestrator-state resolution — adwMerge follows the owning orchestrator, not
 * the first -orchestrator dir (#529, closing the #508 shadowing regression).
 *
 * Design:
 *  The §1/§2 scenarios drive the merge orchestrator via W1
 *  (`the {string} orchestrator is invoked…`, defined in whenSteps.ts), which
 *  returns 'pending' until the ISSUE-3-CUTOVER subprocess harness is wired.
 *  Those scenarios are therefore "pending" in Cucumber, not failing — a clean
 *  tally (0 failed, 0 undefined) is treated as PASS by scenarioProof.ts. The
 *  Given steps below seed the same state artefacts adwInit / adwSdlc write at
 *  runtime, so the scenarios run end-to-end once W1 is active.
 *
 *  The seeded artefacts reproduce the #508 ordering: a failed `init-orchestrator`
 *  directory (which a raw `readdirSync` scan returns ahead of `sdlc-orchestrator`)
 *  shadows the real `sdlc-orchestrator` directory. findOrchestratorStatePath must
 *  prefer the directory owned by the top-level `orchestratorScript`.
 *
 * Steps NOT defined here (already available):
 *  - Given 'the ADW codebase is checked out' → ensureCronOnEveryEventSteps.ts
 *  - Given 'an issue {int} exists in the mock issue tracker' → givenSteps.ts
 *  - Given 'the mock GitHub API is configured to accept issue comments' → givenSteps.ts
 *  - Given 'the worktree for adwId {string} is initialised at branch {string}' → givenSteps.ts
 *  - Given 'the branch {string} carries a single open PR {int}' → feature-527.steps.ts
 *  - Given 'the branch {string} has no pull request' → feature-527.steps.ts
 *  - When  'the {string} orchestrator is invoked with adwId {string} and issue {int}' → whenSteps.ts (pending)
 *  - Then  'the mock GitHub API recorded a PR-merge call for PR {int}' → feature-527.steps.ts
 *  - Then  'the state file for adwId {string} records workflowStage {string}' → thenSteps.ts
 *  - Then  'the orchestrator subprocess exited {int}' → thenSteps.ts
 *  - Then  'the ADW TypeScript type-check passes' → feature-504.steps.ts
 */

import { Before, After, Given } from '@cucumber/cucumber';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import { AGENTS_STATE_DIR } from '../../../adws/core/index.ts';
import { deriveOrchestratorScript } from '../../../adws/core/orchestratorLib.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// ---------------------------------------------------------------------------
// Per-scenario state — adwIds seeded into the production agents/ dir, cleaned
// up in the After hook.
// ---------------------------------------------------------------------------

const seededAdwIds = new Set<string>();

// ---------------------------------------------------------------------------
// Helpers — seed the state artefacts the orchestrators write at runtime.
// Raw JSON writes (mirroring feature-527's seedProductionState) keep the seeded
// agentName free of the AgentIdentifier union so 'init-orchestrator' is allowed.
// ---------------------------------------------------------------------------

/** Writes the top-level state file at agents/{adwId}/state.json. */
function seedTopLevelState(adwId: string, state: Record<string, unknown>): void {
  seededAdwIds.add(adwId);
  const dir = join(AGENTS_STATE_DIR, adwId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state), 'utf-8');
}

/**
 * Writes a per-orchestrator record at agents/{adwId}/{orchestratorName}/state.json.
 * The subdirectory is named after the agentName, so a raw readdirSync scan returns
 * `init-orchestrator` ahead of `sdlc-orchestrator` — reproducing the #508 ordering
 * that an unguarded first-match scan resolved incorrectly.
 */
function seedOrchestratorRecord(
  adwId: string,
  orchestratorName: string,
  record: Record<string, unknown>,
): void {
  seededAdwIds.add(adwId);
  const dir = join(AGENTS_STATE_DIR, adwId, orchestratorName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({ agentName: orchestratorName, ...record }),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-529
// ---------------------------------------------------------------------------

Before({ tags: '@adw-529' }, async function (this: RegressionWorld) {
  // Initialise mockContext so the shared regression Given steps
  // ("an issue {int} exists…", "…configured to accept issue comments") work.
  this.mockContext = await setupMockInfrastructure();
  seededAdwIds.clear();
});

After({ tags: '@adw-529' }, async function (this: RegressionWorld) {
  // Remove seeded production state and any temp worktrees from the Given steps.
  for (const adwId of seededAdwIds) {
    const dir = join(AGENTS_STATE_DIR, adwId);
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
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
// Given — top-level state seeding
// ---------------------------------------------------------------------------

// Records the orchestratorScript that owns the run, so findOrchestratorStatePath
// prefers that orchestrator's directory over a shadowing one (#529).
Given(
  'the top-level state for adwId {string} records stage {string} owned by the {string}',
  function (this: RegressionWorld, adwId: string, stage: string, orchestratorName: string) {
    seedTopLevelState(adwId, {
      adwId,
      workflowStage: stage,
      orchestratorScript: deriveOrchestratorScript(orchestratorName),
    });
  },
);

// No owning orchestrator recorded: omit orchestratorScript so resolution falls
// back to the sole orchestrator record (the preserved first-match behaviour).
Given(
  'the top-level state for adwId {string} records stage {string} with no owning orchestrator recorded',
  function (this: RegressionWorld, adwId: string, stage: string) {
    seedTopLevelState(adwId, { adwId, workflowStage: stage });
  },
);

// ---------------------------------------------------------------------------
// Given — per-orchestrator record seeding
// ---------------------------------------------------------------------------

// The shadowing failed init-orchestrator from #508: no branchName recorded.
Given(
  'adwId {string} also has a failed init-orchestrator record with no branch name',
  function (this: RegressionWorld, adwId: string) {
    seedOrchestratorRecord(adwId, 'init-orchestrator', {
      execution: { status: 'failed', startedAt: new Date().toISOString() },
    });
  },
);

// A failed init-orchestrator that nonetheless recorded a stale branch name —
// resolution must still prefer the sdlc-orchestrator, not this branch.
Given(
  'adwId {string} also has a failed init-orchestrator record for the stale branch {string}',
  function (this: RegressionWorld, adwId: string, staleBranch: string) {
    seedOrchestratorRecord(adwId, 'init-orchestrator', {
      branchName: staleBranch,
      execution: { status: 'failed', startedAt: new Date().toISOString() },
    });
  },
);

// The real sdlc-orchestrator record carrying the branch under test.
Given(
  'adwId {string} also has an sdlc-orchestrator record for branch {string}',
  function (this: RegressionWorld, adwId: string, branch: string) {
    seedOrchestratorRecord(adwId, 'sdlc-orchestrator', { branchName: branch });
  },
);
