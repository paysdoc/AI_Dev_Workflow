/**
 * The Thens of the in-process feature-1100 scenarios that read what the merge run did to GitHub, to the `/resolve_conflict`
 * agent and to `origin`. The state file Then is the regression suite's own, and the Thens that read the "ADW Merge Blocked"
 * comment are in feature-1100-comment.steps.ts.
 */

import { Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';

import { AGENT_COMMIT_SUBJECT, assertIsTheConflictAgent, conflictAgentRuns } from './feature-1100-agent.ts';
import { waitsBeforeEachMergeCall } from './feature-1100-forge.ts';
import { originBranchHolds, originBranchTip } from './feature-1100-repo.ts';
import { assertOnTheWorkflowsPullRequest, requireWorkflow, s } from './feature-1100-world.ts';

const SECONDS = /^(\d+) seconds?$/;

function mergeCallsFor(pullRequestNumber: number): number {
  return requireWorkflow().forge.events.filter((event) => event.kind === 'merge' && event.prNumber === pullRequestNumber).length;
}

function seconds(text: string): number {
  const match = SECONDS.exec(text);
  assert.ok(match, `Expected a wait written as "<n> seconds", but got "${text}"`);
  return Number(match[1]) * 1000;
}

type Waits = ReadonlyMap<number, readonly number[]>;

function describeWaits(waits: Waits): string {
  const described = [...waits]
    .sort(([a], [b]) => a - b)
    .map(([call, ms]) => `${ms.map((each) => `${each / 1000} s`).join(' and ')} before merge call ${call}`);
  return described.length > 0 ? described.join(', ') : 'never';
}

function expectedWaits(table: DataTable): Waits {
  return new Map(table.hashes().map((row): [number, number[]] => [Number(row['merge call']), [seconds(row['wait before it'])]]));
}

function sortedEntries(waits: Waits): [number, readonly number[]][] {
  return [...waits].sort(([a], [b]) => a - b);
}

function assertAgentRuns(agent: string, expected: number): void {
  assertIsTheConflictAgent(agent);
  const runs = conflictAgentRuns(requireWorkflow().adwId);
  assert.strictEqual(runs, expected, `Expected the "${agent}" agent to have run ${expected} time(s), but it ran ${runs} time(s)`);
}

function assertOriginBranchHoldsAgentCommit(branch: string): void {
  const { repo } = requireWorkflow();
  const tip = originBranchTip(repo, branch);
  assert.strictEqual(tip.subject, AGENT_COMMIT_SUBJECT, `Expected "${branch}" on origin to end in the agent's commit "${AGENT_COMMIT_SUBJECT}", but it ends in "${tip.subject}" (${tip.sha})`);
  assert.strictEqual(tip.parents.length, 2, `Expected the agent's commit on "${branch}" to be a merge commit, but it has ${tip.parents.length} parent(s)`);
}

Then('GitHub was asked {int} times to merge pull request {int}', function (times: number, pullRequestNumber: number) {
  const asked = mergeCallsFor(pullRequestNumber);
  assert.strictEqual(asked, times, `Expected GitHub to be asked ${times} time(s) to merge pull request ${pullRequestNumber}, but it was asked ${asked} time(s)`);
});

Then('GitHub was never asked to merge pull request {int}', function (pullRequestNumber: number) {
  const asked = mergeCallsFor(pullRequestNumber);
  assert.strictEqual(asked, 0, `Expected GitHub never to be asked to merge pull request ${pullRequestNumber}, but it was asked ${asked} time(s)`);
});

Then('ADW waited before the later merge calls of pull request {int} as follows:', function (pullRequestNumber: number, table: DataTable) {
  assertOnTheWorkflowsPullRequest(pullRequestNumber);
  const expected = expectedWaits(table);
  const actual = waitsBeforeEachMergeCall(requireWorkflow().forge.events);
  assert.deepStrictEqual(sortedEntries(actual), sortedEntries(expected), `Expected ADW to wait ${describeWaits(expected)}, but it waited ${describeWaits(actual)}`);
});

Then('the {string} agent was never run', function (agent: string) {
  assertAgentRuns(agent, 0);
});

Then('the {string} agent ran once', function (agent: string) {
  assertAgentRuns(agent, 1);
});

Then('the branch {string} on origin holds the merge commit the {string} agent made', function (branch: string, agent: string) {
  assertIsTheConflictAgent(agent);
  assertOriginBranchHoldsAgentCommit(branch);
});

Then(
  'the branch {string} on origin holds the merge commit the {string} agent made, which merges in the commit that landed on {string}',
  function (branch: string, agent: string, baseBranch: string) {
    assertIsTheConflictAgent(agent);
    assertOriginBranchHoldsAgentCommit(branch);
    assert.ok(s.landedCommit, `Expected a commit to have landed on "${baseBranch}" while the merge ran`);
    assert.ok(originBranchHolds(requireWorkflow().repo, branch, s.landedCommit), `Expected "${branch}" on origin to hold the commit ${s.landedCommit} that landed on "${baseBranch}"`);
  },
);
