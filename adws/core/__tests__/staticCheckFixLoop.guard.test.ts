import { describe, it, expect } from 'vitest';
import { buildFixRoundGuardConfig } from '../fixRoundGuard';
import {
  FixLoopStall,
  runStaticCheckFixLoop,
  type FixLoopEvent,
  type FixRoundPort,
} from '../staticCheckFixLoop';
import { RateLimitError } from '../../types/agentTypes';
import type { ModelUsageMap } from '../../cost';
import {
  CONFIG_DIFF,
  GUARD_CONFIG,
  SUPPRESSING_DIFF,
  allGreen,
  lintFailing,
  scriptedChecks,
  scriptedRounds,
} from './staticCheckFixLoopHelpers';

function usage(costUSD: number): ModelUsageMap {
  return { 'model-a': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD } };
}

describe('runStaticCheckFixLoop — a rejected round is no progress', () => {
  it('discards a round that adds a suppression, keeps nothing, and does not run the checks again', async () => {
    const red = lintFailing('2 problems\n');
    const checks = scriptedChecks(red);
    const rounds = scriptedRounds({ diff: SUPPRESSING_DIFF });

    const result = await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(result).toMatchObject({ kind: 'stalled', stall: FixLoopStall.RejectedRound, rounds: 1 });
    expect(result.kind === 'stalled' && result.rejections.map(rejection => [rejection.kind, rejection.path])).toEqual([['suppression', 'src/a.ts']]);
    expect(result.kind === 'stalled' && result.failed).toEqual([red[2]]);
    expect(rounds.discarded).toEqual([1]);
    expect(rounds.kept).toEqual([]);
    expect(checks.timesRan()).toBe(1);
  });

  it('discards a round that touches a protected file', async () => {
    const checks = scriptedChecks(lintFailing('2 problems\n'));
    const rounds = scriptedRounds({ diff: CONFIG_DIFF });

    const result = await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(result).toMatchObject({ kind: 'stalled', stall: FixLoopStall.RejectedRound });
    expect(result.kind === 'stalled' && result.rejections.map(rejection => rejection.path)).toEqual(['tsconfig.json']);
    expect(rounds.discarded).toEqual([1]);
    expect(rounds.kept).toEqual([]);
  });

  it('discards a rejected round after earlier rounds were kept, and counts every round it started', async () => {
    const checks = scriptedChecks(lintFailing('3 problems\n'), lintFailing('2 problems\n'));
    const rounds = scriptedRounds({}, { diff: SUPPRESSING_DIFF });

    const result = await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(result).toMatchObject({ kind: 'stalled', stall: FixLoopStall.RejectedRound, rounds: 2 });
    expect(rounds.kept).toEqual([1]);
    expect(rounds.discarded).toEqual([2]);
  });

  it('judges a round by the guard configuration it is given', async () => {
    const config = buildFixRoundGuardConfig(['javascript'], '- `@acme-off`');
    const checks = scriptedChecks(lintFailing('2 problems\n'));
    const diff = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1,2 @@', ' let total = 0;', '+// @acme-off'].join('\n');
    const rounds = scriptedRounds({ diff });

    const result = await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: config });

    expect(result).toMatchObject({ kind: 'stalled', stall: FixLoopStall.RejectedRound });
  });
});

describe('runStaticCheckFixLoop — cost', () => {
  it('sums the cost and the model usage of every round when the loop ends green', async () => {
    const checks = scriptedChecks(lintFailing('3 problems\n'), lintFailing('2 problems\n'), allGreen());
    const rounds = scriptedRounds({ costUsd: 0.25, modelUsage: usage(0.25) }, { costUsd: 0.5, modelUsage: usage(0.5) });

    const result = await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(result.costUsd).toBeCloseTo(0.75);
    expect(result.modelUsage['model-a'].costUSD).toBeCloseTo(0.75);
    expect(result.modelUsage['model-a'].inputTokens).toBe(20);
  });

  it('sums the cost of every round when the loop stalls, a rejected round included', async () => {
    const checks = scriptedChecks(lintFailing('3 problems\n'), lintFailing('2 problems\n'));
    const rounds = scriptedRounds({ costUsd: 0.25, modelUsage: usage(0.25) }, { diff: SUPPRESSING_DIFF, costUsd: 0.5, modelUsage: usage(0.5) });

    const result = await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(result.kind).toBe('stalled');
    expect(result.costUsd).toBeCloseTo(0.75);
    expect(result.modelUsage['model-a'].costUSD).toBeCloseTo(0.75);
  });
});

describe('runStaticCheckFixLoop — errors', () => {
  it('lets the error of a round propagate unchanged', async () => {
    const error = new RateLimitError('test');
    const checks = scriptedChecks(lintFailing('2 problems\n'));
    const rounds = scriptedRounds({ error });

    await expect(
      runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG }),
    ).rejects.toBe(error);
  });

  it('lets the error of a discard that fails propagate, so that a round which could not be reverted is never taken for rejected and done with', async () => {
    const failure = new Error('HEAD is not the round base');
    const rounds = scriptedRounds({ diff: SUPPRESSING_DIFF });
    const port: FixRoundPort = { ...rounds.port, discard: () => { throw failure; } };
    const checks = scriptedChecks(lintFailing('2 problems\n'));

    await expect(
      runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: port, guardConfig: GUARD_CONFIG }),
    ).rejects.toBe(failure);
  });
});

describe('runStaticCheckFixLoop — report', () => {
  it('reports each check run, round start, kept round and rejected round, in order', async () => {
    const events: FixLoopEvent[] = [];
    const first = lintFailing('3 problems\n');
    const second = lintFailing('2 problems\n');
    const checks = scriptedChecks(first, second);
    const rounds = scriptedRounds({}, { diff: SUPPRESSING_DIFF });

    await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG, report: event => events.push(event) });

    expect(events.map(event => [event.kind, event.round])).toEqual([
      ['checks_ran', 0],
      ['round_started', 1],
      ['round_kept', 1],
      ['checks_ran', 1],
      ['round_started', 2],
      ['round_rejected', 2],
    ]);
    expect(events[0]).toMatchObject({ verdicts: first });
    expect(events[1]).toMatchObject({ failed: [first[2]] });
    expect(events[3]).toMatchObject({ verdicts: second });
    expect(events[5]).toMatchObject({ reasons: [{ kind: 'suppression', path: 'src/a.ts' }] });
  });

  it('runs without a report callback', async () => {
    const checks = scriptedChecks(allGreen());

    await expect(
      runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: scriptedRounds().port, guardConfig: GUARD_CONFIG }),
    ).resolves.toMatchObject({ kind: 'green' });
  });
});
