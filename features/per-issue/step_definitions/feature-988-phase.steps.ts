/**
 * Unit-test phase scenarios of feature-988. Each runs the real `executeUnitTestPhase`, and with
 * it the real `runUnitTestsWithRetry`, over a throwaway git worktree whose ".adw/commands.md" and
 * ".github/adw.yml" the scenario wrote, with the recording providers of `world796` and
 * CLAUDE_CODE_PATH pointed at a throwaway script (see feature-929-compacting-cli.ts) that records
 * every agent start. The real Claude CLI is never spawned, and no fake stands in for the test run.
 */

import { Given, When, Then, type DataTable } from '@cucumber/cucumber';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { readAdwYmlConfig } from '../../../adws/core/adwYmlConfig.ts';
import { loadProjectConfig } from '../../../adws/core/projectConfig.ts';
import { executeUnitTestPhase } from '../../../adws/phases/unitTestPhase.ts';

import { installCompactingCli, readRuns, emptyBehaviour, type InstalledCli } from '../../regression/step_definitions/feature-929-compacting-cli.ts';
import { isHeaded } from './feature-929-comments.ts';
import { createWorkflow, commentsOn, type Workflow929 } from '../../regression/step_definitions/feature-929-workflow.ts';
import { s, recordingProcessRunner, writeStaticChecks, type PhaseOutcome } from '../../regression/step_definitions/feature-988-world.ts';

const TARGET_REPOSITORY = 'adw-fixture/void-988';

export function requireWorkflow(): Workflow929 {
  assert.ok(s.workflow, 'Expected a workflow to have been set up first');
  return s.workflow;
}

function requireCli(): InstalledCli {
  assert.ok(s.cli, 'Expected the unit-test phase to have run first');
  return s.cli;
}

export function requirePhase(): PhaseOutcome {
  assert.ok(s.phase, 'Expected the unit-test phase to have run first');
  return s.phase;
}

/** The slash command of every run the throwaway CLI has served, in start order. */
export function startedAgents(): string[] {
  return readRuns(requireCli().runLogPath).map(run => run.command);
}

export function describeEnd(phase: PhaseOutcome): string {
  if (phase.exitCode !== null) return `it ended the workflow with exit code ${phase.exitCode}`;
  return phase.error === null ? 'it completed' : `it threw: ${String(phase.error)}`;
}

/** Runs the phase with `process.exit` trapped, so a phase that ends the workflow is recorded rather than ending this process. */
export async function runPhaseTrappingExit(workflow: Workflow929, cli: InstalledCli): Promise<PhaseOutcome> {
  // Object reference avoids TypeScript's let-variable narrowing loss through closures.
  const trapped: { exitCode: number | null } = { exitCode: null };
  const realExit = process.exit;
  process.exit = ((code?: number) => {
    trapped.exitCode = code ?? 0;
    throw new Error(`process.exit(${trapped.exitCode}) was called`);
  }) as typeof process.exit;
  const runProcess = recordingProcessRunner(() => s.agentRunsAtCheckEnd.push(readRuns(cli.runLogPath).length));
  try {
    await executeUnitTestPhase(workflow.config, { runProcess, fixRounds: s.fixRounds ?? undefined });
    return { completed: true, exitCode: null, error: null };
  } catch (error) {
    return { completed: false, exitCode: trapped.exitCode, error: trapped.exitCode === null ? error : null };
  } finally {
    process.exit = realExit;
  }
}

Given(
  "a workflow for issue {int} whose worktree's {string} configures these static checks, in this order:",
  function (issueNumber: number, relativePath: string, table: DataTable) {
    s.workflow = createWorkflow(issueNumber, TARGET_REPOSITORY);
    writeStaticChecks(s.workflow.worktreePath, relativePath, table);
  },
);

Given("the worktree's {string} holds:", function (relativePath: string, content: string) {
  const file = path.join(requireWorkflow().worktreePath, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${content}\n`, 'utf-8');
});

Given('the test agent writes a JUnit report in which every unit test passes', function () {
  s.behaviour = { ...emptyBehaviour(), junitReportPath: path.join(requireWorkflow().logsDir, 'junit-unit.xml') };
});

/** One run of the phase. A scenario that runs it again (a resumed workflow) goes on with the same throwaway CLI and fix rounds. */
export async function runWorkflowUnitTestPhase(): Promise<void> {
  const workflow = requireWorkflow();
  s.beforePhase?.();
  workflow.config.projectConfig = loadProjectConfig(workflow.worktreePath);
  workflow.config.adwYmlConfig = readAdwYmlConfig(workflow.worktreePath);
  s.cli ??= installCompactingCli(s.behaviour);
  s.phase = await runPhaseTrappingExit(workflow, s.cli);
}

When("the workflow's unit-test phase runs", runWorkflowUnitTestPhase);

Then('the test agent was started once, after every static check had finished', function () {
  assert.ok(s.agentRunsAtCheckEnd.length > 0, 'Expected the static checks to have run');
  assert.deepStrictEqual(
    s.agentRunsAtCheckEnd.filter(started => started > 0),
    [],
    `Expected no agent to start before the last static check finished, but agents had started when these checks finished: ${s.agentRunsAtCheckEnd.join(', ')}`,
  );
  assert.deepStrictEqual(startedAgents(), ['/test'], 'Expected the test agent to have been started once, and nothing else');
});

Then('the unit-test phase completed', function () {
  const phase = requirePhase();
  assert.ok(phase.completed, `Expected the unit-test phase to complete, but ${describeEnd(phase)}`);
});

Then('the unit-test phase ended the workflow with exit code {int}', function (exitCode: number) {
  const phase = requirePhase();
  assert.strictEqual(phase.exitCode, exitCode, `Expected the unit-test phase to end the workflow with exit code ${exitCode}, but ${describeEnd(phase)}`);
});

Then('no agent was started', function () {
  assert.deepStrictEqual(startedAgents(), [], 'Expected no agent to have been started');
});

Then("the workflow's execution log holds {string}", function (text: string) {
  const logFile = path.join(requireWorkflow().config.orchestratorStatePath, 'execution.log');
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '';
  assert.ok(log.includes(text), `Expected the execution log to hold "${text}", got:\n${log}`);
});

Then('the unit-test phase posted a comment headed {string} on issue {int}', function (heading: string, issueNumber: number) {
  const comments = commentsOn(issueNumber);
  assert.ok(
    comments.some(body => isHeaded(body, heading)),
    `Expected a comment headed "${heading}" on issue ${issueNumber}, got ${comments.length} comment(s):\n${comments.join('\n---\n')}`,
  );
});
