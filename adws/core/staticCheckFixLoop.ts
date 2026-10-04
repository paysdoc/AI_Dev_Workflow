import { CheckStatus, combinedCheckOutput, type CheckVerdict } from './checkRunner';
import { evaluateFixRound, type FixRoundGuardConfig, type GuardRejection } from './fixRoundGuard';
import { emptyModelUsageMap, mergeModelUsageMaps, type ModelUsageMap } from '../cost';

export interface FixRoundResult {
  /** What the round's fix agent run changed, as a unified diff. */
  readonly diff: string;
  readonly costUsd: number;
  readonly modelUsage: ModelUsageMap;
}

export interface FixRoundPort {
  fix(failed: readonly CheckVerdict[], round: number): Promise<FixRoundResult>;
  keep(round: number): void | Promise<void>;
  /** Must throw when it cannot revert the round: a rejected change may never survive. */
  discard(round: number): void | Promise<void>;
}

export enum FixLoopStall {
  IdenticalOutput = 'identical_output',
  RejectedRound = 'rejected_round',
}

export type FixLoopEvent =
  | { readonly kind: 'checks_ran'; readonly round: number; readonly verdicts: readonly CheckVerdict[] }
  | { readonly kind: 'round_started'; readonly round: number; readonly failed: readonly CheckVerdict[] }
  | { readonly kind: 'round_kept'; readonly round: number }
  | { readonly kind: 'round_rejected'; readonly round: number; readonly reasons: readonly GuardRejection[] };

export type StaticCheckFixLoopResult =
  | {
      readonly kind: 'green';
      readonly verdicts: readonly CheckVerdict[];
      readonly rounds: number;
      readonly costUsd: number;
      readonly modelUsage: ModelUsageMap;
    }
  | {
      readonly kind: 'stalled';
      readonly stall: FixLoopStall;
      readonly failed: readonly CheckVerdict[];
      /** Why the guard rejected the round; empty when the loop stalled on identical output. */
      readonly rejections: readonly GuardRejection[];
      readonly rounds: number;
      readonly costUsd: number;
      readonly modelUsage: ModelUsageMap;
    };

export interface StaticCheckFixLoopInput {
  readonly runChecks: () => Promise<readonly CheckVerdict[]>;
  readonly fixRounds: FixRoundPort;
  readonly guardConfig: FixRoundGuardConfig;
  readonly report?: (event: FixLoopEvent) => void;
}

interface RoundCost {
  readonly costUsd: number;
  readonly modelUsage: ModelUsageMap;
}

type RoundOutcome =
  | { readonly kind: 'rejected'; readonly reasons: readonly GuardRejection[]; readonly cost: RoundCost }
  | { readonly kind: 'kept'; readonly verdicts: readonly CheckVerdict[]; readonly cost: RoundCost };

function failedChecks(verdicts: readonly CheckVerdict[]): CheckVerdict[] {
  return verdicts.filter(verdict => verdict.status === CheckStatus.Failed);
}

function addCost(total: RoundCost, round: RoundCost): RoundCost {
  return { costUsd: total.costUsd + round.costUsd, modelUsage: mergeModelUsageMaps(total.modelUsage, round.modelUsage) };
}

async function runRound(input: StaticCheckFixLoopInput, verdicts: readonly CheckVerdict[], round: number): Promise<RoundOutcome> {
  const { runChecks, fixRounds, guardConfig, report } = input;
  const failed = failedChecks(verdicts);
  report?.({ kind: 'round_started', round, failed });

  const result = await fixRounds.fix(failed, round);
  const cost = { costUsd: result.costUsd, modelUsage: result.modelUsage };
  const verdict = evaluateFixRound(result.diff, guardConfig);
  if (!verdict.accepted) {
    await fixRounds.discard(round);
    report?.({ kind: 'round_rejected', round, reasons: verdict.reasons });
    return { kind: 'rejected', reasons: verdict.reasons, cost };
  }

  await fixRounds.keep(round);
  report?.({ kind: 'round_kept', round });
  const next = await runChecks();
  report?.({ kind: 'checks_ran', round, verdicts: next });
  return { kind: 'kept', verdicts: next, cost };
}

function stalled(
  stall: FixLoopStall,
  failed: readonly CheckVerdict[],
  rejections: readonly GuardRejection[],
  rounds: number,
  cost: RoundCost,
): StaticCheckFixLoopResult {
  return { kind: 'stalled', stall, failed: failedChecks(failed), rejections, rounds, ...cost };
}

/**
 * The loop has no round limit, by decision: only a round that makes no progress ends it. A round makes
 * none when the guard rejects its change, or when the combined output of the checks is what it was
 * before the round. The loop keeps no state between runs, so a run that starts again after a person
 * asked for a retry begins a round on the very output the earlier run stopped on.
 */
export async function runStaticCheckFixLoop(input: StaticCheckFixLoopInput): Promise<StaticCheckFixLoopResult> {
  let verdicts = await input.runChecks();
  input.report?.({ kind: 'checks_ran', round: 0, verdicts });

  let cost: RoundCost = { costUsd: 0, modelUsage: emptyModelUsageMap() };
  let round = 0;
  while (failedChecks(verdicts).length > 0) {
    round += 1;
    const outcome = await runRound(input, verdicts, round);
    cost = addCost(cost, outcome.cost);
    if (outcome.kind === 'rejected') return stalled(FixLoopStall.RejectedRound, verdicts, outcome.reasons, round, cost);
    if (combinedCheckOutput(outcome.verdicts) === combinedCheckOutput(verdicts)) {
      return stalled(FixLoopStall.IdenticalOutput, outcome.verdicts, [], round, cost);
    }
    verdicts = outcome.verdicts;
  }
  return { kind: 'green', verdicts, rounds: round, ...cost };
}
