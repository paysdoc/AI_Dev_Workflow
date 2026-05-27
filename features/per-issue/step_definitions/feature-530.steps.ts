/**
 * BDD step definitions for feature-530.feature
 * adwMerge resolves branchName from top-level state — the #524 persistence reaches the merge path.
 *
 * Execution pattern: phase-import. The When step calls the exported executeMerge()
 * directly with injected deps, exactly as feature-527 calls handleRetryDirective().
 * This is required because the GitHub API mock implements neither `gh pr list` nor
 * `gh pr merge` (no /pulls list route, no PUT /pulls/:n/merge route), so a real
 * orchestrator subprocess merge cannot run against it.
 *
 * The injected deps keep the behaviour under test honest:
 *   - readTopLevelState / findOrchestratorStatePath / readOrchestratorState are the
 *     real implementations reading the real seeded state files (agents/{adwId}/...),
 *     so the branch-name resolution being verified — top-level first, orchestrator
 *     fallback — runs against genuine artefacts, not stubs.
 *   - writeTopLevelState is the real implementation, so the workflowStage assertion
 *     (T1) reads the artefact adwMerge actually produced.
 *   - findPRByBranch resolves the branch to its PR via the branch→PR map recorded by
 *     G21 (feature-527), the only channel available without the gh CLI.
 *   - mergeWithConflictResolution performs the merge as a real PUT to the mock server
 *     so the recorded-request assertions (T7 / T23 / T24) observe it.
 *
 * Steps NOT defined here (already in the regression suite or other per-issue files):
 *   - Given 'the ADW codebase is checked out'                                  → ensureCronOnEveryEventSteps.ts
 *   - Given 'an issue {int} exists in the mock issue tracker'                   → givenSteps.ts (G4)
 *   - Given 'the mock GitHub API records all PR-list calls'                     → givenSteps.ts (G8)
 *   - Given 'the mock GitHub API is configured to accept issue comments'        → givenSteps.ts (G1)
 *   - Given 'the worktree for adwId {string} is initialised at branch {string}' → givenSteps.ts (G11)
 *   - Given 'a state file exists for adwId {string} at stage {string}'          → givenSteps.ts (G6)
 *   - Given 'the branch {string} carries a single open PR {int}'               → feature-527.steps.ts (G21)
 *   - Then  'the mock GitHub API recorded a PR-merge call for PR {int}'         → feature-527.steps.ts (T23)
 *   - Then  'the mock harness recorded no PR-merge call for PR {int}'           → feature-527.steps.ts (T24)
 *   - Then  'the mock harness recorded zero PR-merge calls'                     → thenSteps.ts (T7)
 *   - Then  'the state file for adwId {string} records workflowStage {string}'  → thenSteps.ts (T1)
 *   - Then  'the ADW TypeScript type-check passes'                              → feature-504.steps.ts
 */

import { Before, After, Given, When } from '@cucumber/cucumber';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import assert from 'assert';
import {
  setupMockInfrastructure,
  teardownMockInfrastructure,
} from '../../../test/mocks/test-harness.ts';
import { AGENTS_STATE_DIR, AgentStateManager } from '../../../adws/core/index.ts';
import { findOrchestratorStatePath } from '../../../adws/core/stateHelpers.ts';
import { executeMerge, type MergeDeps } from '../../../adws/adwMerge.tsx';
import type { RepoInfo, RawPR } from '../../../adws/github/index.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

// ---------------------------------------------------------------------------
// Per-scenario mutable state — adwIds written under the production agents/ dir,
// cleaned up in the After hook.
// ---------------------------------------------------------------------------

const seededAdwIds = new Set<string>();

/** The orchestrator state subdir name; its agentName must end in "-orchestrator". */
const ORCHESTRATOR_SUBDIR = 'sdlc-orchestrator';
const ORCHESTRATOR_AGENT_NAME = 'sdlc-orchestrator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads the workflowStage that G6 wrote to the temp worktree state for an adwId,
 * defaulting to 'awaiting_merge' (every §530 scenario seeds that stage).
 */
function worktreeStage(world: RegressionWorld, adwId: string): string {
  const worktreePath = world.worktreePaths.get(adwId);
  if (worktreePath) {
    const stateFile = join(worktreePath, '.adw', 'state.json');
    if (existsSync(stateFile)) {
      try {
        const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
        if (typeof state['workflowStage'] === 'string') return state['workflowStage'];
      } catch {
        /* fall through to default */
      }
    }
  }
  return 'awaiting_merge';
}

/**
 * Seeds (merges into) the production top-level state file at agents/{adwId}/state.json.
 * The stage is taken from the worktree state G6 declared, so the merge path observes
 * the same `awaiting_merge` stage the scenario set up.
 */
function seedTopLevelState(
  world: RegressionWorld,
  adwId: string,
  extra: Record<string, unknown>,
): void {
  seededAdwIds.add(adwId);
  const dir = join(AGENTS_STATE_DIR, adwId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'state.json');

  let existing: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      existing = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  const merged: Record<string, unknown> = {
    adwId,
    issueNumber: 0,
    workflowStage: worktreeStage(world, adwId),
    ...existing,
    ...extra,
  };
  writeFileSync(file, JSON.stringify(merged, null, 2), 'utf-8');
}

/**
 * Seeds the orchestrator-specific state at agents/{adwId}/sdlc-orchestrator/state.json
 * with an agentName findOrchestratorStatePath recognises.
 */
function seedOrchestratorState(adwId: string, extra: Record<string, unknown>): void {
  seededAdwIds.add(adwId);
  const dir = join(AGENTS_STATE_DIR, adwId, ORCHESTRATOR_SUBDIR);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'state.json');
  const state: Record<string, unknown> = {
    adwId,
    agentName: ORCHESTRATOR_AGENT_NAME,
    issueNumber: 0,
    workflowStage: 'awaiting_merge',
    ...extra,
  };
  writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Before / After hooks — scoped to @adw-530
// ---------------------------------------------------------------------------

Before({ tags: '@adw-530' }, async function (this: RegressionWorld) {
  this.mockContext = await setupMockInfrastructure();
  seededAdwIds.clear();
});

After({ tags: '@adw-530' }, async function (this: RegressionWorld) {
  // Remove the production state dirs this feature wrote (never the whole agents/ tree).
  for (const adwId of seededAdwIds) {
    const dir = join(AGENTS_STATE_DIR, adwId);
    if (existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
  seededAdwIds.clear();

  // Remove temp worktrees created by G6 / G11.
  for (const [, dir] of this.worktreePaths) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }

  await teardownMockInfrastructure();
  this.mockContext = null;
  this.worktreePaths.clear();
  this.prsByBranch.clear();
  this.targetBranch = '';
  this.harnessEnv = {};
});

// ---------------------------------------------------------------------------
// Given — top-level state seeding
// ---------------------------------------------------------------------------

Given(
  'the branchName {string} is recorded in the top-level state for adwId {string}',
  function (this: RegressionWorld, branchName: string, adwId: string) {
    seedTopLevelState(this, adwId, { branchName });
  },
);

Given(
  'the top-level state for adwId {string} records no branchName',
  function (this: RegressionWorld, adwId: string) {
    // Writes the production top-level state with the awaiting_merge stage but no
    // branchName, so the merge path must fall back to (or fail past) it.
    seedTopLevelState(this, adwId, {});
  },
);

// ---------------------------------------------------------------------------
// Given — orchestrator state seeding
// ---------------------------------------------------------------------------

Given(
  'the branchName {string} is recorded in the orchestrator state for adwId {string}',
  function (this: RegressionWorld, branchName: string, adwId: string) {
    seedOrchestratorState(adwId, { branchName });
  },
);

Given(
  'the orchestrator state for adwId {string} records no branchName',
  function (this: RegressionWorld, adwId: string) {
    seedOrchestratorState(adwId, {});
  },
);

Given(
  'no orchestrator state exists for adwId {string}',
  function (this: RegressionWorld, adwId: string) {
    // Guarantee findOrchestratorStatePath(adwId) resolves to null by removing any
    // orchestrator subdir under agents/{adwId}/ (the top-level state.json is a file,
    // not a subdir, so it is left intact).
    seededAdwIds.add(adwId);
    const adwDir = join(AGENTS_STATE_DIR, adwId);
    if (existsSync(adwDir)) {
      for (const entry of readdirSync(adwDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          rmSync(join(adwDir, entry.name), { recursive: true, force: true });
        }
      }
    }
  },
);

// ---------------------------------------------------------------------------
// When — execute the merge handoff (phase-import)
// ---------------------------------------------------------------------------

When(
  'the merge handoff is executed for adwId {string} and issue {int}',
  async function (this: RegressionWorld, adwId: string, issueNumber: number) {
    assert.ok(this.mockContext, 'mockContext must be initialised in a Before hook');
    const serverUrl = this.mockContext.serverUrl;
    const repoInfo: RepoInfo = { owner: 'test-owner', repo: 'test-repo' };
    const prsByBranch = this.prsByBranch;
    const worktreePaths = this.worktreePaths;

    const deps: MergeDeps = {
      // Real branch-name resolution against the real seeded artefacts.
      readTopLevelState: (id) => AgentStateManager.readTopLevelState(id),
      findOrchestratorStatePath,
      readOrchestratorState: (statePath) => AgentStateManager.readState(statePath),

      // Resolve the branch to its PR via the G21-recorded mapping; the mock has no
      // PR-list route, so the gh CLI cannot serve this.
      findPRByBranch: (branchName): RawPR | null => {
        const prNumber = prsByBranch.get(branchName);
        if (prNumber === undefined) return null;
        return { number: prNumber, state: 'OPEN', headRefName: branchName, baseRefName: 'dev' };
      },

      // Open, approved, no hitl gate — let the merge proceed.
      issueHasLabel: () => false,
      fetchPRApprovalState: () => true,

      // Worktree / logs plumbing is irrelevant to the branch-read contract.
      ensureWorktree: () => worktreePaths.get(adwId) ?? process.cwd(),
      ensureLogsDirectory: () => {
        const dir = join(AGENTS_STATE_DIR, adwId, 'logs');
        mkdirSync(dir, { recursive: true });
        return dir;
      },
      getPlanFilePath: () => '',
      planFileExists: () => false,

      // Merge as a real PUT so the recorded-request assertions observe it.
      mergeWithConflictResolution: async (prNumber: number) => {
        await fetch(
          `${serverUrl}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}/merge`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ merge_method: 'merge' }),
          },
        ).catch(() => undefined);
        return { success: true };
      },

      // Real top-level write so T1 reads the produced workflowStage artefact.
      writeTopLevelState: (id, state) => AgentStateManager.writeTopLevelState(id, state),

      // Comments are not asserted by §530; keep them inert to avoid real gh calls.
      commentOnIssue: () => undefined,
      commentOnPR: () => undefined,
    };

    await executeMerge(issueNumber, adwId, repoInfo, process.cwd(), deps);
  },
);
