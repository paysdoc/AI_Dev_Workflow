/**
 * Then steps of the feature-995 scenarios that run real orchestrator processes (feature-990's harness): when the review agent
 * was started, relative to the scenario fix agent and to the last run of each scenario. The wrapper around the Claude CLI stub
 * logs every agent it starts, and the scenario runner logs every run it makes, each with the time it happened.
 */

import { Then } from '@cucumber/cucumber';
import assert from 'assert';

import { AGENT_COMMANDS } from './feature-929-agents.ts';
import { agentStarts, scenarioRuns, type AgentStart, type ScenarioRun } from './feature-990-read.ts';
import { s } from './feature-990-world.ts';

const REVIEW_COMMAND = AGENT_COMMANDS['review agent'];
const SCENARIO_FIX_COMMAND = '/resolve_failed_scenario';

function startsOf(command: string): AgentStart[] {
  return agentStarts().filter(start => start.command === command);
}

/** The outcome of the scenario's last run among the runs, which are in the order they were made. */
function lastRunOf(scenario: string, runs: readonly ScenarioRun[]): ScenarioRun['scenarios'][number] | undefined {
  return runs.flatMap(run => run.scenarios.filter(entry => entry.name === scenario)).pop();
}

function describeStarts(starts: readonly AgentStart[]): string {
  return starts.map(start => `${start.command} at ${start.at}`).join(', ') || '(none)';
}

Then('the review agent was not started', function () {
  assert.deepStrictEqual(startsOf(REVIEW_COMMAND), [], `Expected the review agent not to have been started, but these agents were: ${describeStarts(agentStarts())}`);
});

Then('the review agent was started once, after the last start of the scenario fix agent', function () {
  const starts = startsOf(REVIEW_COMMAND);
  assert.strictEqual(starts.length, 1, `Expected the review agent to have been started once, but these agents were started: ${describeStarts(agentStarts())}`);

  const fixes = startsOf(SCENARIO_FIX_COMMAND);
  assert.ok(fixes.length > 0, `Expected the scenario fix agent to have been started, but these agents were: ${describeStarts(agentStarts())}`);
  const lastFix = Math.max(...fixes.map(start => start.at));
  assert.ok(starts[0].at >= lastFix, `Expected the review agent to start after the last start of the scenario fix agent (${lastFix}), but it started at ${starts[0].at}`);
});

Then('every scenario {reportedStepStatus} its last run before the review agent was started', function (status: string) {
  assert.ok(status === 'passed' || status === 'failed', `Only "passed" and "failed" say how a scenario's last run ended, not "${status}"`);
  const [start] = startsOf(REVIEW_COMMAND);
  assert.ok(start, `Expected the review agent to have been started, but these agents were: ${describeStarts(agentStarts())}`);
  assert.ok(s.scenarios.length > 0, 'Expected the scenario to have described the target repository\'s scenarios');

  const runsBeforeIt = scenarioRuns().filter(run => run.kind === 'issue' && run.at <= start.at);
  for (const { name } of s.scenarios) {
    const lastRun = lastRunOf(name, runsBeforeIt);
    assert.ok(lastRun, `Expected "${name}" to have run on the issue's branch before the review agent was started`);
    assert.strictEqual(lastRun.passed, status === 'passed', `Expected the last run of "${name}" before the review agent was started to have ${status}`);
  }
});
