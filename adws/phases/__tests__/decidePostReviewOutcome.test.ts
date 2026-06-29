import { describe, it, expect } from 'vitest';
import { decidePostReviewOutcome } from '../decidePostReviewOutcome';

describe('decidePostReviewOutcome', () => {
  it('returns proceed + awaiting_merge for a passing review', () => {
    expect(decidePostReviewOutcome(true)).toEqual({
      writeAwaitingMerge: true,
      workflowStage: 'awaiting_merge',
      skipDocAndPR: false,
    });
  });

  it('returns stop + review_failed + skipDocAndPR for a failing review', () => {
    expect(decidePostReviewOutcome(false)).toEqual({
      writeAwaitingMerge: false,
      workflowStage: 'review_failed',
      skipDocAndPR: true,
    });
  });

  it('is pure: repeated calls with the same arg return equal results', () => {
    expect(decidePostReviewOutcome(true)).toEqual(decidePostReviewOutcome(true));
    expect(decidePostReviewOutcome(false)).toEqual(decidePostReviewOutcome(false));
  });
});
