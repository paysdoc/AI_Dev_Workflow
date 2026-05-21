import type { PromotionStats } from './types.ts';

export const BOOTSTRAP_THRESHOLD = 3;
// One above the max realistic non-extra-phase score (3 surface + 3 subprocess = 6).
export const MAX_THRESHOLD = 7;
// Mature-curation saturation point: half of per-issue scenarios promoted = full ramp.
export const RATIO_CAP = 0.5;

export function computeThreshold(stats: PromotionStats): number {
  if (stats.totalPerIssueCount90d === 0) return BOOTSTRAP_THRESHOLD;
  const ratio = stats.promotedCount90d / stats.totalPerIssueCount90d;
  const cappedRatio = Math.min(ratio, RATIO_CAP) / RATIO_CAP;
  const span = MAX_THRESHOLD - BOOTSTRAP_THRESHOLD;
  return BOOTSTRAP_THRESHOLD + Math.round(span * cappedRatio);
}
