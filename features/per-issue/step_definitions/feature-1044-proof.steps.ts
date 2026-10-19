/**
 * Scenario-proof scenarios of feature-1044: a workflow whose worktree holds the ".adw/" that "adw_init" writes for a hand-set
 * application type, the feature files and step definition file a scenario puts in it, and a stand-in for the Gradle wrapper in
 * its root. The scenario test phase itself, and the steps about the proof it leaves, are feature-992's; the notice about a
 * missing step definition file is feature-1043's.
 */

import { Given, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { createWorkflow } from '../../regression/step_definitions/feature-929-workflow.ts';
import { s as workflowWorld } from '../../regression/step_definitions/feature-988-world.ts';
import { ADW_DIRECTORY, SCENARIOS_MD, scenarioDirectoryOf } from '../../regression/step_definitions/feature-992-adw-files.ts';
import { reportPathFor } from '../../regression/step_definitions/feature-992-junit.ts';
import { registerDirectory, requireProof, requireWorkflow, s as adwWorld } from '../../regression/step_definitions/feature-992-world.ts';
import { writeFeature, writeFile } from '../../regression/step_definitions/feature-992-worktree.ts';

import './feature-962-parameters.ts';
import { gradleRuns, installGradleWrapper, type GradleRun, type PlatformScreenshot } from './feature-1044-gradle.ts';
import { adwFilesWrittenFor } from './feature-1044-prompt.ts';
import { requireGradle, s } from './feature-1044-world.ts';

const TARGET_REPOSITORY = 'adw-fixture/void-1044';
const INIT_COMMAND = 'adw_init';
const PROOF_DIRECTORY_VARIABLE = 'ADW_PROOF_DIR';
const EXECUTION_LOG = 'execution.log';

function describeRuns(runs: readonly GradleRun[]): string {
  return JSON.stringify(runs.map(run => run.argv.join(' ')));
}

function holdFeature(tag: string, file: string, scenario: string): void {
  assert.strictEqual(file, SCENARIOS_MD, `The scenario directory is the one "${SCENARIOS_MD}" names`);
  assert.ok(adwWorld.adwFiles, 'Expected a workflow whose ".adw/" the scenario describes to have been set up first');
  writeFeature(requireWorkflow().worktreePath, scenarioDirectoryOf(adwWorld.adwFiles), tag, [{ name: scenario, steps: ['Given the application is running'] }]);
}

function installWrapper(screenshots: readonly PlatformScreenshot[]): void {
  const recordDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-1044-gradle-'));
  registerDirectory(recordDirectory);
  s.gradle = installGradleWrapper(requireWorkflow().worktreePath, recordDirectory, screenshots);
}

Given(
  'a workflow for issue {int} whose worktree holds the {string} that {string} writes for the application type {string}',
  function (issueNumber: number, directory: string, command: string, applicationType: string) {
    assert.strictEqual(directory, ADW_DIRECTORY, `The configuration ADW reads is in "${ADW_DIRECTORY}"`);
    assert.strictEqual(command, INIT_COMMAND, `The command that writes "${ADW_DIRECTORY}" is "${INIT_COMMAND}"`);
    workflowWorld.workflow = createWorkflow(issueNumber, TARGET_REPOSITORY);
    adwWorld.adwFiles = adwFilesWrittenFor(applicationType);
  },
);

Given('the worktree holds a feature tagged {string} in the scenario directory {string} names, and no step definition file', function (tag: string, file: string) {
  holdFeature(tag, file, `The scenario of ${tag}`);
});

Given(
  'the worktree holds a feature tagged {string} in the scenario directory {string} names, whose one scenario is {string}, and steps for it in the file {string}',
  function (tag: string, file: string, scenario: string, stepFile: string) {
    holdFeature(tag, file, scenario);
    writeFile(requireWorkflow().worktreePath, stepFile, `// The step definitions of the scenarios tagged ${tag}.\n`);
  },
);

Given("the worktree's Gradle wrapper is a stand-in that records each run and writes a JUnit report in which every scenario passes", function () {
  installWrapper([]);
});

Given(
  "the worktree's Gradle wrapper is a stand-in that runs each scenario of the tag once on each of these platforms, saves its screenshot under the platform's directory in {string}, and reports every run as a {reportedStepStatus} test case named after the scenario that attaches the screenshot by its path from the JUnit report's directory:",
  function (variable: string, status: string, table: DataTable) {
    assert.strictEqual(variable, PROOF_DIRECTORY_VARIABLE, `The directory the screenshots go to is "${PROOF_DIRECTORY_VARIABLE}"`);
    assert.strictEqual(status, 'passed', `The stand-in reports passed test cases, not "${status}" ones`);
    installWrapper(table.hashes().map(({ platform, screenshot }) => ({ platform, screenshot })));
  },
);

Then("the Gradle wrapper ran the task {string} from the worktree's root once for each of these cucumber tag filters:", function (task: string, table: DataTable) {
  const runs = gradleRuns(requireGradle());
  const expected = table.hashes().map(row => row['tag filter']);
  assert.deepStrictEqual(
    runs.map(run => run.tagFilter).sort(),
    [...expected].sort(),
    `Expected the Gradle wrapper to run once for each of ${expected.join(', ')}, but it ran: ${describeRuns(runs)}`,
  );

  const root = fs.realpathSync(requireWorkflow().worktreePath);
  runs.forEach((run) => {
    assert.strictEqual(run.argv[0], task, `Expected the run for ${run.tagFilter} to run the task "${task}", but it ran: ${run.argv.join(' ')}`);
    assert.strictEqual(run.cwd, root, `Expected the run for ${run.tagFilter} to run in the worktree's root`);
  });
});

Then(
  "each of those runs was given {string} holding the scenario proof's report path for its tag, and {string} holding the scenario proof's artifacts directory",
  function (this: RegressionWorld, reportVariable: string, proofVariable: string) {
    const proof = requireProof(this);
    const runs = gradleRuns(requireGradle());
    assert.ok(runs.length > 0, 'Expected the Gradle wrapper to have been run');

    runs.forEach((run) => {
      assert.ok(run.tagFilter, `Expected every run to be given a cucumber tag filter, but one ran: ${run.argv.join(' ')}`);
      assert.strictEqual(run.env[reportVariable], reportPathFor(proof, run.tagFilter), `Expected "${reportVariable}" to hold the scenario proof's report path for ${run.tagFilter}`);
      assert.strictEqual(run.env[proofVariable], proof.artifactsDir, `Expected "${proofVariable}" to hold the scenario proof's artifacts directory, for ${run.tagFilter}`);
    });
  },
);

Then('the scenario test phase started no dev server', function () {
  const logFile = path.join(requireWorkflow().config.orchestratorStatePath, EXECUTION_LOG);
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '';
  assert.ok(log.includes('Starting scenario test phase'), `Expected the scenario test phase to have started, but the execution log says:\n${log}`);
  assert.ok(!log.includes('starting the dev server'), `Expected the scenario test phase to start no dev server, but the execution log says:\n${log}`);
});

Then('the scenario proof gives {string} exactly these images, by their path in {string}:', function (this: RegressionWorld, scenario: string, variable: string, table: DataTable) {
  assert.strictEqual(variable, PROOF_DIRECTORY_VARIABLE, `The images are in the directory "${PROOF_DIRECTORY_VARIABLE}" names`);
  const given = requireProof(this).perIssueImages.filter(image => image.scenario === scenario).map(image => image.relPath);
  assert.deepStrictEqual(given.sort(), table.hashes().map(row => row.image).sort(), `Expected the scenario proof to give "${scenario}" exactly these images`);
});
