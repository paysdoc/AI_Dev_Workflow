import { describe, it, expect } from 'vitest';
import { AgentStateManager } from '../../core/agentState';
import { decideRetryAction } from '../../triggers/retryHandler';
import { executeUnitTestPhase } from '../unitTestPhase';
import {
  ExitSignal,
  GREEN,
  RED_BUILD,
  RED_LINT,
  executionLog,
  makeWorkflow,
  parkComments,
  recordingTestRun,
  scriptedFixRounds,
  scriptedProcessRunner,
  useUnitTestPhaseSandbox,
  type Outcomes,
  type Workflow,
} from './unitTestPhase.helpers';

useUnitTestPhaseSandbox();

describe.each([true, false])('executeUnitTestPhase — a fix loop that stalls, with unitTests %s', (unitTests) => {
  async function stall(workflow: Workflow, events: string[], rounds = scriptedFixRounds(events, {}), outcomes: Outcomes = { lint: [RED_LINT, RED_LINT] }) {
    const run = executeUnitTestPhase(workflow.config, {
      runProcess: scriptedProcessRunner(events, outcomes),
      runUnitTestsWithRetry: recordingTestRun(events),
      fixRounds: rounds.port,
    });
    await expect(run).rejects.toBeInstanceOf(ExitSignal);
    return rounds;
  }

  it('parks the workflow as human_gated and exits with code 0', async () => {
    const workflow = makeWorkflow(unitTests);

    await stall(workflow, []);

    expect(process.exit).toHaveBeenCalledWith(0);
    expect(AgentStateManager.readTopLevelState(workflow.config.adwId)?.workflowStage).toBe('human_gated');
  });

  it('posts one park comment that names the check and its command, quotes its output, and explains "## Retry"', async () => {
    const workflow = makeWorkflow(unitTests);

    await stall(workflow, []);

    const [comment, ...others] = parkComments(workflow);
    expect(others).toEqual([]);
    expect(comment.startsWith('## :raised_hand: ADW Parked')).toBe(true);
    expect(comment).toContain('`lint` — `lint` (exit 1)');
    expect(comment).toContain('\n    lint error in src/a.ts');
    expect(comment).toContain('`## Retry` —');
    expect(comment).toContain('stopped after 1 fix round');
  });

  it('puts the failing output in the execution log', async () => {
    const workflow = makeWorkflow(unitTests);

    await stall(workflow, []);

    expect(executionLog(workflow.config)).toContain('lint error in src/a.ts');
    expect(executionLog(workflow.config)).toContain('human_gated');
  });

  it('never starts the test run', async () => {
    const events: string[] = [];

    await stall(makeWorkflow(unitTests), events);

    expect(events).not.toContain('tests');
  });

  it('is no failure: no error is recorded and no error comment is posted', async () => {
    const workflow = makeWorkflow(unitTests);

    await stall(workflow, []);

    expect(workflow.config.ctx.errorMessage).toBeUndefined();
    expect(workflow.comments().some(body => body.includes('ADW Workflow Error'))).toBe(false);
    expect(AgentStateManager.readState(workflow.config.orchestratorStatePath)?.execution?.status).not.toBe('failed');
  });

  it('names every check that still fails', async () => {
    const workflow = makeWorkflow(unitTests);

    await stall(workflow, [], undefined, { lint: [RED_LINT, RED_LINT], build: [RED_BUILD, RED_BUILD] });

    const [comment] = parkComments(workflow);
    expect(comment).toContain('`lint` — `lint` (exit 1)');
    expect(comment).toContain('`build` — `build` (exit 2)');
    expect(comment).toContain('build error in src/b.ts');
  });

  it('reports a check that was killed, and so has no exit code, as failing', async () => {
    const workflow = makeWorkflow(unitTests);
    const killed = { exitCode: null, output: 'Terminated' };

    await stall(workflow, [], undefined, { atc: [killed, killed] });

    expect(parkComments(workflow)[0]).toContain('`additional type checks` — `atc` (exit none)');
  });

  it('parks after a round that was kept but changed nothing the checks print', async () => {
    const events: string[] = [];
    const workflow = makeWorkflow(unitTests);

    const rounds = await stall(workflow, events);

    expect(rounds.kept).toEqual([1]);
    expect(rounds.discarded).toEqual([]);
  });
});

describe.each([true, false])('executeUnitTestPhase — "## Retry" on a parked workflow, with unitTests %s', (unitTests) => {
  it('re-arms the parked stage, and the resumed phase starts a round although the check prints what it printed when the loop stopped', async () => {
    const events: string[] = [];
    const workflow = makeWorkflow(unitTests);
    const rounds = scriptedFixRounds(events, {}, {});
    const runProcess = scriptedProcessRunner(events, { lint: [RED_LINT, RED_LINT, RED_LINT, GREEN] });
    const deps = { runProcess, runUnitTestsWithRetry: recordingTestRun(events), fixRounds: rounds.port };

    await expect(executeUnitTestPhase(workflow.config, deps)).rejects.toBeInstanceOf(ExitSignal);
    expect(decideRetryAction(AgentStateManager.readTopLevelState(workflow.config.adwId)?.workflowStage)).toEqual({
      kind: 'rearm_phase_timeout',
      from: 'human_gated',
    });
    expect(rounds.fixed).toHaveLength(1);

    const result = await executeUnitTestPhase(workflow.config, deps);

    expect(result.unitTestsPassed).toBe(true);
    expect(rounds.fixed).toHaveLength(2);
    expect(rounds.fixed[1].round).toBe(1);
    expect(rounds.fixed[1].failed[0].output).toBe(rounds.fixed[0].failed[0].output);
    expect(events.filter(event => event === 'tests')).toHaveLength(unitTests ? 1 : 0);
  });
});

describe('executeUnitTestPhase — a fix round that fails with an error', () => {
  it('lets the error propagate, and parks nothing', async () => {
    const error = new Error('the fix agent timed out');
    const workflow = makeWorkflow(true);

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: scriptedProcessRunner([], { lint: [RED_LINT] }),
        runUnitTestsWithRetry: recordingTestRun([]),
        fixRounds: scriptedFixRounds([], { error }).port,
      }),
    ).rejects.toBe(error);

    expect(process.exit).not.toHaveBeenCalled();
    expect(parkComments(workflow)).toEqual([]);
    expect(AgentStateManager.readTopLevelState(workflow.config.adwId)?.workflowStage).not.toBe('human_gated');
  });

  it('asks for the git context of the workflow only once a check is red', async () => {
    const workflow = makeWorkflow(true);

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: scriptedProcessRunner([], { lint: [RED_LINT] }),
        runUnitTestsWithRetry: recordingTestRun([]),
      }),
    ).rejects.toThrow(/requireWorkflowGitContext/);
  });
});
