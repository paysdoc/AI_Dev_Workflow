import { CheckStatus, StaticCheckName, type CheckVerdict } from '../checkRunner';
import { buildFixRoundGuardConfig } from '../fixRoundGuard';
import type { FixRoundPort, FixRoundResult } from '../staticCheckFixLoop';
import type { ModelUsageMap } from '../../cost';

export const GUARD_CONFIG = buildFixRoundGuardConfig(['javascript'], '');

export const CLEAN_DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1 @@', '-let total = 0;', '+const total = 0;'].join('\n');
export const SUPPRESSING_DIFF = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1,2 @@', ' let total = 0;', '+// eslint-disable-next-line prefer-const'].join('\n');
export const CONFIG_DIFF = ['diff --git a/tsconfig.json b/tsconfig.json', '--- a/tsconfig.json', '+++ b/tsconfig.json', '@@ -1 +1 @@', '-{ "strict": true }', '+{ "strict": false }'].join('\n');

export function verdict(check: StaticCheckName, status: CheckStatus, output = ''): CheckVerdict {
  const exitCode = status === CheckStatus.Skipped ? null : status === CheckStatus.Passed ? 0 : 1;
  return { check, command: `run ${check}`, status, exitCode, output };
}

/** One run of the four checks with the lint failing and printing `lintOutput`; the others pass or are skipped. */
export function lintFailing(lintOutput: string): readonly CheckVerdict[] {
  return [
    verdict(StaticCheckName.TypeCheck, CheckStatus.Passed, 'src: 0 errors\n'),
    verdict(StaticCheckName.AdditionalTypeChecks, CheckStatus.Skipped),
    verdict(StaticCheckName.Lint, CheckStatus.Failed, lintOutput),
    verdict(StaticCheckName.Build, CheckStatus.Passed, 'build finished\n'),
  ];
}

export function allGreen(): readonly CheckVerdict[] {
  return [
    verdict(StaticCheckName.TypeCheck, CheckStatus.Passed, 'src: 0 errors\n'),
    verdict(StaticCheckName.AdditionalTypeChecks, CheckStatus.Skipped),
    verdict(StaticCheckName.Lint, CheckStatus.Passed, '0 problems\n'),
    verdict(StaticCheckName.Build, CheckStatus.Passed, 'build finished\n'),
  ];
}

/** Hands out the scripted runs in order, and fails the test when the loop asks for one more than the script holds. */
export function scriptedChecks(...runs: ReadonlyArray<readonly CheckVerdict[]>) {
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

export interface ScriptedRound {
  readonly diff?: string;
  readonly costUsd?: number;
  readonly modelUsage?: ModelUsageMap;
  readonly error?: Error;
}

/** The n-th call of `fix`, across every loop run that uses the port, gets the n-th scripted round. */
export function scriptedRounds(...rounds: readonly ScriptedRound[]) {
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
