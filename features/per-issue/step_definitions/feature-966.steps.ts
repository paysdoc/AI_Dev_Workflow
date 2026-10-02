/**
 * Step definitions for the first scenario of feature-966.feature: the surface rows run twice in a
 * row, each row passing both times, and the checkout left as it was found. The run itself is
 * feature-963's step. Every check reads what the runs left: the child runs' step results, the
 * checkout's `agents/` and `logs/`, the cron registry, the process table and git's own listings.
 * No step reads a source file.
 */

import { Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { cronPidFilePath, isPidAlive, readCronPid } from '../../regression/step_definitions/realCronProcess.ts';
import type { RegressionWorld } from '../../regression/step_definitions/world.ts';
import { describeScenario, verdictHolds, type CucumberRun } from '../../support/cucumberChildRun.ts';
import { stateOf as runStateOf } from './feature-963-state.ts';
import { captureCheckout, stateOf } from './feature-966-state.ts';

const SURFACE_ROWS_DIRECTORY = 'features/regression/surfaces/';

function assertRowPasses(run: CucumberRun, row: string, runNumber: number): void {
  const rowScenarios = run.scenarios.filter((scenario) => scenario.uri.endsWith(`${SURFACE_ROWS_DIRECTORY}${row}`));
  assert.strictEqual(rowScenarios.length, 1, `Expected exactly one scenario from ${row} in run ${runNumber}, but it ran ${rowScenarios.length}`);

  const [scenario] = rowScenarios;
  assert.ok(verdictHolds(scenario, 'passes'), `Expected ${row} to pass in run ${runNumber}, but the child Cucumber run reported:\n${describeScenario(scenario)}`);
}

Then('each of these surface rows passes on both runs:', function (this: RegressionWorld, table: DataTable) {
  const { surfaceRuns } = runStateOf(this);
  assert.strictEqual(surfaceRuns.length, 2, 'Expected the surface scenarios to have been run twice first');
  for (const { row } of table.hashes()) {
    surfaceRuns.forEach((run, index) => assertRowPasses(run, row, index + 1));
  }
});

Then('the checkout holds no state and no logs for any of these adwIds:', function (table: DataTable) {
  const left = table.hashes().flatMap(({ adwId }) => [join(AGENTS_STATE_DIR, adwId), join(LOGS_DIR, adwId)]).filter((path) => existsSync(path));
  assert.deepStrictEqual(left, [], 'Expected the checkout to hold no state and no logs for these adwIds');
});

/**
 * A cron's command line ends with its arguments, so a process whose command merely mentions the
 * words, such as an agent that was given this feature's text as its prompt, is not one.
 */
function cronCommandPattern(repoFullName: string): RegExp {
  const escaped = repoFullName.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`(?:^|\\s)\\S*adws/triggers/trigger_cron\\.ts --target-repo ${escaped}(?: --clone-url \\S+)?$`);
}

function runningCommands(): string[] {
  return execSync('ps -eo pid=,command=', { encoding: 'utf-8' }).split('\n').map((line) => line.trim()).filter(Boolean);
}

Then('no cron trigger for the repository {string} is still running', function (repoFullName: string) {
  const pid = readCronPid(repoFullName);
  assert.ok(pid === null || !isPidAlive(pid), `Expected no live cron for ${repoFullName}, but ${cronPidFilePath(repoFullName)} names the live process ${pid}`);

  const running = runningCommands().filter((command) => cronCommandPattern(repoFullName).test(command));
  assert.deepStrictEqual(running, [], `Expected no process to be running the cron trigger for ${repoFullName}`);
});

/** The lines the listing gained, which is where a branch or a worktree this scenario's workflows added would show. */
function addedLines(before: string, after: string): string[] {
  const known = new Set(before.split('\n'));
  return after.split('\n').filter((line) => line.trim().length > 0 && !known.has(line));
}

Then(
  'neither run added a branch or a worktree to the checkout for any of these workflows:',
  function (this: RegressionWorld, table: DataTable) {
    const { checkout } = stateOf(this);
    assert.ok(checkout, 'Expected the checkout to have been listed before the scenario');
    const now = captureCheckout();
    const added = [...addedLines(checkout.branches, now.branches), ...addedLines(checkout.worktrees, now.worktrees)];

    const offenders = table.hashes().flatMap(({ adwId, issue }) => added.filter((line) => line.includes(adwId) || line.includes(`issue-${issue}`)));
    assert.deepStrictEqual(offenders, [], 'Expected the runs to add no branch and no worktree to the checkout for these workflows');
  },
);
