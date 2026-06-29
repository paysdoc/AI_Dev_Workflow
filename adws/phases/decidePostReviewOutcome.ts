import type { WorkflowStage } from '../types/workflowTypes';

export interface PostReviewOutcome {
  writeAwaitingMerge: boolean;
  workflowStage: WorkflowStage | null;
}

/**
 * Pure gate: a passed review proceeds to `awaiting_merge`; a failed review stops.
 * Performs no I/O — total function over a boolean.
 */
export function decidePostReviewOutcome(reviewPassed: boolean): PostReviewOutcome {
  if (!reviewPassed) return { writeAwaitingMerge: false, workflowStage: null };
  return { writeAwaitingMerge: true, workflowStage: 'awaiting_merge' };
}
