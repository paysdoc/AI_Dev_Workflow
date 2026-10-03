/**
 * Per-scenario state of feature-963.feature, and the hooks around it. State hangs off the World, so
 * each scenario starts with none. The hooks are keyed on the feature's own tag, never `@adw-963`:
 * the flagged scenarios of features 909, 930, 959 and 960 carry that tag and must not run them.
 */

import { After, Before } from '@cucumber/cucumber';
import assert from 'assert';
import type { AgentResult } from '../../../adws/types/agentTypes.ts';
import { releaseIssueSpawnLock } from '../../../adws/triggers/spawnGate.ts';
import type { Manifest } from '../../../test/mocks/manifestSchema.ts';
import type { ManifestRefusalError } from '../../../test/mocks/manifestInterpreter.ts';
import { runCleanup } from '../../regression/support/cleanup.ts';
import { SURFACE_REPO } from '../../regression/support/mockForgeProviders.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { CucumberRun, ScenarioOutcome, ThrowawayFeature } from '../../support/cucumberChildRun.ts';

const HOOK_TAG = '@adw-g53ol8-bug-build-the-in-pro';

/** The issues whose spawn locks these scenarios read or leave in the checkout; a lock an earlier run left behind must not decide an assertion. */
const OBSERVED_LOCK_ISSUES: readonly number[] = [1005, 1031, 1032, 9631, 9632];

export interface StubWorktree {
  /** A git repository holding the stub's marker manifest. */
  readonly path: string;
  /** Payloads live here, outside the worktree, so the worktree only ever gains the edits a manifest declares. */
  readonly payloadDir: string;
  readonly manifest: Manifest;
}

export interface StubRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface AgentRunOutcome {
  readonly result?: AgentResult;
  readonly error?: unknown;
}

export interface ManifestRefusal {
  readonly manifest: string;
  readonly error: ManifestRefusalError;
}

export interface ScenarioState {
  surfaceRuns: readonly CucumberRun[];
  throwawayDirectory: string | null;
  throwawayFeature: ThrowawayFeature | null;
  throwawayScenarios: readonly ScenarioOutcome[] | null;
  stubWorktree: StubWorktree | null;
  stubRun: StubRun | null;
  agentRun: AgentRunOutcome | null;
  manifestRefusals: readonly ManifestRefusal[] | null;
}

function freshState(): ScenarioState {
  return {
    surfaceRuns: [],
    throwawayDirectory: null,
    throwawayFeature: null,
    throwawayScenarios: null,
    stubWorktree: null,
    stubRun: null,
    agentRun: null,
    manifestRefusals: null,
  };
}

const states = new WeakMap<RegressionWorld, ScenarioState>();

export function stateOf(world: RegressionWorld): ScenarioState {
  const existing = states.get(world);
  if (existing) return existing;
  const created = freshState();
  states.set(world, created);
  return created;
}

export function requireStubWorktree(world: RegressionWorld): StubWorktree {
  const { stubWorktree } = stateOf(world);
  assert.ok(stubWorktree, 'Expected a throwaway git worktree holding a stub manifest first');
  return stubWorktree;
}

function releaseObservedLocks(): void {
  OBSERVED_LOCK_ISSUES.forEach((issueNumber) => releaseIssueSpawnLock(SURFACE_REPO, issueNumber));
}

Before({ tags: HOOK_TAG }, function () {
  releaseObservedLocks();
});

// G11 pushes its removal onto the cleanup list, and no @regression hook runs for this feature.
After({ tags: HOOK_TAG }, async function (this: RegressionWorld) {
  await runCleanup(this);
  releaseObservedLocks();
});
