/**
 * The Then steps of feature-990 about regression scenarios: which ones the scenario runner was asked to run on a
 * worktree of the base branch, and what the scenario fix agent was started with. The scenario runner logs every run it
 * makes, and the wrapper around the Claude CLI stub logs every agent it starts with the prompt it was given.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import { agentStarts, baseScenarioRuns, type ScenarioRun } from './feature-990-read.ts';

const SCENARIO_FIX_COMMAND = '/resolve_failed_scenario';
const RERUN_TAG = 'adw-base-rerun';

function ranAlone(scenario: string): (run: ScenarioRun) => boolean {
  return run => run.tag === RERUN_TAG && run.scenarios.length === 1 && run.scenarios[0]?.name === scenario;
}

function describeRuns(runs: readonly ScenarioRun[]): string {
  return runs.map(run => `${run.tag}: ${run.scenarios.map(entry => entry.name).join(', ')} in ${run.cwd}`).join('\n') || '(none)';
}

function scenarioFixPrompts(): string[] {
  return agentStarts().filter(start => start.command === SCENARIO_FIX_COMMAND).map(start => start.prompt);
}

Then('the scenario {string} was run on its own on the worktree of the base branch {string}', function (scenario: string, baseBranch: string) {
  const runs = baseScenarioRuns();
  assert.ok(runs.some(ranAlone(scenario)), `Expected "${scenario}" to have been run on its own on the worktree of the base branch "${baseBranch}", but the scenario runs there were:\n${describeRuns(runs)}`);
});

Then('the scenario {string} has been run on its own on a worktree of the base branch {string} {int} times', function (scenario: string, baseBranch: string, times: number) {
  const runs = baseScenarioRuns();
  const alone = runs.filter(ranAlone(scenario));
  assert.strictEqual(alone.length, times, `Expected "${scenario}" to have been run on its own on a worktree of the base branch "${baseBranch}" ${times} times, but the scenario runs there were:\n${describeRuns(runs)}`);
});

Then('no scenario was run on the base branch', function () {
  assert.deepStrictEqual(baseScenarioRuns(), [], 'Expected no scenario to have been run on the base branch');
});

Then('no other scenario was run on the base branch', function () {
  const runs = baseScenarioRuns();
  const names = new Set(runs.flatMap(run => run.scenarios.map(entry => entry.name)));
  assert.ok(names.size <= 1, `Expected only one scenario to have been run on the base branch, but these were:\n${describeRuns(runs)}`);
  assert.ok(runs.every(run => run.tag === RERUN_TAG), `Expected every run on the base branch to be of the scenario tagged for the re-run, but these were:\n${describeRuns(runs)}`);
});

Then('the scenario fix agent was not started', function () {
  assert.deepStrictEqual(scenarioFixPrompts(), [], 'Expected the scenario fix agent not to have been started');
});

Then('the scenario fix agent was handed the failing scenario {string}', function (scenario: string) {
  const prompts = scenarioFixPrompts();
  assert.ok(prompts.some(prompt => prompt.includes(scenario)), `Expected the scenario fix agent to have been handed "${scenario}", but it was started ${prompts.length} time(s) with:\n${prompts.join('\n---\n')}`);
});

Then('the scenario fix agent was never handed the failing scenario {string}', function (scenario: string) {
  const handed = scenarioFixPrompts().filter(prompt => prompt.includes(scenario));
  assert.deepStrictEqual(handed, [], `Expected the scenario fix agent never to be handed "${scenario}"`);
});
