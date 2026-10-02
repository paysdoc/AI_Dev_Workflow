/**
 * Per-scenario state of feature-965.feature, and the hooks around it. State hangs off the World, so
 * each scenario starts with none. The hooks are keyed on the feature's own tag, never `@adw-965`:
 * the flagged scenario of feature 960 carries that tag and must not run them.
 */

import { After, Before } from '@cucumber/cucumber';
import assert from 'assert';
import { teardownMockInfrastructure } from '../../../test/mocks/test-harness.ts';
import { runCleanup } from '../../regression/support/cleanup.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

const HOOK_TAG = '@adw-mr7y3g-bug-move-the-install';

export interface GitMockRun {
  readonly status: number | null;
  readonly stdout: string;
}

export interface ScenarioState {
  /** The log the git-mock is run against; absent when MOCK_GIT_LOG is to be left out of its environment. */
  gitMockLogPath: string | undefined;
  gitMockRun: GitMockRun | null;
  /** Whether a step set the mock infrastructure up and nothing has torn it down since. */
  mockInfrastructureUp: boolean;
  /** The `gitLogPath` the last setup exposed; it stays known after the teardown. */
  exposedGitLogPath: string | null;
  /** MOCK_GIT_LOG as it was when the scenario began, so a step that changed it can be undone. */
  outerGitLog: string | undefined;
  secretStatuses: readonly number[];
}

function freshState(): ScenarioState {
  return {
    gitMockLogPath: undefined,
    gitMockRun: null,
    mockInfrastructureUp: false,
    exposedGitLogPath: null,
    outerGitLog: undefined,
    secretStatuses: [],
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

export function requireWorktree(world: RegressionWorld, adwId: string): string {
  const worktreePath = world.worktreePaths.get(adwId);
  assert.ok(worktreePath, `No worktree is registered for adwId "${adwId}": G11 must initialise it first`);
  return worktreePath;
}

export function requireMockContext(world: RegressionWorld): NonNullable<RegressionWorld['mockContext']> {
  assert.ok(world.mockContext, 'Expected the mock infrastructure to have been set up first');
  return world.mockContext;
}

export function setOrUnsetGitLog(value: string | undefined): void {
  if (value === undefined) delete process.env['MOCK_GIT_LOG'];
  else process.env['MOCK_GIT_LOG'] = value;
}

Before({ tags: HOOK_TAG }, function (this: RegressionWorld) {
  stateOf(this).outerGitLog = process.env['MOCK_GIT_LOG'];
});

// No @regression hook runs for this feature: G11 pushes its removal onto the cleanup list, and a failed scenario would otherwise leave its PATH and server to the next one.
After({ tags: HOOK_TAG }, async function (this: RegressionWorld) {
  await runCleanup(this);
  const state = stateOf(this);
  if (state.mockInfrastructureUp) {
    await teardownMockInfrastructure();
    this.mockContext = null;
  }
  setOrUnsetGitLog(state.outerGitLog);
});
