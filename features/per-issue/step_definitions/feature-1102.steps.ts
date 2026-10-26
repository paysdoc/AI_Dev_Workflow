/**
 * Scenarios of feature-1102: what the scenario proof and the BDD Proof comment say of a tag whose scenario runner wrote no JUnit
 * report. The workflow, the stand-in scenario command and the scenario test phase run with feature-992's steps over the worlds
 * those steps use, which the hooks here bring up and clean up; every reset is safe to run twice. The steps here describe a runner
 * that writes no report or an empty one, run the real proof publish phase over the proof the test phase left, and read that proof
 * and the comment the recording code host received.
 */

import { After, Before, Given, Then, When, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';

import { executeProofPublishPhase } from '../../../adws/phases/proofPublishPhase.ts';

import { beginScenario, endScenario } from '../../regression/step_definitions/feature-988-world.ts';
import { ADW_DIRECTORY, setRunScenariosByTag } from '../../regression/step_definitions/feature-992-adw-files.ts';
import { requireAdwFiles } from '../../regression/step_definitions/feature-992-phase.steps.ts';
import { ScenarioReport } from '../../regression/step_definitions/feature-992-standin-source.ts';
import { disposeToolchain, standIns, toolchain } from '../../regression/step_definitions/feature-992-standins.ts';
import { requireProof, requireWorkflow, resetState as resetState992 } from '../../regression/step_definitions/feature-992-world.ts';
import { world796 } from '../../regression/step_definitions/feature-796.steps.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';

import { sectionOf, summaryRowsIn, warningsIn } from './feature-1102-lines.ts';

const OWN_SCENARIOS = '@adw-1102';

Before({ tags: OWN_SCENARIOS }, function () {
  beginScenario();
  resetState992();
});

After({ tags: OWN_SCENARIOS }, async function () {
  await endScenario();
  disposeToolchain();
  resetState992();
});

function useStandInScenarioCommand(directory: string, scenarioExitCode: number, scenarioReport: ScenarioReport): void {
  assert.strictEqual(directory, ADW_DIRECTORY, `The scenarios describe the repository's "${ADW_DIRECTORY}"`);
  setRunScenariosByTag(requireAdwFiles(), `"${standIns().scenarioCommand}" {tag}`);
  toolchain.behaviour = { ...toolchain.behaviour, scenarioExitCode, scenarioReport };
}

function scenarioProofDocument(world: RegressionWorld): string {
  return fs.readFileSync(requireProof(world).resultsFilePath, 'utf-8');
}

function warningsOfSection(world: RegressionWorld, tag: string): string[] {
  return warningsIn(sectionOf(scenarioProofDocument(world), tag));
}

function recordedCommentOn(prNumber: number): string {
  const comment = world796().activeCallLog.find(({ operation, args }) => operation === 'commentOnPullRequest' && args[0] === prNumber);
  assert.ok(comment, `Expected the code host to have recorded a comment on pull request ${prNumber}`);
  return String(comment.args[1]);
}

Given(
  "the worktree's {string} runs scenarios by tag with a stand-in that records each run, exits 0, and writes no JUnit report",
  function (directory: string) {
    useStandInScenarioCommand(directory, 0, ScenarioReport.None);
  },
);

Given(
  "the worktree's {string} runs scenarios by tag with a stand-in that records each run, exits 1, and writes no JUnit report",
  function (directory: string) {
    useStandInScenarioCommand(directory, 1, ScenarioReport.None);
  },
);

Given(
  "the worktree's {string} runs scenarios by tag with a stand-in that records each run, exits 0, and writes a JUnit report with no test case",
  function (directory: string) {
    useStandInScenarioCommand(directory, 0, ScenarioReport.Empty);
  },
);

When("the workflow's proof publish phase runs for pull request {int}", async function (prNumber: number) {
  const { config } = requireWorkflow();
  assert.ok(config.repoContext, "Expected the workflow to be bound to the repository's code host");
  assert.ok(config.ctx.scenarioProof, "Expected the workflow's scenario test phase to have left a scenario proof on its context");
  const { owner, repo } = config.repoContext.repoId;
  config.ctx.prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
  await executeProofPublishPhase(config);
});

Then(
  "the scenario proof's section for the tag {string} has the warning {string}",
  function (this: RegressionWorld, tag: string, warning: string) {
    const warnings = warningsOfSection(this, tag);
    assert.ok(warnings.includes(warning), `Expected the scenario proof's section for ${tag} to have the warning "${warning}", but its warnings are: ${JSON.stringify(warnings)}`);
  },
);

Then("the scenario proof's section for the tag {string} has no warning", function (this: RegressionWorld, tag: string) {
  const warnings = warningsOfSection(this, tag);
  assert.deepStrictEqual(warnings, [], `Expected the scenario proof's section for ${tag} to have no warning, but its warnings are: ${JSON.stringify(warnings)}`);
});

Then('the scenario proof does not contain {string}', function (this: RegressionWorld, text: string) {
  const document = scenarioProofDocument(this);
  assert.ok(!document.includes(text), `Expected the scenario proof not to contain "${text}", got:\n${document}`);
});

Then('the recorded comment on pull request {int} does not contain {string}', function (prNumber: number, text: string) {
  const comment = recordedCommentOn(prNumber);
  assert.ok(!comment.includes(text), `Expected the recorded comment on pull request ${prNumber} not to contain "${text}", got:\n${comment}`);
});

Then('the recorded comment on pull request {int} has exactly these rows in its summary table:', function (prNumber: number, table: DataTable) {
  const comment = recordedCommentOn(prNumber);
  const expected = table.hashes().map(({ suite, scenarios, status }) => ({ suite, scenarios, status }));
  assert.deepStrictEqual(summaryRowsIn(comment), expected, `Expected the summary table of the recorded comment on pull request ${prNumber} to have exactly the rows the scenario lists, got:\n${comment}`);
});
