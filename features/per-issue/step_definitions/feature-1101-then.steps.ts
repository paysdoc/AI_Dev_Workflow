/**
 * The Thens of the in-process feature-1101 scenarios that read what the merge run did to `origin`, to the scenario runner and to
 * the workflow's state. The state-file, merge-call and comment-count Thens are the regression suite's own, and the Thens that
 * read the "ADW Parked" comment are in feature-1101-comment.steps.ts.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import { LOGS_DIR } from '../../../adws/core/config.ts';
import { branchHoldsBaseTip, branchTipOnOrigin } from './feature-1101-repo.ts';
import { standInRuns, type StandInRun } from './feature-1101-standin.ts';
import { assertNamesThe, requireWorkflow } from './feature-1101-world.ts';

/** The scenario fix agent writes one `resolve-e2e-<tag>.jsonl` per failed tag to the workflow's logs directory. */
const FIX_AGENT_OUTPUT = /^resolve-e2e-.*\.jsonl$/;

function fixAgentRuns(adwId: string): string[] {
  const logsDir = join(LOGS_DIR, adwId);
  return existsSync(logsDir) ? readdirSync(logsDir).filter((name) => FIX_AGENT_OUTPUT.test(name)) : [];
}

function describeRuns(runs: readonly StandInRun[]): string {
  return runs.length === 0 ? 'never' : runs.map((run) => `${run.tag} on ${run.commit}`).join(', ');
}

function assertRanEachTag(tags: readonly string[], times: number, branch: string): void {
  const workflow = requireWorkflow();
  assertNamesThe('head branch', workflow.headBranch, branch);
  const runs = standInRuns(workflow.repo);
  const tip = branchTipOnOrigin(workflow);

  for (const tag of tags) {
    const own = runs.filter((run) => run.tag === tag);
    assert.strictEqual(own.length, times, `Expected the scenario runner to run ${tag} ${times} time(s), but it ran: ${describeRuns(runs)}`);
    assert.strictEqual(own[own.length - 1]?.commit, tip, `Expected the last run of ${tag} to be on the tip of "${branch}" on origin (${tip}), but it ran: ${describeRuns(runs)}`);
  }
  assert.strictEqual(runs.length, tags.length * times, `Expected no run besides ${tags.join(' and ')}, but the scenario runner ran: ${describeRuns(runs)}`);
}

Then('the state file for adwId {string} records the park reason {string}', function (adwId: string, parkReason: string) {
  const recorded = AgentStateManager.readTopLevelState(adwId)?.parkReason;
  assert.strictEqual(recorded, parkReason, `Expected the state of "${adwId}" to record the park reason "${parkReason}", but it records "${String(recorded)}"`);
});

Then('the branch {string} on origin holds the tip of {string}', function (branch: string, baseBranch: string) {
  const workflow = requireWorkflow();
  assertNamesThe('head branch', workflow.headBranch, branch);
  assertNamesThe('base branch', workflow.baseBranch, baseBranch);
  assert.ok(branchHoldsBaseTip(workflow), `Expected "${branch}" on origin to hold the tip of "${baseBranch}"`);
});

Then('the scenario runner ran {string} and {string} once each, on the commit that the branch {string} holds on origin', function (first: string, second: string, branch: string) {
  assertRanEachTag([first, second], 1, branch);
});

Then(
  'the scenario runner ran {string} and {string} twice each, the second time on the commit that the branch {string} holds on origin',
  function (first: string, second: string, branch: string) {
    assertRanEachTag([first, second], 2, branch);
  },
);

Then('the scenario runner was not run', function () {
  const runs = standInRuns(requireWorkflow().repo);
  assert.deepStrictEqual(runs, [], `Expected the scenario runner not to run, but it ran: ${describeRuns(runs)}`);
});

Then('adwMerge started no agent to fix the failing scenario', function () {
  const started = fixAgentRuns(requireWorkflow().adwId);
  assert.deepStrictEqual(started, [], `Expected no agent to be started to fix a failing scenario, but its output was written to: ${started.join(', ')}`);
});
