/**
 * What the feature-992 scenarios share, and the hooks that reset and clean up around the scenarios that are only feature-992's.
 * A scenario that also carries another feature's tag (feature-989's protected-path outline, feature-991's upgrade outline) runs
 * that feature's hooks and none of these: they would reset the world those scenarios were built in.
 */

import assert from 'assert';
import { After, Before } from '@cucumber/cucumber';

import type { ScenarioProofResult } from '../../../adws/phases/scenarioProof.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

import { beginScenario, endScenario, s as workflowWorld } from './feature-988-world.ts';
import type { Workflow929 } from './feature-929-workflow.ts';
import type { AdwFiles } from './feature-992-adw-files.ts';
import { disposeToolchain } from './feature-992-standins.ts';

export interface State992 {
  /** Null for a worktree that is a checkout of a regen commit, whose ".adw/" is the one the upgrade committed. */
  adwFiles: AdwFiles | null;
  /** The log the scenario's dev server writes: the stand-in's, or the one a fresh repository's server was told to write. */
  devServerLog: string | null;
  /** The files of the repository's own (by path, with their content) that its default branch holds. */
  ownFiles: Readonly<Record<string, string>>;
  /** The port the scenario test phase was given for the dev server, once it has run. */
  port: number | null;
  /** A copy of the framework's hashed files, which a scenario changes to see what the content hash does. */
  fixtureFramework: string | null;
}

function freshState(): State992 {
  return { adwFiles: null, devServerLog: null, ownFiles: {}, port: null, fixtureFramework: null };
}

export const s: State992 = freshState();

function resetState(): void {
  Object.assign(s, freshState());
}

export function requireWorkflow(): Workflow929 {
  assert.ok(workflowWorld.workflow, 'Expected a workflow to have been set up first');
  return workflowWorld.workflow;
}

/** The proof the scenario test phase left on the world, where the regression suite's own steps about a scenario proof read it. */
export function requireProof(world: RegressionWorld): ScenarioProofResult {
  assert.ok(world.scenarioProofResult, "Expected the workflow's scenario test phase to have run, and to have run the scenarios");
  return world.scenarioProofResult;
}

export function registerDirectory(directory: string): void {
  workflowWorld.directories.push(directory);
}

const OWN_SCENARIOS = '@adw-992 and not @adw-988 and not @adw-989 and not @adw-991';

Before({ tags: OWN_SCENARIOS }, function () {
  beginScenario();
  resetState();
});

After({ tags: OWN_SCENARIOS }, async function () {
  await endScenario();
  disposeToolchain();
  resetState();
});
