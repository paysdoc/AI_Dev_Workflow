# Patch: An `@adw-1044` scenario runs the Gradle `## Run Tests` command `adw_init` writes, and checks what ADW reads from its report

## Metadata
adwId: `g0m1dk-feat-adw-init-preser`
reviewChangeRequest: ``Issue #4: No @adw-1044 scenario exercises the Gradle `## Run Tests` command that step 2 of adw_init.md writes for `mobile:kotlincm`: the issue's 'Gradle test (JUnit path wired)' (acceptance criterion 2). The scenarios read the command out of the prompt only to fill commands.md. None runs it, or asserts that it leaves ADW one JUnit report at `$ADW_UNIT_TEST_REPORT_PATH` holding every module's tests except those of `:scenarios`. All of them would still pass if the bullet said a bare `./gradlew test` that writes no report. Only unit tests check the command, and the coding guidelines say unit tests never stand in for scenario proof. Resolution: Add an @adw-1044 scenario that runs the `## Run Tests` command from the `.adw/` that adw_init writes for `mobile:kotlincm`, with `ADW_UNIT_TEST_REPORT_PATH` set. Run it in a worktree whose Gradle wrapper is a stand-in that writes per-module `build/test-results/**/TEST-*.xml` files, one of them for `:scenarios`. Assert what ADW reads from that report: every module's test cases except those of `:scenarios`, and the wrapper's exit code as the command's exit code.``

## Issue Summary
**Original Spec:** `specs/issue-1044-adw-g0m1dk-feat-adw-init-preser-sdlc_planner-mobile-kotlincm-init-descriptors.md`

**Issue:** Acceptance criterion 2 ("Gradle test (JUnit path wired)") has no scenario proof.
- Step 2 of `adw_init.md` writes this `## Run Tests` for `mobile:kotlincm`: `./gradlew test -x :scenarios:test --continue; exit_code=$?; { echo '<testsuites>'; find . -path ./scenarios -prune -o -path '*/build/test-results/*' -name 'TEST-*.xml' -exec sed 's/<?xml[^?]*?>//' {} +; echo '</testsuites>'; } > "$ADW_UNIT_TEST_REPORT_PATH"; exit $exit_code`.
- `adwFilesWrittenFor` (`feature-1044-prompt.ts`) puts that command into the `.adw/commands.md` of the proof and baseline Givens, but no step runs it:
  - the baseline runs only the static checks;
  - the scenario-proof scenarios run only `## Run Scenarios by Tag`.
- So no Then sees what ADW does with the command's output. `runUnitTestSuite` points `ADW_UNIT_TEST_REPORT_PATH` at `<logsDir>/junit-unit.xml` (`adws/phases/unitTestPhase.ts:100-102`). After the `/test` agent has run the command, ADW reads that one file with `readJUnitReport` (`adws/agents/testRetry.ts:75`).
- Only `adwInitPrompt.mobile.test.ts` runs the command, and unit tests never stand in for scenario proof (`.adw/coding_guidelines.md`, "Testing").

**Solution:** Add one scenario. It runs the command as the `/test` agent does, and reads the report as the unit-test phase does.
- **The run.**
  - The command is read from the worktree's `.adw/commands.md` with `loadProjectConfig(worktree).commands.runTests`, the value `runUnitTestSuite` hands on.
  - `ADW_UNIT_TEST_REPORT_PATH` is `<logsDir>/junit-unit.xml`, set in ADW's own environment, as the phase sets it.
  - The environment is `buildClaudeLaunchEnv()`, the one `runClaudeAgent` starts `/test` with (`adws/agents/claudeAgent.ts:127`). Its `SAFE_ENV_VARS` carry the report path on (`adws/core/environment.ts:153`).
  - The command runs through `/bin/sh` from the worktree's root.
- **The Gradle wrapper.** The worktree's `gradlew` is feature-1044's existing stand-in, which gains a `test` task.
  - Run for that task, it writes one `TEST-<class>.xml` per row of the scenario's table, under `<module>/build/test-results/test/`. Each file starts with the XML declaration Gradle writes.
  - One row is for `:scenarios`. The stand-in writes that report whatever the run excludes. It stands for results that an earlier `:scenarios:test` run left in the worktree, since Gradle keeps the outputs of a task it skips.
  - The run then exits with the scenario's code. The scenario uses 1, as Gradle does when a test fails.
- **The Thens.** They read the report with ADW's `readJUnitReport` and check two things:
  - the test cases of `:composeApp` and `:shared`, each with its class and status, and none of `:scenarios`;
  - exit code 1.

What a dry run showed. It ran in a throwaway clone of this working tree: merge `562c7eaf`, the uncommitted changes of Issues #1–#3, then Steps 1–4.
- The new scenario passes, and `@adw-1044` reports `9 scenarios (9 passed)`.
- Each of these changes to the step-2 command makes it fail at the step shown:

  | Change | Fails at | With |
  |---|---|---|
  | `adw_init.md` replaced by `origin/dev`'s | the workflow Given | ``Expected step 8 of adw_init.md to have a bullet that starts with - If the application type is **`mobile:kotlincm`**`` |
  | the command replaced by a bare `./gradlew test` | `Then ADW reads exactly these test cases …` | `Expected a JUnit report ADW can read at the path in "ADW_UNIT_TEST_REPORT_PATH", but it reads none there.` |
  | `-path ./scenarios -prune -o ` removed | `Then ADW reads exactly these test cases …` | ADW also reads `The home screen greets the user` |
  | `; exit $exit_code` removed | `And the "## Run Tests" command exited with code 1` | `… but it exited with 0.` |

Some parts of the command cannot show in what ADW reads. The scenario does not claim them, and `adwInitPrompt.mobile.test.ts:18` still pins the exact text.
- `-x :scenarios:test` and `--continue`. The scenario proves the prune instead: `:scenarios`' results stay out of the report even when they are in the worktree.
- The `sed` that strips XML declarations. fast-xml-parser 5.9.0's `XMLValidator` accepts a declaration inside the document. So ADW reads the merged file with or without the `sed` (checked with `parseJUnitXml` on two merged suites).

Rejected alternatives:
- **Run the real `executeUnitTestPhase` with feature-929's throwaway CLI.** Its `/test` writes a fixed report and never runs `## Run Tests`, so it would need a new behaviour. The phase's verdict also comes from the report alone, so the command's exit code would not show.
- **Run the command with `runShellCommand`.** It passes the harness's whole environment, `NODE_OPTIONS="--import tsx"` included. The stand-in's Node then resolves `tsx` from the worktree and dies with `ERR_MODULE_NOT_FOUND`, as the first dry run did. The `/test` agent never gets that environment.
- **A stand-in that honours `-x` and writes no report for `:scenarios`.** The prune would go unproven, and while the prune is there, `-x` still shows nowhere in the report.

## Files to Modify
Use these files to implement the patch:

- `features/per-issue/step_definitions/feature-1044-gradle.ts`: the stand-in's `test` task.
- `features/per-issue/step_definitions/feature-1044-world.ts`: the run's outcome in `State1044`.
- `features/per-issue/step_definitions/feature-1044-proof.steps.ts`: `installWrapper` is exported and takes the `test` task.
- `features/per-issue/step_definitions/feature-1044-unit-tests.steps.ts` (new): the scenario's Given, When and two Thens.
- `features/per-issue/feature-1044.feature`: the new scenario, directly after the baseline scenario.

The working tree already holds the uncommitted changes of Issues #1–#3, in six files. Leave them as they are: the review-patch commit commits everything.

Do not change any of these:
- `.claude/commands/adw_init.md`, or any file under `adws/`. The command is right; only its proof is missing.
- `adws/__tests__/adwInitPrompt.mobile.test.ts`.
- The other eight scenarios of `feature-1044.feature`.
- `feature-1044-prompt.ts`, `feature-1044-baseline.steps.ts` or `feature-1044-framework.steps.ts`.
- Any file under `features/regression/`, `features/regression/vocabulary.md` included.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Give the Gradle stand-in a `test` task (`feature-1044-gradle.ts`)
- In the header comment, replace ``was asked for. Plain `function`/`var` source: it runs under whichever Node the harness runs under, with no loader.`` with these two lines:
  ```ts
   * was asked for, or, run for the `test` task, the JUnit report of each test class it was given, where Gradle writes it. Plain
   * `function`/`var` source: it runs under whichever Node the harness runs under, with no loader.
  ```
- Directly after `export interface GradleStandIn { … }`, add:
  ```ts
  /** The task that runs every module's unit tests, and where under a module Gradle writes their JUnit reports. */
  export const TEST_TASK = 'test';
  export const TEST_RESULTS_DIRECTORY = 'build/test-results/';
  export const TEST_STATUSES = ['passed', 'failed'] as const;

  /** A test class of a module, such as `:composeApp`, and the one test case its JUnit report holds. */
  export interface TestClassReport {
    readonly module: string;
    readonly testClass: string;
    readonly testCase: string;
    readonly status: (typeof TEST_STATUSES)[number];
  }

  /** What a run for the `test` task does: the test classes whose reports it writes, and the code it exits with. */
  export interface TestTaskRun {
    readonly reports: readonly TestClassReport[];
    readonly exitCode: number;
  }
  ```
- After `const TAG_FILTER_PROPERTY = '-Dcucumber.filter.tags=';`, add `const NO_TEST_TASK: TestTaskRun = { reports: [], exitCode: 0 };`.
- In `WRAPPER_BODY`:
  - After `var FILTER = ${JSON.stringify(TAG_FILTER_PROPERTY)};`, add `var TEST_TASK = ${JSON.stringify(TEST_TASK)};`.
  - Directly after `function writeReport(tag) { … }`, add the function below. It is TypeScript source inside the template literal, so `\\n` is written exactly so:
    ```ts
    function writeTestClassReport(report) {
      var file = path.join(process.cwd(), report.file);
      var failure = report.status === 'failed' ? '<failure message="expected the test to pass" type="java.lang.AssertionError"/>' : '';
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '<?xml version="1.0" encoding="UTF-8"?>\\n<testsuite name="' + xml(report.testClass) + '" tests="1" failures="' + (failure ? 1 : 0) + '">\\n' +
        '  <testcase name="' + xml(report.testCase) + '" classname="' + xml(report.testClass) + '" time="0.01">' + failure + '</testcase>\\n</testsuite>\\n');
    }
    ```
  - Replace the last lines of the body, from `var filter = …` through `process.exit(0);`, with:
    ```ts
    var filter = args.filter(function (arg) { return arg.indexOf(FILTER) === 0; })[0];
    var tagFilter = filter === undefined ? null : filter.slice(FILTER.length);
    var testTask = args.some(function (arg, index) { return arg === TEST_TASK && args[index - 1] !== '-x'; });
    fs.appendFileSync(CONFIG.callsFile, JSON.stringify({ argv: args, cwd: process.cwd(), env: adwVariables(), tagFilter: tagFilter }) + '\\n');
    if (tagFilter !== null) writeReport(tagFilter);
    if (testTask) CONFIG.testTask.reports.forEach(writeTestClassReport);
    process.exit(testTask ? CONFIG.testTask.exitCode : 0);
    ```
  - `testTask` is true only when `test` is a task of the run. So `./gradlew build -x test` and `./gradlew :scenarios:test …` still write no unit report and exit 0, as before.
- Directly before the docblock of `installGradleWrapper`, add:
  ```ts
  /** Where Gradle writes the report of a test class: `TEST-<class>.xml` under the directory of its module (`:a:b` is `a/b`). */
  function reportFile(report: TestClassReport): string {
    return path.join(...report.module.split(':').filter(Boolean), TEST_RESULTS_DIRECTORY, TEST_TASK, `TEST-${report.testClass}.xml`);
  }
  ```
- Replace the docblock, the signature and the `config` line of `installGradleWrapper` with these. Keep the `standIn` line, the `fs.writeFileSync` line and `return standIn;`:
  ```ts
  /**
   * Writes the wrapper into the root of the worktree, recording to a file in `recordDirectory`. Every scenario of a tag it is asked
   * for passes: once on each of `screenshots`' platforms, attaching the screenshot it saved there, or once with none to attach. A
   * tag that no feature file carries gets no report. Run for the `test` task, it writes the report of every test class of
   * `testTask`, whichever tasks the run excludes (Gradle leaves the results of a task it skips where an earlier run wrote them),
   * and exits with its code.
   */
  export function installGradleWrapper(
    worktreePath: string,
    recordDirectory: string,
    screenshots: readonly PlatformScreenshot[],
    testTask: TestTaskRun = NO_TEST_TASK,
  ): GradleStandIn {
    const standIn: GradleStandIn = { callsFile: path.join(recordDirectory, 'gradle-runs.jsonl') };
    const reports = testTask.reports.map(report => ({ ...report, file: reportFile(report) }));
    const config = { screenshots, callsFile: standIn.callsFile, testTask: { reports, exitCode: testTask.exitCode } };
  ```
- The file grows from 139 to 184 lines.

### Step 2: Keep the run in the feature-1044 world, and share `installWrapper`
- **`feature-1044-world.ts`**
  - Before `import type { RegressionWorld } …`, add `import type { ProcessOutcome } from '../../../adws/core/checkRunner.ts';`.
  - Directly before `export interface State1044`, add:
    ```ts
    /** A run of the worktree's unit-test command: the report path it was given, and how it ended. */
    export interface TestRun {
      readonly reportPath: string;
      readonly outcome: ProcessOutcome;
    }
    ```
  - In `State1044`, after `gradle`, add:
    ```ts
      /** Null until a step runs the worktree's unit-test command. */
      testRun: TestRun | null;
    ```
  - `freshState()` returns `{ gradle: null, testRun: null }`.
  - The hooks already call `resetState()` before and after every `@adw-1044` scenario. `endScenario()` (feature-988) also puts back the `ADW_UNIT_TEST_REPORT_PATH` that `beginScenario()` saved, so the When may set it.
  - The file grows from 60 to 69 lines.
- **`feature-1044-proof.steps.ts`**
  - Add `type TestTaskRun` to the import from `./feature-1044-gradle.ts`.
  - Change `installWrapper` to the version below. Its body is otherwise unchanged, and its two callers in the file pass no `testTask`:
    ```ts
    export function installWrapper(screenshots: readonly PlatformScreenshot[], testTask?: TestTaskRun): void {
      const recordDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-1044-gradle-'));
      registerDirectory(recordDirectory);
      s.gradle = installGradleWrapper(requireWorkflow().worktreePath, recordDirectory, screenshots, testTask);
    }
    ```
  - The file stays at 125 lines.

### Step 3: Write the steps of the unit-test scenario (`feature-1044-unit-tests.steps.ts`, new)
Create `features/per-issue/step_definitions/feature-1044-unit-tests.steps.ts` with exactly this content (106 lines):

```ts
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
```

How the steps work:
- **The workflow.** The scenario's first Given is the proof scenarios' `a workflow for issue {int} whose worktree holds the {string} that {string} writes for the application type {string}`. It reuses `adwFilesWrittenFor`, so `## Run Tests` is the code span that step 2 of `adw_init.md` gives `mobile:kotlincm`. The When writes those files into the worktree, as `prepareWorkflow` (feature-992) does before a phase.
- **What the steps compare.** The Then reads the cases with ADW's own `readJUnitReport` and compares name, class name and status: the fields `runUnitTestsWithRetry` and `testResultFromCase` use. The `find` order depends on the file system, so both sides are sorted.
- **Ambiguity.** No phrase matches an existing step. A dry run of every feature (`cucumber-js --dry-run`) reports no undefined or ambiguous step.

### Step 4: Add the scenario to `feature-1044.feature`
Directly after the baseline scenario (its last step is `And no park comment was posted on issue 104401`) and before the scenario-proof scenario of issue 104402, add the block below, followed by one blank line. In ADW's order, the unit-test phase runs after the baseline and before the scenario proof.

```gherkin
  @adw-1044 @adw-g0m1dk-feat-adw-init-preser
  Scenario: In a "mobile:kotlincm" repository whose ".adw/" is what "adw_init" writes, the "## Run Tests" command gathers the JUnit reports under each module's "build/test-results/" into the one report ADW reads at "ADW_UNIT_TEST_REPORT_PATH", leaves out those of the ":scenarios" module, and exits with the Gradle wrapper's exit code
    Given a workflow for issue 104405 whose worktree holds the ".adw/" that "adw_init" writes for the application type "mobile:kotlincm"
    And the worktree's Gradle wrapper is a stand-in that, run for the task "test", writes the JUnit report of each of these test classes under its module's "build/test-results/" directory, and exits with code 1:
      | module      | test class                  | test case                       | status |
      | :composeApp | com.example.GreetingTest    | greetingNamesThePlatform        | passed |
      | :shared     | com.example.ClockTest       | clockFormatsTheTime             | failed |
      | :scenarios  | com.example.RunCucumberTest | The home screen greets the user | passed |
    When the "## Run Tests" command of the worktree's ".adw/commands.md" is run as written from the worktree's root, with "ADW_UNIT_TEST_REPORT_PATH" holding the unit-test phase's report path
    Then ADW reads exactly these test cases from the JUnit report at "ADW_UNIT_TEST_REPORT_PATH":
      | test class               | test case                | status |
      | com.example.GreetingTest | greetingNamesThePlatform | passed |
      | com.example.ClockTest    | clockFormatsTheTime      | failed |
    And the "## Run Tests" command exited with code 1
```

- The expected cases and the exit code are written in the scenario. No step reads them from the prompt or from the stand-in.
- The `:scenarios` row has a cucumber scenario title, so a leak of its report into the unit report is plain to see.
- Feature-1044's `Before` and `After` hooks already run for every `@adw-1044` scenario. The new scenario gets a fresh feature-988, feature-992 and feature-1044 state, and its temporary directories are removed.
- Leave every change uncommitted: the review-patch commit commits them.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. Check the scope:
   - `git status --short` lists:
     - the six files that Issues #1–#3 changed;
     - `M` for `feature-1044-gradle.ts`, `feature-1044-proof.steps.ts` and `feature-1044-world.ts`;
     - `??` for `feature-1044-unit-tests.steps.ts`;
     - `feature-1044.feature`, which Issue #3 had already changed.
   - `git diff --quiet HEAD -- .claude/commands/adw_init.md adws && echo untouched` prints `untouched`.
   - `wc -l features/per-issue/feature-1044.feature features/per-issue/step_definitions/feature-1044-*.ts` shows every file under 300 lines. The feature file has 143 lines, `gradle` 184, `world` 69, `proof.steps` 125 and `unit-tests.steps` 106.
2. Run the static checks. `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run lint`, `bun run build` and `bun run lint:branch-names` all exit 0.
3. Run the scenarios:
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1044"` reports `9 scenarios (9 passed)` and `68 steps (68 passed)`.
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run` reports no undefined or ambiguous step.
4. Check that the new scenario fails without the command it proves. Run this from the worktree's root, while no other Cucumber run is using the worktree:
   ```sh
   git show origin/dev:.claude/commands/adw_init.md > .claude/commands/adw_init.md
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1044" --name "Run Tests"
   git checkout HEAD -- .claude/commands/adw_init.md
   node <<'EOF'
   const fs = require('fs');
   const file = '.claude/commands/adw_init.md';
   const text = fs.readFileSync(file, 'utf-8');
   const start = text.indexOf('`./gradlew test -x :scenarios:test');
   const end = text.indexOf('exit $exit_code`', start) + 'exit $exit_code`'.length;
   if (start < 0 || end < start) throw new Error('Expected the Gradle unit-test command in step 2');
   fs.writeFileSync(file, text.slice(0, start) + '`./gradlew test`' + text.slice(end));
   EOF
   NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-1044" --name "Run Tests"
   git checkout HEAD -- .claude/commands/adw_init.md
   git diff --quiet HEAD -- .claude/commands/adw_init.md && echo restored
   ```
   - Each Cucumber run reports `1 scenario (1 failed)`.
     - The first, on `origin/dev`'s prompt, fails at the workflow Given: ``Expected step 8 of adw_init.md to have a bullet that starts with - If the application type is **`mobile:kotlincm`**``.
     - The second, on a bare `./gradlew test`, fails at `Then ADW reads exactly these test cases from the JUnit report at "ADW_UNIT_TEST_REPORT_PATH":`, with `Expected a JUnit report ADW can read at the path in "ADW_UNIT_TEST_REPORT_PATH", but it reads none there.`
   - The last line prints `restored`.
5. Check the rest of the suite. Each of these reports zero failures:
   - `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`;
   - `bun run test:unit`.

## Patch Scope
**Lines of code to change:** about 180 added and 9 removed, in five files:

| File | Added | Removed |
|---|---|---|
| `feature-1044.feature` | 15 | 0 |
| `feature-1044-gradle.ts` | 45 | 5 |
| `feature-1044-world.ts` | 9 | 1 |
| `feature-1044-proof.steps.ts` | 3 | 3 |
| `feature-1044-unit-tests.steps.ts` (new) | 106 | 0 |

**Risk level:** low.
- Only per-issue step definitions and the per-issue `.feature` file change. No prompt, ADW source or regression file changes.
- The other callers of the Gradle stand-in keep their behaviour: `testTask` defaults to no reports and exit 0, and a scenario run is never a `test` task run.

**Testing required:** the commands above. They were run in a throwaway clone of this working tree: merge `562c7eaf`, Issues #1–#3's uncommitted changes, then Steps 1–4.
- Item 1: the five files changed as listed, `adw_init.md` and `adws/` were untouched, and every file is under 300 lines.
- Item 2: both type checks, lint, build and `lint:branch-names` exited 0.
- Item 3: `9 scenarios (9 passed)`, `68 steps (68 passed)`. The dry run of every feature reported `584 scenarios (584 skipped)` and `4218 steps (4218 skipped)`, none undefined or ambiguous.
- Item 4: both runs failed as described. The table under Issue Summary lists two further variants (no prune, no `exit $exit_code`), which failed as shown there.
- Item 5: `bun run test:unit` passed 292 files and 5006 tests. `@regression` reported `369 scenarios (369 passed)` and `2619 steps (2619 passed)`.
