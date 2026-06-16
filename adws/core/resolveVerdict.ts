export type ResolveVerdictOutcome = 'pass' | 'retry' | 'hard-fail';

export interface ResolveVerdictSignals {
  targetPass: boolean;
  regressionPass: boolean;
  postResolveAligned?: boolean;
  budgetRemaining: boolean;
}

export function computeResolveVerdict(signals: ResolveVerdictSignals): ResolveVerdictOutcome {
  const { targetPass, regressionPass, postResolveAligned, budgetRemaining } = signals;

  const isGreen = targetPass && regressionPass;

  if (!isGreen) {
    return budgetRemaining ? 'retry' : 'hard-fail';
  }

  if (postResolveAligned === false) {
    return 'hard-fail';
  }

  return 'pass';
}
