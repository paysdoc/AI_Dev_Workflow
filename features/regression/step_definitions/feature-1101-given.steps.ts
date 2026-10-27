/**
 * The Givens of the in-process feature-1101 scenarios. A workflow awaiting the merge of a pull request is described first; then
 * what `origin` holds, what the `/resolve_conflict` agent does, which scenarios the branch holds and how the repository runs
 * them, and what GitHub answers to the merge calls. The When is in feature-1101-when.steps.ts.
 */

import { Given, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import { rmSync } from 'fs';

import { AgentStateManager } from '../../../adws/core/agentState.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { assertIsTheConflictAgent, installConflictAgent } from './feature-1100-agent.ts';
import { createRepoFixture, originBranchHolds, SHARED_FILE } from './feature-1100-repo.ts';
import { OWNER, REPO } from './feature-1100-world.ts';
import { adwConfiguration, FEATURE_FILE, featureFile, stepDefinitionFiles } from './feature-1101-content.ts';
import { createRecordingForge, mergedAnswers, refusedThenMergedAnswers } from './feature-1101-forge.ts';
import { baseTipOnOrigin, commitOnBranch, ensureBranchPushed, landOnBase, NO_CONFLICT } from './feature-1101-repo.ts';
import { describeScenarios, installStandIn, parseResult, recordLandedCommit, runByTagCommand, type ScenarioRow } from './feature-1101-standin.ts';
import { assertNamesThe, claimAdwId, requireWorkflow, s } from './feature-1101-world.ts';

const COMMIT = 'commit';
const CONFLICTS_IN = 'conflicts with the branch in';

function requireBranch(branch: string, baseBranch?: string) {
  const workflow = requireWorkflow();
  assertNamesThe('head branch', workflow.headBranch, branch);
  if (baseBranch !== undefined) assertNamesThe('base branch', workflow.baseBranch, baseBranch);
  return workflow;
}

function scenarioRows(table: DataTable): ScenarioRow[] {
  return table.hashes().map((row) => ({ tag: row['tag'], scenario: row['scenario'], result: parseResult(row['result']) }));
}

Given(
  'the workflow {string} for issue {int} is at {string} with pull request {int} open from the branch {string} into {string}',
  function (this: RegressionWorld, adwId: string, issueNumber: number, stage: string, pullRequestNumber: number, headBranch: string, baseBranch: string) {
    claimAdwId(this, adwId);
    const repo = createRepoFixture(OWNER, REPO, baseBranch);
    this.cleanup.push(() => rmSync(repo.root, { recursive: true, force: true }));
    const forge = createRecordingForge({ number: pullRequestNumber, state: 'OPEN', sourceBranch: headBranch, targetBranch: baseBranch, labels: [] });
    s.workflow = { adwId, issueNumber, pullRequestNumber, headBranch, baseBranch, repo, forge, branchPushed: false, scenarios: [], runs: [] };
    AgentStateManager.writeTopLevelState(adwId, { adwId, issueNumber, workflowStage: stage, branchName: headBranch });
  },
);

Given('{string} on origin holds these commits that the branch {string} does not:', function (baseBranch: string, branch: string, table: DataTable) {
  const workflow = requireBranch(branch, baseBranch);
  ensureBranchPushed(workflow);
  for (const row of table.hashes()) recordLandedCommit(workflow.repo, landOnBase(workflow.repo, row[COMMIT], row[CONFLICTS_IN]));
});

Given('the branch {string} on origin already holds the tip of {string}', function (branch: string, baseBranch: string) {
  const workflow = requireBranch(branch, baseBranch);
  ensureBranchPushed(workflow);
  const tip = baseTipOnOrigin(workflow.repo);
  assert.ok(originBranchHolds(workflow.repo, branch, tip), `Expected "${branch}" on origin to hold the tip of "${baseBranch}" (${tip})`);
});

Given(
  'the commit {string}, which conflicts with the branch in {string}, lands on {string} on origin as adwMerge first asks GitHub to merge pull request {int}',
  function (subject: string, file: string, baseBranch: string, pullRequestNumber: number) {
    const workflow = requireWorkflow();
    assertNamesThe('base branch', workflow.baseBranch, baseBranch);
    assertNamesThe('pull request', workflow.pullRequestNumber, pullRequestNumber);
    assert.notStrictEqual(file, NO_CONFLICT, 'Expected the commit to conflict with the branch in a file');
    ensureBranchPushed(workflow);
    workflow.forge.script.beforeFirstCall = () => recordLandedCommit(workflow.repo, landOnBase(workflow.repo, subject, file));
  },
);

Given('the {string} agent, if it is run, resolves the conflict in {string} with a merge commit', function (this: RegressionWorld, agent: string, file: string) {
  assertIsTheConflictAgent(agent);
  assert.strictEqual(file, SHARED_FILE, `Only the conflict in "${SHARED_FILE}" is resolved by the stand-in agent, but the step names "${file}"`);
  installConflictAgent(this, requireWorkflow().repo.targetReposDir, 'resolves');
});

Given('the repository runs its scenarios by tag with a stand-in that records each run', function () {
  installStandIn(requireWorkflow().repo);
});

Given(
  'the branch {string} holds these scenarios, which pass on the branch alone and end as follows on the branch merged with {string}:',
  function (branch: string, baseBranch: string, table: DataTable) {
    const workflow = requireBranch(branch, baseBranch);
    ensureBranchPushed(workflow);
    const rows = scenarioRows(table);
    workflow.scenarios = rows;
    describeScenarios(workflow.repo, rows);
    const files = { ...adwConfiguration(runByTagCommand(workflow.repo)), ...stepDefinitionFiles(), [FEATURE_FILE]: featureFile(rows) };
    commitOnBranch(workflow.repo, branch, files, 'Add the scenarios');
  },
);

Given('the repository has no scenarios configured', function () {
  const workflow = requireWorkflow();
  ensureBranchPushed(workflow);
  commitOnBranch(workflow.repo, workflow.headBranch, adwConfiguration(null), 'Add the ADW configuration');
});

Given('GitHub merges pull request {int} when asked', function (pullRequestNumber: number) {
  const workflow = requireWorkflow();
  assertNamesThe('pull request', workflow.pullRequestNumber, pullRequestNumber);
  workflow.forge.script.answers = mergedAnswers();
});

Given(
  'GitHub refuses the first call to merge pull request {int} with {string} and merges it when asked again',
  function (pullRequestNumber: number, error: string) {
    const workflow = requireWorkflow();
    assertNamesThe('pull request', workflow.pullRequestNumber, pullRequestNumber);
    workflow.forge.script.answers = refusedThenMergedAnswers(error);
  },
);
