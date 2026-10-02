/**
 * Plan-phase and commit-agent steps for feature-930.feature; the worktree-setup scenarios are in
 * feature-930-worktree-setup.steps.ts. The plan phase runs in-process against the fixture in
 * feature-930-plan-fixture.ts.
 */

import { Before, After, Given, When, Then, setDefaultTimeout, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as path from 'path';

import { executePlanPhase } from '../../../adws/phases/planPhase.ts';
import { runCommitAgent } from '../../../adws/agents/gitAgent.ts';
import {
  git, commitFiles, contentsOnBranch, appendLine, uncommittedPaths, commitsSince, pathsInCommit,
} from './feature-930-fixtures.ts';
import {
  type PlanScenario, newPlanScenario, removeScenarioFiles, flushManifest, installClaudeCliStandIn, restoreClaudeCli,
  buildIssue, buildWorkflowConfig, asChange, planPlannerChange, leaveChangeInWorktree, planPlanFile,
} from './feature-930-plan-fixture.ts';

setDefaultTimeout(60_000);

let current: PlanScenario | null = null;

function scenario(): PlanScenario {
  assert.ok(current, 'Expected a worktree for a workflow to have been set up first');
  return current;
}

Before({ tags: '@adw-930' }, function () {
  current = null;
});

After({ tags: '@adw-930' }, function () {
  restoreClaudeCli();
  if (current) removeScenarioFiles(current);
  current = null;
});

Given(
  'a worktree for a workflow on issue {int} in the target repository {string}',
  function (issueNumber: number, repoFullName: string) {
    current = newPlanScenario(issueNumber, repoFullName);
  },
);

Given("the worktree's branch tracks these files:", function (table: DataTable) {
  const sc = scenario();
  const files = Object.fromEntries(table.hashes().map(({ path: p }) => [p, contentsOnBranch(p)]));
  commitFiles(sc.worktreePath, files, 'track files on the branch');
});

Given('the worktree has uncommitted changes to these files:', function (table: DataTable) {
  const sc = scenario();
  table.hashes().forEach(({ path: p }) => appendLine(sc.worktreePath, p, 'uncommitted change'));
});

Given('worktree setup has left these changes in the worktree:', function (table: DataTable) {
  const sc = scenario();
  table.hashes().forEach(({ change, path: p }) => leaveChangeInWorktree(sc, asChange(change), p));
});

Given(
  'the Claude CLI is a stand-in that stages every change in the worktree and commits it whenever it is asked to commit',
  function () {
    installClaudeCliStandIn(scenario());
  },
);

Given('the planner writes the plan file and makes these changes in the worktree:', function (table: DataTable) {
  const sc = scenario();
  planPlanFile(sc);
  table.hashes().forEach(({ change, path: p }) => planPlannerChange(sc, asChange(change), p));
});

Given('the planner writes only the plan file', function () {
  planPlanFile(scenario());
});

Given(
  'the planner writes the plan file, modifies {string} and commits everything itself',
  function (relPath: string) {
    const sc = scenario();
    planPlanFile(sc);
    planPlannerChange(sc, 'modifies', relPath);
    sc.manifest.commitAll = { subject: 'planner: commit everything in the worktree' };
  },
);

When('the plan phase runs', async function () {
  const sc = scenario();
  flushManifest(sc);
  sc.headBefore = git(sc.worktreePath, 'rev-parse', 'HEAD');
  try {
    await executePlanPhase(buildWorkflowConfig(sc));
  } catch (err) {
    sc.phaseError = err instanceof Error ? err : new Error(String(err));
  }
});

When('the {string} commits its work through the commit agent, as its phase does', async function (agentName: string) {
  const sc = scenario();
  flushManifest(sc);
  sc.headBefore = git(sc.worktreePath, 'rev-parse', 'HEAD');
  const issue = buildIssue(sc);
  await runCommitAgent(
    agentName, '/feature', JSON.stringify(issue), path.join(sc.root, 'logs'), undefined, sc.worktreePath,
    issue.body, sc.gitContext.commandEnv(), { selfHost: false, adwId: sc.adwId, gitContext: sc.gitContext },
  );
});

function pathsCommittedDuringPhase(sc: PlanScenario): string[] {
  return commitsSince(sc.worktreePath, sc.headBefore).flatMap((sha) => pathsInCommit(sc.worktreePath, sha));
}

Then('the plan phase completes', function () {
  const sc = scenario();
  assert.strictEqual(sc.phaseError, null, `Expected the plan phase to complete, but it failed: ${sc.phaseError?.message}`);
});

Then('the plan phase fails with an error that names {string}', function (relPath: string) {
  const sc = scenario();
  assert.ok(sc.phaseError, 'Expected the plan phase to fail, but it completed');
  assert.ok(sc.phaseError.message.includes(relPath), `Expected the error to name "${relPath}", got: ${sc.phaseError.message}`);
});

Then('the commits added during the plan phase carry the plan file and no other path', function () {
  const sc = scenario();
  assert.ok(commitsSince(sc.worktreePath, sc.headBefore).length > 0, 'Expected the plan phase to add a commit');
  assert.deepStrictEqual([...new Set(pathsCommittedDuringPhase(sc))], [sc.planFile]);
});

Then('no commit added during the plan phase carries {string}', function (relPath: string) {
  const sc = scenario();
  assert.ok(!pathsCommittedDuringPhase(sc).includes(relPath), `Expected no commit added during the plan phase to carry "${relPath}"`);
});

Then('the worktree still has uncommitted changes to these files:', function (table: DataTable) {
  const sc = scenario();
  const uncommitted = uncommittedPaths(sc.worktreePath);
  table.hashes().forEach(({ path: p }) => {
    assert.ok(uncommitted.includes(p), `Expected an uncommitted change to "${p}"; uncommitted: ${uncommitted.join(', ') || '(none)'}`);
  });
});

Then('the commit recorded on the worktree branch carries these files:', function (table: DataTable) {
  const sc = scenario();
  const commits = commitsSince(sc.worktreePath, sc.headBefore);
  assert.strictEqual(commits.length, 1, `Expected exactly one commit on the worktree branch, found ${commits.length}`);
  const carried = pathsInCommit(sc.worktreePath, commits[0]);
  table.hashes().forEach(({ path: p }) => {
    assert.ok(carried.includes(p), `Expected the commit to carry "${p}"; it carries: ${carried.join(', ')}`);
  });
});
