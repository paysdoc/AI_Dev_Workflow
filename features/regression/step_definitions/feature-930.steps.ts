/**
 * Plan-phase steps for feature-930.feature and the plan-phase scenarios of feature-1077.feature; the
 * worktree-setup scenarios are in feature-930-worktree-setup.steps.ts. The plan phase runs in-process
 * against the fixture in feature-930-plan-fixture.ts.
 */

import { Before, After, Given, When, Then, setDefaultTimeout, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';

import { executePlanPhase } from '../../../adws/phases/planPhase.ts';
import {
  git, commitFiles, contentsOnBranch, appendLine, readRepoFile, repoFileExists, uncommittedPaths, commitsSince,
} from './feature-930-fixtures.ts';
import {
  type PlanScenario, newPlanScenario, removeScenarioFiles, flushManifest, installClaudeCliStandIn, restoreClaudeCli,
  buildWorkflowConfig, asChange, planPlannerChange, planPlanFile, PLAN_FILE_CONTENTS,
} from './feature-930-plan-fixture.ts';

setDefaultTimeout(60_000);

let current: PlanScenario | null = null;

function scenario(): PlanScenario {
  assert.ok(current, 'Expected a worktree for a workflow to have been set up first');
  return current;
}

Before({ tags: '@plan-worktree-only' }, function () {
  current = null;
});

After({ tags: '@plan-worktree-only' }, function () {
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

Then('the plan phase completes', function () {
  const sc = scenario();
  assert.strictEqual(sc.phaseError, null, `Expected the plan phase to complete, but it failed: ${sc.phaseError?.message}`);
});

Then("the plan phase added no commit to the worktree's branch", function () {
  const sc = scenario();
  const added = commitsSince(sc.worktreePath, sc.headBefore);
  assert.strictEqual(git(sc.worktreePath, 'rev-parse', 'HEAD'), sc.headBefore, `Expected the plan phase to add no commit; it added: ${added.join(', ')}`);
});

Then("the worktree's branch has no commit touching {string}", function (relPath: string) {
  const sc = scenario();
  const touching = git(sc.worktreePath, 'log', '--format=%H', 'HEAD', '--', relPath);
  assert.strictEqual(touching, '', `Expected no commit on the worktree's branch to touch "${relPath}"; found: ${touching.split('\n').join(', ')}`);
});

Then('the worktree holds the plan file', function () {
  const sc = scenario();
  assert.ok(repoFileExists(sc.worktreePath, sc.planFile), `Expected the worktree to hold "${sc.planFile}"`);
  assert.strictEqual(readRepoFile(sc.worktreePath, sc.planFile), PLAN_FILE_CONTENTS);
  assert.strictEqual(git(sc.worktreePath, 'ls-files', '--', sc.planFile), '', `Expected git to track no copy of "${sc.planFile}"`);
});

Then('the worktree still has uncommitted changes to these files:', function (table: DataTable) {
  const sc = scenario();
  const uncommitted = uncommittedPaths(sc.worktreePath);
  table.hashes().forEach(({ path: p }) => {
    assert.ok(uncommitted.includes(p), `Expected an uncommitted change to "${p}"; uncommitted: ${uncommitted.join(', ') || '(none)'}`);
  });
});
