/**
 * The Givens and the When of the in-process feature-1100 scenarios. A workflow awaiting the merge of a pull request is
 * described first; then what `origin` holds, what the `/resolve_conflict` agent does and what GitHub answers to each merge call;
 * then the merge orchestrator runs. The Thens are in feature-1100-merge-then.steps.ts and feature-1100-comment.steps.ts.
 */

import { Given, When, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import { rmSync } from 'fs';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { assertIsTheConflictAgent, installConflictAgent, type AgentBehaviour } from '../../regression/step_definitions/feature-1100-agent.ts';
import { createForge, type MergeAnswer } from '../../regression/step_definitions/feature-1100-forge.ts';
import { addBranchConflicting, addBranchMergingCleanly, createRepoFixture, landConflictingCommit } from '../../regression/step_definitions/feature-1100-repo.ts';
import { runMergeOrchestrator } from '../../regression/step_definitions/feature-1100-run.ts';
import { assertOnTheWorkflowsPullRequest, claimAdwId, OWNER, REPO, requireWorkflow, s } from '../../regression/step_definitions/feature-1100-world.ts';

const MERGED = 'merged';

function assertNamesThe(what: string, expected: string, actual: string): void {
  assert.strictEqual(actual, expected, `Expected the step to name the workflow's ${what} "${expected}", but it names "${actual}"`);
}

function assertOnTheBaseBranch(baseBranch: string): void {
  assertNamesThe('base branch', requireWorkflow().baseBranch, baseBranch);
}

function toAnswer(text: string): MergeAnswer {
  return text === MERGED ? { merged: true } : { merged: false, error: text };
}

function scriptedAnswers(table: DataTable): MergeAnswer[] {
  const rows = [...table.hashes()].sort((a, b) => Number(a['merge call']) - Number(b['merge call']));
  rows.forEach((row, index) => assert.strictEqual(Number(row['merge call']), index + 1, `Expected the merge calls to be numbered 1 to ${rows.length} without gaps`));
  return rows.map((row) => toAnswer(row['GitHub answers']));
}

function installAgent(world: RegressionWorld, agent: string, behaviour: AgentBehaviour): void {
  assertIsTheConflictAgent(agent);
  installConflictAgent(world, requireWorkflow().repo.targetReposDir, behaviour);
}

Given(
  'the workflow {string} for issue {int} is awaiting the merge of pull request {int} from the branch {string} into {string}',
  function (this: RegressionWorld, adwId: string, issueNumber: number, pullRequestNumber: number, headBranch: string, baseBranch: string) {
    claimAdwId(this, adwId);
    const repo = createRepoFixture(OWNER, REPO, baseBranch);
    this.cleanup.push(() => rmSync(repo.root, { recursive: true, force: true }));
    const forge = createForge({ number: pullRequestNumber, state: 'OPEN', sourceBranch: headBranch, targetBranch: baseBranch, labels: [] });
    s.workflow = { adwId, issueNumber, pullRequestNumber, headBranch, baseBranch, repo, forge };
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber, workflowStage: 'awaiting_merge', branchName: headBranch });
  },
);

Given('the branch {string} merges cleanly into {string} on origin', function (branch: string, baseBranch: string) {
  const workflow = requireWorkflow();
  assertNamesThe('head branch', workflow.headBranch, branch);
  assertOnTheBaseBranch(baseBranch);
  addBranchMergingCleanly(workflow.repo, branch);
});

Given('the branch {string} conflicts with {string} on origin', function (branch: string, baseBranch: string) {
  const workflow = requireWorkflow();
  assertNamesThe('head branch', workflow.headBranch, branch);
  assertOnTheBaseBranch(baseBranch);
  addBranchConflicting(workflow.repo, branch);
});

Given(
  "a commit that conflicts with the branch {string} lands on {string} on origin between ADW's push and its first call to merge pull request {int}",
  function (branch: string, baseBranch: string, pullRequestNumber: number) {
    const workflow = requireWorkflow();
    assertNamesThe('head branch', workflow.headBranch, branch);
    assertOnTheBaseBranch(baseBranch);
    assertOnTheWorkflowsPullRequest(pullRequestNumber);
    workflow.forge.script.beforeFirstCall = () => {
      s.landedCommit = landConflictingCommit(workflow.repo);
    };
  },
);

Given('the {string} agent resolves the conflicts with a merge commit', function (this: RegressionWorld, agent: string) {
  installAgent(this, agent, 'resolves');
});

Given('the {string} agent fails to resolve the conflicts', function (this: RegressionWorld, agent: string) {
  installAgent(this, agent, 'fails');
});

Given('GitHub answers the calls to merge pull request {int} in this order:', function (pullRequestNumber: number, table: DataTable) {
  assertOnTheWorkflowsPullRequest(pullRequestNumber);
  requireWorkflow().forge.script.answers = scriptedAnswers(table);
});

Given('GitHub refuses every call to merge pull request {int} with {string}', function (pullRequestNumber: number, error: string) {
  assertOnTheWorkflowsPullRequest(pullRequestNumber);
  requireWorkflow().forge.script.refuseEveryCallWith = error;
});

When('the merge orchestrator runs the workflow {string}', { timeout: 180_000 }, async function (adwId: string) {
  const workflow = requireWorkflow();
  assertNamesThe('adwId', workflow.adwId, adwId);
  await runMergeOrchestrator(workflow);
});
