import { describe, it, expect } from 'vitest';
import type { ProcessRunner, StaticCheckCommands } from '../../core/checkRunner';
import type { ModelUsageMap } from '../../cost';
import { AgentStateManager } from '../../core/agentState';
import { executeUnitTestPhase } from '../unitTestPhase';
import {
  ALL_CHECKS_RAN,
  ExitSignal,
  GREEN,
  RED_BUILD,
  RED_LINT,
  executionLog,
  makeConfig,
  makeWorkflow,
  parkComments,
  recordingProcessRunner,
  recordingTestRun,
  scriptedFixRounds,
  scriptedProcessRunner,
  useUnitTestPhaseSandbox,
} from './unitTestPhase.helpers';

useUnitTestPhaseSandbox();

describe('executeUnitTestPhase — static checks and the unit-test switch', () => {
  it('runs every static check and skips the test run when unitTests is false', async () => {
    const events: string[] = [];

    const result = await executeUnitTestPhase(makeConfig(false), {
      runProcess: recordingProcessRunner(events),
      runUnitTestsWithRetry: recordingTestRun(events),
    });

    expect(events).toEqual(ALL_CHECKS_RAN);
    expect(result.unitTestsPassed).toBe(true);
  });

  it('runs the static checks before the test run when unitTests is true', async () => {
    const events: string[] = [];

    const result = await executeUnitTestPhase(makeConfig(true), {
      runProcess: recordingProcessRunner(events),
      runUnitTestsWithRetry: recordingTestRun(events),
    });

    expect(events).toEqual([...ALL_CHECKS_RAN, 'tests']);
    expect(result.unitTestsPassed).toBe(true);
  });

  it('runs the checks in the worktree', async () => {
    const config = makeConfig(false);
    const directories: string[] = [];
    const runProcess: ProcessRunner = async (_command, cwd) => {
      directories.push(cwd);
      return { exitCode: 0, output: '' };
    };

    await executeUnitTestPhase(config, { runProcess, runUnitTestsWithRetry: recordingTestRun([]) });

    expect(directories).toEqual(Array(4).fill(config.worktreePath));
  });

  it('runs nothing when every static check is N/A and unitTests is false', async () => {
    const events: string[] = [];
    const notApplicable: StaticCheckCommands = { typeCheck: 'N/A', additionalTypeChecks: 'N/A', runLinter: 'N/A', runBuild: 'N/A' };

    const result = await executeUnitTestPhase(makeConfig(false, notApplicable), {
      runProcess: recordingProcessRunner(events),
      runUnitTestsWithRetry: recordingTestRun(events),
    });

    expect(events).toEqual([]);
    expect(result.unitTestsPassed).toBe(true);
  });

  it('starts no fix round and needs no git context when every check is green on the first run', async () => {
    const events: string[] = [];
    const rounds = scriptedFixRounds(events);

    const result = await executeUnitTestPhase(makeConfig(true), {
      runProcess: recordingProcessRunner(events),
      runUnitTestsWithRetry: recordingTestRun(events),
      fixRounds: rounds.port,
    });

    expect(rounds.fixed).toEqual([]);
    expect(result.costUsd).toBe(0);
  });

  it('logs the output of a check that passed, as it logged it before', async () => {
    const config = makeConfig(false);

    await executeUnitTestPhase(config, { runProcess: recordingProcessRunner([]), runUnitTestsWithRetry: recordingTestRun([]) });

    expect(executionLog(config)).toContain('Static check passed: lint — lint');
  });
});

describe.each([true, false])('executeUnitTestPhase — a red static check the fix loop fixes, with unitTests %s', (unitTests) => {
  it('hands the failing check to the fix loop, runs the checks again, and completes', async () => {
    const events: string[] = [];
    const rounds = scriptedFixRounds(events, {});
    const config = makeConfig(unitTests);

    const result = await executeUnitTestPhase(config, {
      runProcess: scriptedProcessRunner(events, { lint: [RED_LINT, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun(events),
      fixRounds: rounds.port,
    });

    expect(result.unitTestsPassed).toBe(true);
    expect(rounds.fixed).toHaveLength(1);
    expect(rounds.fixed[0].failed.map(verdict => [verdict.check, verdict.command, verdict.exitCode])).toEqual([['lint', 'lint', 1]]);
    expect(rounds.kept).toEqual([1]);
    expect(config.ctx.errorMessage).toBeUndefined();
  });

  it('runs the whole set of checks once, then the round, then the whole set again, and only then the test run', async () => {
    const events: string[] = [];
    const rounds = scriptedFixRounds(events, {});

    await executeUnitTestPhase(makeConfig(unitTests), {
      runProcess: scriptedProcessRunner(events, { lint: [RED_LINT, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun(events),
      fixRounds: rounds.port,
    });

    expect(events).toEqual([...ALL_CHECKS_RAN, 'fix:1', 'keep:1', ...ALL_CHECKS_RAN, ...(unitTests ? ['tests'] : [])]);
  });

  it('logs the failing check’s output, and the round, in the execution log', async () => {
    const config = makeConfig(unitTests);

    await executeUnitTestPhase(config, {
      runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun([]),
      fixRounds: scriptedFixRounds([], {}).port,
    });

    expect(executionLog(config)).toContain('lint error in src/a.ts');
    expect(executionLog(config)).toContain('Static-check fix round 1');
    expect(executionLog(config)).toContain('Static checks green after 1 fix round');
  });

  it('adds the cost and the model usage of the rounds to the cost of the phase', async () => {
    const usage: ModelUsageMap = { 'model-a': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.25 } };
    const rounds = scriptedFixRounds([], { costUsd: 0.25, modelUsage: usage });

    const result = await executeUnitTestPhase(makeConfig(unitTests), {
      runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun([], { costUsd: 1 }),
      fixRounds: rounds.port,
    });

    expect(result.costUsd).toBeCloseTo(unitTests ? 1.25 : 0.25);
    expect(result.modelUsage['model-a'].costUSD).toBeCloseTo(0.25);
    expect(result.phaseCostRecords.length).toBeGreaterThan(0);
  });

  it('hands one round every failing check at once', async () => {
    const rounds = scriptedFixRounds([], {});

    await executeUnitTestPhase(makeConfig(unitTests), {
      runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN], build: [RED_BUILD, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun([]),
      fixRounds: rounds.port,
    });

    expect(rounds.fixed).toHaveLength(1);
    expect(rounds.fixed[0].failed.map(verdict => verdict.check)).toEqual(['lint', 'build']);
  });

  it('carries on past any fixed number of rounds while the output keeps changing', async () => {
    const rounds = scriptedFixRounds([], ...Array.from({ length: 9 }, () => ({})));
    const changing = Array.from({ length: 9 }, (_unused, index) => ({ exitCode: 1, output: `${9 - index} problems` }));

    const result = await executeUnitTestPhase(makeConfig(unitTests), {
      runProcess: scriptedProcessRunner([], { lint: [...changing, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun([]),
      fixRounds: rounds.port,
    });

    expect(result.unitTestsPassed).toBe(true);
    expect(rounds.fixed).toHaveLength(9);
  });
});

describe('executeUnitTestPhase — a hard-failed unit-test run', () => {
  it('still ends the run with exit code 1 and the unit-test error', async () => {
    const config = makeConfig(true);

    await expect(
      executeUnitTestPhase(config, {
        runProcess: recordingProcessRunner([]),
        runUnitTestsWithRetry: recordingTestRun([], { reportPresent: true, hasFailures: true, passed: false }),
      }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(process.exit).toHaveBeenCalledWith(1);
    expect(config.ctx.errorMessage).toMatch(/^Unit tests hard-failed/);
    expect(AgentStateManager.readState(config.orchestratorStatePath)?.execution?.status).toBe('failed');
  });

  it('is not a park: no park comment, and no human_gated stage', async () => {
    const workflow = makeWorkflow(true);

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: recordingProcessRunner([]),
        runUnitTestsWithRetry: recordingTestRun([], { reportPresent: true, hasFailures: true, passed: false }),
      }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(parkComments(workflow)).toEqual([]);
    expect(AgentStateManager.readTopLevelState(workflow.config.adwId)?.workflowStage).not.toBe('human_gated');
  });
});
