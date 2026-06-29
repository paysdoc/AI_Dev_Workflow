import type { WorkflowStage } from '../types/workflowTypes';

export interface PostReviewOutcome {
  writeAwaitingMerge: boolean;
  workflowStage: WorkflowStage | null;
  /** When true, the calling orchestrator must skip document + PR creation. */
  skipDocAndPR: boolean;
}

/**
 * Pure gate: a passed review proceeds to `awaiting_merge`; a failed review
 * enters the `review_failed` human-gated blocking stage.
 * Performs no I/O — total function over a boolean.
 *
 * On pass:  write awaiting_merge, proceed with doc/PR (skipDocAndPR: false).
 * On fail:  write review_failed, skip doc/PR (skipDocAndPR: true).
 *           SDLC callers must honour skipDocAndPR by exiting before doc+PR phases.
 */
export function decidePostReviewOutcome(reviewPassed: boolean): PostReviewOutcome {
  if (!reviewPassed) {
    return { writeAwaitingMerge: false, workflowStage: 'review_failed', skipDocAndPR: true };
  }
  return { writeAwaitingMerge: true, workflowStage: 'awaiting_merge', skipDocAndPR: false };
}
