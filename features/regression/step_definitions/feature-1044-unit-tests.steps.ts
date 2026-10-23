/**
 * Unit-test scenarios of feature-1044: the "## Run Tests" command of the ".adw/" that "adw_init" writes for a hand-set
 * application type, run from the worktree's root as the "/test" agent runs it, over a stand-in for the Gradle wrapper, and the
 * JUnit report ADW then reads with the parser of the unit-test phase. The workflow and its ".adw/" are the scenario-proof
 * scenarios' steps.
 */

import { Given, Then, When, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import type { ProcessOutcome } from '../../../adws/core/checkRunner.ts';
import { buildClaudeLaunchEnv } from '../../../adws/core/environment.ts';
import { loadProjectConfig } from '../../../adws/core/projectConfig.ts';
import { readJUnitReport } from '../../../adws/core/testReportParser.ts';

import { COMMANDS_MD, writeAdwFiles } from '../../regression/step_definitions/feature-992-adw-files.ts';
import { requireWorkflow, s as adwWorld } from '../../regression/step_definitions/feature-992-world.ts';

import { TEST_RESULTS_DIRECTORY, TEST_STATUSES, TEST_TASK, type TestClassReport } from './feature-1044-gradle.ts';
import { installWrapper } from './feature-1044-proof.steps.ts';
import { s, type TestRun } from './feature-1044-world.ts';

const RUN_TESTS = '## Run Tests';
const UNIT_REPORT_VARIABLE = 'ADW_UNIT_TEST_REPORT_PATH';
/** The file in the workflow's logs directory that the unit-test phase points the variable at. */
const UNIT_REPORT_FILE = 'junit-unit.xml';

type TestCaseRow = Readonly<Record<'test class' | 'test case' | 'status', string>>;

const byTestCase = (a: TestCaseRow, b: TestCaseRow): number => a['test case'].localeCompare(b['test case']);

function assertRunTests(heading: string): void {
  assert.strictEqual(heading, RUN_TESTS, `The command the "/test" agent runs is the one under "${RUN_TESTS}"`);
}

function assertReportVariable(variable: string): void {
  assert.strictEqual(variable, UNIT_REPORT_VARIABLE, `The unit-test phase passes the path of the report in "${UNIT_REPORT_VARIABLE}"`);
}

function requireTestRun(): TestRun {
  assert.ok(s.testRun, `Expected the worktree's "${RUN_TESTS}" command to have been run first`);
  return s.testRun;
}

/**
 * As the "/test" agent's shell runs it: in the environment ADW starts that agent with, which passes the report path on. The
 * harness's own environment would also pass on its `NODE_OPTIONS`, which the stand-in's Node would resolve from the worktree.
 */
function runAsTestAgent(command: string, cwd: string): ProcessOutcome {
  const run = spawnSync(command, { cwd, env: buildClaudeLaunchEnv(), shell: true, encoding: 'utf-8' });
  return { exitCode: run.status, output: `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? String(run.error) : ''}` };
}

function testClassReport(row: Readonly<Record<string, string>>): TestClassReport {
  const status = TEST_STATUSES.find(known => known === row.status);
  assert.ok(status, `A test case of the stand-in passes or fails, not "${row.status}"`);
  return { module: row.module, testClass: row['test class'], testCase: row['test case'], status };
}

Given(
  "the worktree's Gradle wrapper is a stand-in that, run for the task {string}, writes the JUnit report of each of these test classes under its module's {string} directory, and exits with code {int}:",
  function (task: string, directory: string, exitCode: number, table: DataTable) {
    assert.strictEqual(task, TEST_TASK, `The stand-in writes the reports of the unit tests when it is run for the task "${TEST_TASK}"`);
    assert.strictEqual(directory, TEST_RESULTS_DIRECTORY, `Gradle writes the JUnit reports of a module's tests under its "${TEST_RESULTS_DIRECTORY}"`);
    installWrapper([], { reports: table.hashes().map(testClassReport), exitCode });
  },
);

When(
  "the {string} command of the worktree's {string} is run as written from the worktree's root, with {string} holding the unit-test phase's report path",
  function (heading: string, file: string, variable: string) {
    assertRunTests(heading);
    assert.strictEqual(file, COMMANDS_MD, `The commands ADW runs are in "${COMMANDS_MD}"`);
    assertReportVariable(variable);
    assert.ok(adwWorld.adwFiles, 'Expected a workflow whose ".adw/" the scenario describes to have been set up first');
    const { worktreePath, logsDir } = requireWorkflow();
    writeAdwFiles(worktreePath, adwWorld.adwFiles);
    const reportPath = path.join(logsDir, UNIT_REPORT_FILE);
    fs.rmSync(reportPath, { force: true });
    // The unit-test phase hands the path on through its own environment; the After hook puts the variable back.
    process.env[UNIT_REPORT_VARIABLE] = reportPath;
    s.testRun = { reportPath, outcome: runAsTestAgent(loadProjectConfig(worktreePath).commands.runTests, worktreePath) };
  },
);

Then('ADW reads exactly these test cases from the JUnit report at {string}:', function (variable: string, table: DataTable) {
  assertReportVariable(variable);
  const { reportPath, outcome } = requireTestRun();
  const report = readJUnitReport(reportPath);
  assert.ok(report, `Expected a JUnit report ADW can read at the path in "${variable}", but it reads none there. The command printed:\n${outcome.output}`);
  const read = report.cases.map((testCase): TestCaseRow => ({ 'test class': testCase.classname ?? '', 'test case': testCase.name, status: testCase.status }));
  assert.deepStrictEqual(
    [...read].sort(byTestCase),
    [...(table.hashes() as TestCaseRow[])].sort(byTestCase),
    `Expected ADW to read exactly these test cases from the report at the path in "${variable}"`,
  );
});

Then('the {string} command exited with code {int}', function (heading: string, exitCode: number) {
  assertRunTests(heading);
  const { outcome } = requireTestRun();
  assert.strictEqual(outcome.exitCode, exitCode, `Expected "${heading}" to exit with code ${exitCode}, but it exited with ${outcome.exitCode ?? 'none'}. It printed:\n${outcome.output}`);
});
