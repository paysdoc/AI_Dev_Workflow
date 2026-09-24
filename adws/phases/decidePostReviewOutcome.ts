import type { WorkflowStage } from '../types/workflowTypes';

export interface PostReviewOutcome {
  writeAwaitingMerge: boolean;
  workflowStage: WorkflowStage | null;
  /** When true, the calling orchestrator must skip document + PR creation. */
  skipDocAndPR: boolean;
}

/**
 * Performs no I/O — total function over a boolean.
 *
 * SDLC callers must honour skipDocAndPR by exiting before doc+PR phases.
 */
export function decidePostReviewOutcome(reviewPassed: boolean): PostReviewOutcome {
  if (!reviewPassed) {
    return { writeAwaitingMerge: false, workflowStage: 'review_failed', skipDocAndPR: true };
  }
  return { writeAwaitingMerge: true, workflowStage: 'awaiting_merge', skipDocAndPR: false };
}
