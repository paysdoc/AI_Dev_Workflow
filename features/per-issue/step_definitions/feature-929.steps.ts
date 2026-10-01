/**
 * §1–§3 of feature-929: on context compaction only the build phase and the unit-test path stop
 * their agent and restart it; an agent in any other phase runs on to its final result.
 *
 * Every scenario runs real phase functions or runners in-process, against a workflow built over
 * a throwaway git worktree and the recording providers of `world796`, with CLAUDE_CODE_PATH
 * pointed at a throwaway script (see feature-929-compacting-cli.ts). The real Claude CLI is never
 * spawned. Every assertion reads a runtime artefact: the script's own record of the runs it
 * served, what a phase returned or left on the workflow context, or the comments the recording
 * issue tracker received. No step reads a source file.
 */

import { Given, When, Then, Before, After, defineParameterType } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { AGENTS_STATE_DIR, LOGS_DIR } from '../../../adws/core/config.ts';
import { getPlanFilePath } from '../../../adws/agents/planAgent.ts';
import { executeBuildPhase } from '../../../adws/phases/buildPhase.ts';
import { executeUnitTestPhase } from '../../../adws/phases/unitTestPhase.ts';
import { executeReviewPhase } from '../../../adws/phases/reviewPhase.ts';

import { world796, resetWorld } from './feature-796.steps.ts';
import { AGENT_NAMES, AGENT_COMMANDS, AGENT_PHASES, driveAgent, type AgentName } from './feature-929-agents.ts';
import { installCompactingCli, readRuns, emptyBehaviour, type CliBehaviour, type InstalledCli, type RunRecord } from './feature-929-compacting-cli.ts';
import { createWorkflow, commitFile, commentsOn, type Workflow929 } from './feature-929-workflow.ts';
import { isHeaded } from './feature-929-comments.ts';

defineParameterType({
  name: 'agent',
  regexp: new RegExp(AGENT_NAMES.join('|')),
  transformer: (name: string) => name as AgentName,
});

const COMPACTION_COMMENT_HEADING = 'Compaction Recovery';

const s: {
  workflow: Workflow929 | null;
  behaviour: CliBehaviour;
  /** Every CLI this scenario installed, oldest first: they are restored last-in first-out. */
  clis: InstalledCli[];
  phaseError: unknown;
  buildResult: Awaited<ReturnType<typeof executeBuildPhase>> | null;
  unitTestResult: Awaited<ReturnType<typeof executeUnitTestPhase>> | null;
  reviewResult: Awaited<ReturnType<typeof executeReviewPhase>> | null;
  savedUnitReportPath: string | undefined;
} = {
  workflow: null,
  behaviour: emptyBehaviour(),
  clis: [],
  phaseError: null,
  buildResult: null,
  unitTestResult: null,
  reviewResult: null,
  savedUnitReportPath: undefined,
};

function resetState(): void {
  s.workflow = null;
  s.behaviour = emptyBehaviour();
  s.clis = [];
  s.phaseError = null;
  s.buildResult = null;
  s.unitTestResult = null;
  s.reviewResult = null;
}

function removeDir(dir: string): void {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

Before({ tags: '@adw-929' }, function () {
  resetWorld();
  resetState();
  s.savedUnitReportPath = process.env['ADW_UNIT_TEST_REPORT_PATH'];
});

After({ tags: '@adw-929' }, async function () {
  [...s.clis].reverse().forEach(cli => cli.restore());
  if (s.savedUnitReportPath === undefined) delete process.env['ADW_UNIT_TEST_REPORT_PATH'];
  else process.env['ADW_UNIT_TEST_REPORT_PATH'] = s.savedUnitReportPath;

  // An agent's output stream flushes after its process closes; let it settle before its directory goes.
  await new Promise(resolve => setTimeout(resolve, 250));

  const w = world796();
  [...w.tempDirs, ...s.clis.map(cli => cli.dir)].forEach(removeDir);
  for (const adwId of w.usedAdwIds) {
    removeDir(path.join(AGENTS_STATE_DIR, adwId));
    removeDir(path.join(LOGS_DIR, adwId));
  }
  resetWorld();
  resetState();
});

function requireWorkflow(): Workflow929 {
  assert.ok(s.workflow, 'Expected a workflow to have been set up first');
  return s.workflow;
}

function requireCli(): InstalledCli {
  const cli = s.clis[s.clis.length - 1];
  assert.ok(cli, 'Expected a phase to have run first');
  return cli;
}

function runsOf(agent: AgentName): RunRecord[] {
  const command = AGENT_COMMANDS[agent];
  return readRuns(requireCli().runLogPath).filter(run => run.command === command);
}

function runNumber(agent: AgentName, number: number): RunRecord | undefined {
  return runsOf(agent).find(run => run.run === number);
}

/** Runs one phase under the throwaway CLI. A phase that throws, or exits the process, is recorded rather than aborting the run. */
async function runPhase<T>(workflow: Workflow929, run: () => Promise<T>): Promise<T | null> {
  s.clis.push(installCompactingCli({ ...s.behaviour, junitReportPath: path.join(workflow.logsDir, 'junit-unit.xml') }));
  const realExit = process.exit;
  process.exit = ((code?: number) => {
    throw new Error(`process.exit(${code ?? 0}) was called`);
  }) as typeof process.exit;
  try {
    return await run();
  } catch (error) {
    s.phaseError = error;
    return null;
  } finally {
    process.exit = realExit;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function assertPhaseCompleted(what: string): void {
  assert.ok(s.phaseError === null, `Expected ${what} to complete, but it threw:\n${describeError(s.phaseError)}`);
}

Given('a workflow for issue {int} in the target repository {string} whose providers record every call', function (issueNumber: number, repoStr: string) {
  s.workflow = createWorkflow(issueNumber, repoStr);
});

Given('the issue has an implementation plan in its worktree', function () {
  const workflow = requireWorkflow();
  const planPath = getPlanFilePath(workflow.issueNumber, workflow.worktreePath);
  commitFile(workflow.worktreePath, planPath, `# Plan for issue ${workflow.issueNumber}\n\nImplement the change.\n`);
});

Given('unit tests are enabled for the workflow', function () {
  requireWorkflow().config.adwYmlConfig = { hitl: false, unitTests: true, guardrails: false };
});

Given('the first unit-test run reports one failing unit test and every later run reports all unit tests passing', function () {
  s.behaviour.failingTestRuns = [1];
});

Given(
  'the Claude CLI compacts the context of the first {agent} partway through its run, after which, if left running, the agent carries on to a final result',
  function (agent: AgentName) {
    s.behaviour.compactFirstRunOf.push(AGENT_COMMANDS[agent]);
  },
);

Given('before the compaction the review agent wrote a draft verdict that reports a blocker', function () {
  s.behaviour.draftBeforeCompaction['/review'] = JSON.stringify({
    success: false,
    reviewSummary: 'Draft verdict.',
    reviewIssues: [{ reviewIssueNumber: 1, issueDescription: 'A draft blocker.', issueResolution: 'Fix it.', issueSeverity: 'blocker', remediationStrategy: 'patch' }],
    screenshots: [],
  });
});

Given("the review agent's final result passes the review with no blockers", function () {
  s.behaviour.finalResult['/review'] = JSON.stringify({ success: true, reviewSummary: 'Final verdict: no blockers.', reviewIssues: [], screenshots: [] });
});

When('the build phase runs', async function () {
  const workflow = requireWorkflow();
  s.buildResult = await runPhase(workflow, () => executeBuildPhase(workflow.config));
});

When('the unit-test phase runs', async function () {
  const workflow = requireWorkflow();
  s.unitTestResult = await runPhase(workflow, () => executeUnitTestPhase(workflow.config));
});

When('the review phase runs', async function () {
  const workflow = requireWorkflow();
  s.reviewResult = await runPhase(workflow, () => executeReviewPhase(workflow.config, ''));
});

When('the {} phase runs its {agent}', async function (phase: string, agent: AgentName) {
  assert.strictEqual(phase, AGENT_PHASES[agent], `The ${agent} belongs to the ${AGENT_PHASES[agent]} phase, not the ${phase} phase`);
  const workflow = requireWorkflow();
  await runPhase(workflow, () => driveAgent(agent, workflow));
});

Then('the first {agent} was stopped before it reported a final result', function (agent: AgentName) {
  const first = runNumber(agent, 1);
  assert.ok(first, `Expected the first ${agent} to have been started`);
  assert.ok(first.stopped, `Expected the first ${agent} to have been stopped, but it was not`);
  assert.ok(!first.completed, `Expected the first ${agent} to be stopped before it reported a final result, but it reached its end`);
});

Then('a second build agent was started and told that the previous build agent was stopped because its context was compacted', function () {
  const second = runNumber('build agent', 2);
  assert.ok(second, 'Expected a second build agent to have been started');
  assert.ok(second.prompt.includes('## Continuation Context'), 'Expected the second build agent to be given the continuation context');
  assert.ok(second.prompt.includes('compacted the conversation context'), 'Expected the second build agent to be told the previous one was stopped because its context was compacted');
});

Then('a second {agent} was started', function (agent: AgentName) {
  assert.ok(runNumber(agent, 2), `Expected a second ${agent} to have been started, got ${runsOf(agent).length} run(s)`);
});

Then('the second {agent} ran to completion', function (agent: AgentName) {
  const second = runNumber(agent, 2);
  assert.ok(second, `Expected a second ${agent} to have been started`);
  assert.ok(second.completed && !second.stopped, `Expected the second ${agent} to run to completion`);
});

Then("the build phase completed with the second build agent's final result as the build output", function () {
  assertPhaseCompleted('the build phase');
  const second = runNumber('build agent', 2);
  assert.ok(second?.finalResult, 'Expected the second build agent to have reported a final result');
  assert.strictEqual(requireWorkflow().config.ctx.buildOutput, second.finalResult);
});

Then('the unit-test phase used none of its retries', function () {
  assertPhaseCompleted('the unit-test phase');
  assert.ok(s.unitTestResult, 'Expected the unit-test phase to have returned a result');
  assert.strictEqual(s.unitTestResult.totalRetries, 0);
});

Then('the {agent} was not stopped', function (agent: AgentName) {
  const runs = runsOf(agent);
  assert.ok(runs.length > 0, `Expected the ${agent} to have been started`);
  const stopped = runs.filter(run => run.stopped);
  assert.deepStrictEqual(stopped.map(run => run.run), [], `Expected the ${agent} not to be stopped, but run(s) ${stopped.map(run => run.run).join(', ')} were`);
});

Then('the {agent} ran to completion', function (agent: AgentName) {
  assertPhaseCompleted(`the ${agent}`);
  const runs = runsOf(agent);
  assert.ok(runs.length > 0, `Expected the ${agent} to have been started`);
  assert.ok(runs.every(run => run.completed), `Expected the ${agent} to run to completion, but run(s) ${runs.filter(run => !run.completed).map(run => run.run).join(', ')} did not`);
});

Then('the {agent} was started {int} time(s)', function (agent: AgentName, times: number) {
  assert.strictEqual(runsOf(agent).length, times, `Expected the ${agent} to have been started ${times} time(s)`);
});

Then('the review phase passes the review', function () {
  assertPhaseCompleted('the review phase');
  assert.ok(s.reviewResult, 'Expected the review phase to have returned a result');
  assert.strictEqual(s.reviewResult.reviewPassed, true, `Expected the review to pass, got ${JSON.stringify(s.reviewResult.reviewIssues)}`);
});

Then('a comment headed {string} was posted on issue {int}', function (heading: string, issueNumber: number) {
  const comments = commentsOn(issueNumber);
  assert.ok(comments.some(body => isHeaded(body, heading)), `Expected a comment headed "${heading}" on issue ${issueNumber}, got ${comments.length} comment(s):\n${comments.join('\n---\n')}`);
});

Then('no compaction recovery comment was posted on issue {int}', function (issueNumber: number) {
  const recovery = commentsOn(issueNumber).filter(body => isHeaded(body, COMPACTION_COMMENT_HEADING));
  assert.deepStrictEqual(recovery, [], `Expected no compaction recovery comment on issue ${issueNumber}`);
});
