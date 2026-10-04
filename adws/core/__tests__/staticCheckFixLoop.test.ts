import { describe, it, expect } from 'vitest';
import { CheckStatus, StaticCheckName, type CheckVerdict } from '../checkRunner';
import { buildFixRoundGuardConfig } from '../fixRoundGuard';
import {
  FixLoopStall,
  runStaticCheckFixLoop,
  type FixLoopEvent,
  type FixRoundPort,
  type FixRoundResult,
} from '../staticCheckFixLoop';
import { RateLimitError } from '../../types/agentTypes';
import type { ModelUsageMap } from '../../cost';

const GUARD_CONFIG = buildFixRoundGuardConfig(['javascript'], '');

const CLEAN_DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '-let total = 0;', '+const total = 0;'].join('\n');
const SUPPRESSING_DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1,2 @@', ' let total = 0;', '+// eslint-disable-next-line prefer-const'].join('\n');
const CONFIG_DIFF = ['diff --git a/tsconfig.json b/tsconfig.json', '--- a/tsconfig.json', '+++ b/tsconfig.json', '@@ -1 +1 @@', '-{ "strict": true }', '+{ "strict": false }'].join('\n');

function verdict(check: StaticCheckName, status: CheckStatus, output = ''): CheckVerdict {
  const exitCode = status === CheckStatus.Skipped ? null : status === CheckStatus.Passed ? 0 : 1;
  return { check, command: `run ${check}`, status, exitCode, output };
}

/** One run of the four checks with the lint failing and printing `lintOutput`; the others pass or are skipped. */
function lintFailing(lintOutput: string): readonly CheckVerdict[] {
  return [
    verdict(StaticCheckName.TypeCheck, CheckStatus.Passed, 'src: 0 errors\n'),
    verdict(StaticCheckName.AdditionalTypeChecks, CheckStatus.Skipped),
    verdict(StaticCheckName.Lint, CheckStatus.Failed, lintOutput),
    verdict(StaticCheckName.Build, CheckStatus.Passed, 'build finished\n'),
  ];
}

function allGreen(): readonly CheckVerdict[] {
  return [
    verdict(StaticCheckName.TypeCheck, CheckStatus.Passed, 'src: 0 errors\n'),
    verdict(StaticCheckName.AdditionalTypeChecks, CheckStatus.Skipped),
    verdict(StaticCheckName.Lint, CheckStatus.Passed, '0 problems\n'),
    verdict(StaticCheckName.Build, CheckStatus.Passed, 'build finished\n'),
  ];
}

/** Hands out the scripted runs in order, and fails the test when the loop asks for one more than the script holds. */
function scriptedChecks(...runs: ReadonlyArray<readonly CheckVerdict[]>) {
  let ran = 0;
  return {
    runChecks: async (): Promise<readonly CheckVerdict[]> => {
      const run = runs[ran];
      if (run === undefined) throw new Error(`The loop ran the checks ${ran + 1} time(s), but the script holds ${runs.length} run(s)`);
      ran += 1;
      return run;
    },
    timesRan: () => ran,
  };
}

interface ScriptedRound {
  readonly diff?: string;
  readonly costUsd?: number;
  readonly modelUsage?: ModelUsageMap;
  readonly error?: Error;
}

/** The n-th call of `fix`, across every loop run that uses the port, gets the n-th scripted round. */
function scriptedRounds(...rounds: readonly ScriptedRound[]) {
  const fixed: { readonly failed: readonly CheckVerdict[]; readonly round: number }[] = [];
  const kept: number[] = [];
  const discarded: number[] = [];
  const port: FixRoundPort = {
    async fix(failed, round): Promise<FixRoundResult> {
      const scripted = rounds[fixed.length];
      fixed.push({ failed, round });
      if (scripted === undefined) throw new Error(`The loop started fix round call ${fixed.length}, but the script holds ${rounds.length}`);
      if (scripted.error) throw scripted.error;
      return { diff: scripted.diff ?? CLEAN_DIFF, costUsd: scripted.costUsd ?? 0, modelUsage: scripted.modelUsage ?? {} };
    },
    keep: (round) => {
      kept.push(round);
    },
    discard: (round) => {
      discarded.push(round);
    },
  };
  return { port, fixed, kept, discarded };
}

function usage(costUSD: number): ModelUsageMap {
  return { 'model-a': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD } };
}

describe('runStaticCheckFixLoop — green at once', () => {
  it('starts no round when the first run is green', async () => {
    const checks = scriptedChecks(allGreen());
    const rounds = scriptedRounds();

    const result = await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(result).toMatchObject({ kind: 'green', rounds: 0, costUsd: 0, modelUsage: {} });
    expect(rounds.fixed).toEqual([]);
    expect(checks.timesRan()).toBe(1);
  });
});

describe('runStaticCheckFixLoop — a changed output is progress', () => {
  it('carries on while the output changes, and ends green once every check passes', async () => {
    const checks = scriptedChecks(lintFailing('3 problems\n'), lintFailing('2 problems\n'), allGreen());
    const rounds = scriptedRounds({}, {});

    const result = await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(result).toMatchObject({ kind: 'green', rounds: 2 });
    expect(checks.timesRan()).toBe(3);
    expect(rounds.kept).toEqual([1, 2]);
    expect(rounds.discarded).toEqual([]);
  });

  it('hands each round the checks that failed in the latest run', async () => {
    const first = lintFailing('3 problems\n');
    const second = lintFailing('2 problems\n');
    const checks = scriptedChecks(first, second, allGreen());
    const rounds = scriptedRounds({}, {});

    await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(rounds.fixed.map(call => call.round)).toEqual([1, 2]);
    expect(rounds.fixed[0].failed).toEqual([first[2]]);
    expect(rounds.fixed[1].failed).toEqual([second[2]]);
  });

  it('hands the fix agent the failing checks only: passed and skipped ones stay out', async () => {
    const run = [
      verdict(StaticCheckName.TypeCheck, CheckStatus.Failed, 'src/a.ts(1,1): error TS2322\n'),
      verdict(StaticCheckName.AdditionalTypeChecks, CheckStatus.Skipped),
      verdict(StaticCheckName.Lint, CheckStatus.Failed, '2 problems\n'),
      verdict(StaticCheckName.Build, CheckStatus.Passed, 'build finished\n'),
    ];
    const checks = scriptedChecks(run, allGreen());
    const rounds = scriptedRounds({});

    await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(rounds.fixed[0].failed.map(failed => failed.check)).toEqual([StaticCheckName.TypeCheck, StaticCheckName.Lint]);
  });

  it('judges progress on the combined output: one check unchanged and another changed is progress', async () => {
    const typeError = verdict(StaticCheckName.TypeCheck, CheckStatus.Failed, 'src/a.ts(4,3): error TS2322\n');
    const before = [typeError, verdict(StaticCheckName.Lint, CheckStatus.Failed, '2 problems\n')];
    const after = [typeError, verdict(StaticCheckName.Lint, CheckStatus.Failed, '1 problem\n')];
    const checks = scriptedChecks(before, after, allGreen());
    const rounds = scriptedRounds({}, {});

    const result = await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(result).toMatchObject({ kind: 'green', rounds: 2 });
  });

  it('has no cap: twelve rounds, each changing the output, are twelve rounds', async () => {
    const changing = Array.from({ length: 12 }, (_unused, index) => lintFailing(`${12 - index} problems\n`));
    const checks = scriptedChecks(...changing, allGreen());
    const rounds = scriptedRounds(...Array.from({ length: 12 }, () => ({})));

    const result = await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(result).toMatchObject({ kind: 'green', rounds: 12 });
    expect(rounds.kept).toHaveLength(12);
  });
});

describe('runStaticCheckFixLoop — identical output is no progress', () => {
  it('stops when a round leaves the output as it was', async () => {
    const red = lintFailing('2 problems\n');
    const checks = scriptedChecks(red, lintFailing('2 problems\n'));
    const rounds = scriptedRounds({});

    const result = await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(result).toMatchObject({ kind: 'stalled', stall: FixLoopStall.IdenticalOutput, rounds: 1, rejections: [] });
    expect(result.kind === 'stalled' && result.failed).toEqual([red[2]]);
    expect(rounds.fixed).toHaveLength(1);
    expect(rounds.kept).toEqual([1]);
  });

  it('stops at the first round that makes no progress, however many made some', async () => {
    const checks = scriptedChecks(lintFailing('3 problems\n'), lintFailing('2 problems\n'), lintFailing('2 problems\n'));
    const rounds = scriptedRounds({}, {});

    const result = await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(result).toMatchObject({ kind: 'stalled', stall: FixLoopStall.IdenticalOutput, rounds: 2 });
  });

  it('reports the failing checks of the latest run as the ones that stalled', async () => {
    const stalledRun = [verdict(StaticCheckName.TypeCheck, CheckStatus.Failed, 'error\n'), verdict(StaticCheckName.Lint, CheckStatus.Failed, 'problem\n')];
    const checks = scriptedChecks(stalledRun, stalledRun);
    const rounds = scriptedRounds({});

    const result = await runStaticCheckFixLoop({ runChecks: checks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(result.kind === 'stalled' && result.failed.map(failed => failed.check)).toEqual([StaticCheckName.TypeCheck, StaticCheckName.Lint]);
  });

  it('keeps no state between runs: a resumed run starts a round although the output is the one the loop stopped on', async () => {
    const rounds = scriptedRounds({}, {});
    const firstChecks = scriptedChecks(lintFailing('2 problems\n'), lintFailing('2 problems\n'));
    const stalled = await runStaticCheckFixLoop({ runChecks: firstChecks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });
    expect(stalled).toMatchObject({ kind: 'stalled', stall: FixLoopStall.IdenticalOutput });

    const resumedChecks = scriptedChecks(lintFailing('2 problems\n'), allGreen());
    const resumed = await runStaticCheckFixLoop({ runChecks: resumedChecks.runChecks, fixRounds: rounds.port, guardConfig: GUARD_CONFIG });

    expect(resumed).toMatchObject({ kind: 'green', rounds: 1 });
    expect(rounds.fixed).toHaveLength(2);
    expect(rounds.fixed[1].round).toBe(1);
  });
});

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
