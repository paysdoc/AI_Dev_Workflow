import { describe, it, expect } from 'vitest';
import { CheckStatus, StaticCheckName } from '../checkRunner';
import { FixLoopStall, runStaticCheckFixLoop } from '../staticCheckFixLoop';
import { GUARD_CONFIG, allGreen, lintFailing, scriptedChecks, scriptedRounds, verdict } from './staticCheckFixLoopHelpers';

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
