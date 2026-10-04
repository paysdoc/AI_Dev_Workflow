import { describe, it, expect } from 'vitest';
import { AgentStateManager } from '../../core/agentState';
import { executeUnitTestPhase } from '../unitTestPhase';
import {
  ACME_DIFF,
  CHECK_COMMANDS,
  ExitSignal,
  GREEN,
  RED_LINT,
  SUPPRESSING_DIFF,
  executionLog,
  makeConfig,
  makeWorkflow,
  parkComments,
  recordingTestRun,
  scriptedFixRounds,
  scriptedProcessRunner,
  useUnitTestPhaseSandbox,
} from './unitTestPhase.helpers';

useUnitTestPhaseSandbox();

describe.each([true, false])('executeUnitTestPhase — a fix round the guard rejects, with unitTests %s', (unitTests) => {
  it('discards the round, runs the checks no more, and parks with the guard’s reasons', async () => {
    const events: string[] = [];
    const workflow = makeWorkflow(unitTests);
    const rounds = scriptedFixRounds(events, { diff: SUPPRESSING_DIFF });

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: scriptedProcessRunner(events, { lint: [RED_LINT, GREEN] }),
        runUnitTestsWithRetry: recordingTestRun(events),
        fixRounds: rounds.port,
      }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(rounds.discarded).toEqual([1]);
    expect(rounds.kept).toEqual([]);
    expect(events.filter(event => event === 'check:lint')).toHaveLength(1);
    expect(AgentStateManager.readTopLevelState(workflow.config.adwId)?.workflowStage).toBe('human_gated');
    const [comment] = parkComments(workflow);
    expect(comment).toContain('The fix-round guard rejected the change that fix round 1 made');
    expect(comment).toContain('`src/a.ts` adds `@ts-ignore` (javascript suppression pattern)');
    expect(events).not.toContain('tests');
  });

  it('logs the guard’s reasons in the execution log', async () => {
    const workflow = makeWorkflow(unitTests);

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN] }),
        runUnitTestsWithRetry: recordingTestRun([]),
        fixRounds: scriptedFixRounds([], { diff: SUPPRESSING_DIFF }).port,
      }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(executionLog(workflow.config)).toContain('rejected by the fix-round guard');
    expect(executionLog(workflow.config)).toContain('`src/a.ts` adds `@ts-ignore`');
  });
});

describe('executeUnitTestPhase — the repository’s own suppression patterns', () => {
  it('rejects a round that adds a pattern the repository lists in "## Suppression Patterns"', async () => {
    const workflow = makeWorkflow(true, { ...CHECK_COMMANDS, suppressionPatterns: '- `@acme-off`' });
    const rounds = scriptedFixRounds([], { diff: ACME_DIFF });

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN] }),
        runUnitTestsWithRetry: recordingTestRun([]),
        fixRounds: rounds.port,
      }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(rounds.discarded).toEqual([1]);
    expect(parkComments(workflow)[0]).toContain('adds `@acme-off` (suppression pattern from .adw/commands.md)');
  });

  it('accepts the same round when the repository lists no such pattern', async () => {
    const rounds = scriptedFixRounds([], { diff: ACME_DIFF });

    await executeUnitTestPhase(makeConfig(true), {
      runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN] }),
      runUnitTestsWithRetry: recordingTestRun([]),
      fixRounds: rounds.port,
    });

    expect(rounds.kept).toEqual([1]);
  });

  it('logs an entry that tries to remove a framework pattern, and still rejects the suppression', async () => {
    const workflow = makeWorkflow(true, { ...CHECK_COMMANDS, suppressionPatterns: '- !@ts-ignore' });
    const rounds = scriptedFixRounds([], { diff: SUPPRESSING_DIFF });

    await expect(
      executeUnitTestPhase(workflow.config, {
        runProcess: scriptedProcessRunner([], { lint: [RED_LINT, GREEN] }),
        runUnitTestsWithRetry: recordingTestRun([]),
        fixRounds: rounds.port,
      }),
    ).rejects.toBeInstanceOf(ExitSignal);

    expect(executionLog(workflow.config)).toContain('!@ts-ignore');
    expect(rounds.discarded).toEqual([1]);
  });
});
