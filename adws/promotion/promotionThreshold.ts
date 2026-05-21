import type { PromotionStats } from './types.ts';

export const BOOTSTRAP_THRESHOLD = 3;

// TODO(slice #7): replace with auto-ramp formula using stats.promotedCount90d /
// stats.totalPerIssueCount90d; see specs/prd/scenario-rot-prevention-and-promotion.md §Activity ratio
export function computeThreshold(_stats: PromotionStats): number {
  return BOOTSTRAP_THRESHOLD;
}
