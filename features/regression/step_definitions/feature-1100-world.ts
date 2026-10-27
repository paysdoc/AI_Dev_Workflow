/**
 * What the in-process feature-1100 scenarios share. A scenario names one workflow awaiting the merge of one pull request; the
 * steps then describe `origin`, the agent and GitHub's answers, and the merge orchestrator runs once, for real, over a real git
 * repository (see feature-1100-run.ts). The scenario that runs the orchestrator as a process is tagged `@subprocess`; the
 * `@regression and (@subprocess or @webhook)` hooks give it the mock server and the subprocess harness.
 */

import { After, Before } from '@cucumber/cucumber';
import assert from 'assert';
import { rmSync } from 'fs';
import { join } from 'path';

import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { runCleanup } from '../../regression/support/cleanup.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { Forge } from './feature-1100-forge.ts';
import type { RepoFixture } from './feature-1100-repo.ts';

export const OWNER = 'acme';
export const REPO = 'widgets';

/** Only an adwId made up for these scenarios may have its directories removed: real workflows keep theirs under the same two roots. */
const MADE_UP_ADW_ID = /^merge1100-[a-z-]+$/;

export interface Workflow {
  readonly adwId: string;
  readonly issueNumber: number;
  readonly pullRequestNumber: number;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly repo: RepoFixture;
  readonly forge: Forge;
}

export interface State1100 {
  workflow: Workflow | null;
  /** The commit a step landed on the base branch, which the resolution's merge commit must then hold. */
  landedCommit: string | null;
}

function freshState(): State1100 {
  return { workflow: null, landedCommit: null };
}

export const s: State1100 = freshState();

function resetState(): void {
  Object.assign(s, freshState());
}

export function requireWorkflow(): Workflow {
  assert.ok(s.workflow, 'Expected the scenario to have named a workflow awaiting the merge of a pull request first');
  return s.workflow;
}

export function assertOnTheWorkflowsPullRequest(pullRequestNumber: number): void {
  assert.strictEqual(pullRequestNumber, requireWorkflow().pullRequestNumber, "Expected the step to name the workflow's pull request");
}

/** Removes what an earlier run of the same adwId may have left, then again when the scenario ends. */
export function claimAdwId(world: RegressionWorld, adwId: string): void {
  assert.match(adwId, MADE_UP_ADW_ID, `Only an adwId made up for the feature-1100 scenarios (merge1100-…) may have its directories removed; got "${adwId}"`);
  const directories = [join(AGENTS_STATE_DIR, adwId), join(LOGS_DIR, adwId)];
  const remove = (): void => directories.forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  remove();
  world.cleanup.push(remove);
}

const IN_PROCESS_SCENARIOS = '@stale-merge-retry and not @subprocess';

Before({ tags: IN_PROCESS_SCENARIOS }, function () {
  resetState();
});

After({ tags: IN_PROCESS_SCENARIOS }, async function (this: RegressionWorld) {
  await runCleanup(this);
  resetState();
});
