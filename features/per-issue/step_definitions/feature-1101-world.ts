/**
 * What the in-process feature-1101 scenarios share. A scenario names one workflow awaiting the merge of one pull request; the
 * Givens then describe `origin`, the scenario runner, the agent and GitHub's answers, and adwMerge runs for real over a real
 * git repository (feature-1101-run.ts). The cron scenario and the subprocess scenario have steps of their own and no state here.
 *
 * The mock infrastructure is not set up: its git wrapper would turn every fetch and push of the merge run into a no-op. What
 * the Thens read from "the mock GitHub API" is the mock server's request log, which the forge stand-in writes to in process.
 */

import { After, Before } from '@cucumber/cucumber';
import assert from 'assert';
import { rmSync } from 'fs';
import { join } from 'path';

import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { applyState, getRecordedRequests, resetMockServer } from '../../../test/mocks/github-api-server.ts';
import type { MockContext } from '../../../test/mocks/types.ts';
import { runCleanup } from '../../regression/support/cleanup.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import type { Forge } from '../../regression/step_definitions/feature-1100-forge.ts';
import type { RepoFixture } from '../../regression/step_definitions/feature-1100-repo.ts';
import type { ScenarioRow } from './feature-1101-standin.ts';

export interface Workflow {
  readonly adwId: string;
  readonly issueNumber: number;
  readonly pullRequestNumber: number;
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly repo: RepoFixture;
  readonly forge: Forge;
  /** Whether the feature branch is on origin yet: the first step that needs it puts it there, off the base branch as it then is. */
  branchPushed: boolean;
  scenarios: readonly ScenarioRow[];
  /** The branch on origin as each run of adwMerge found it, which is what the commits merged in are counted from. */
  runs: { readonly branchTipBefore: string }[];
}

export interface State1101 {
  workflow: Workflow | null;
}

export const s: State1101 = { workflow: null };

export function requireWorkflow(): Workflow {
  assert.ok(s.workflow, 'Expected the scenario to have named a workflow awaiting the merge of a pull request first');
  return s.workflow;
}

export function assertNamesThe(what: string, expected: string | number, actual: string | number): void {
  assert.strictEqual(actual, expected, `Expected the step to name the workflow's ${what} "${expected}", but it names "${actual}"`);
}

/** Only an adwId made up for these scenarios may have its directories removed: real workflows keep theirs under the same two roots. */
const MADE_UP_ADW_ID = /^rerun1101-[a-z-]+$/;

/** Removes what an earlier run of the same adwId may have left, then again when the scenario ends. */
export function claimAdwId(world: RegressionWorld, adwId: string): void {
  assert.match(adwId, MADE_UP_ADW_ID, `Only an adwId made up for the feature-1101 scenarios (rerun1101-…) may have its directories removed; got "${adwId}"`);
  const directories = [join(AGENTS_STATE_DIR, adwId), join(LOGS_DIR, adwId)];
  const remove = (): void => directories.forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  remove();
  world.cleanup.push(remove);
}

function requestLogOnly(): MockContext {
  return {
    serverUrl: '',
    port: 0,
    gitLogPath: '',
    getRecordedRequests,
    setState: async (state) => applyState(state),
    teardown: async () => resetMockServer(),
  };
}

const IN_PROCESS_SCENARIOS = '@adw-1101 and not @regression and not @subprocess and not @dead-orchestrator-takeover';

Before({ tags: IN_PROCESS_SCENARIOS }, function (this: RegressionWorld) {
  s.workflow = null;
  resetMockServer();
  this.mockContext = requestLogOnly();
});

After({ tags: IN_PROCESS_SCENARIOS }, async function (this: RegressionWorld) {
  await runCleanup(this);
  resetMockServer();
  this.mockContext = null;
  this.claudeCliStandIn = undefined;
  s.workflow = null;
});
