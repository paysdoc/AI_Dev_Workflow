import { describe, it, expect } from 'vitest';
import { decidePostReviewOutcome } from '../decidePostReviewOutcome';

describe('decidePostReviewOutcome', () => {
  it('returns proceed + awaiting_merge for a passing review', () => {
    expect(decidePostReviewOutcome(true)).toEqual({ writeAwaitingMerge: true, workflowStage: 'awaiting_merge' });
  });

  it('returns stop + null for a failing review', () => {
    expect(decidePostReviewOutcome(false)).toEqual({ writeAwaitingMerge: false, workflowStage: null });
  });

  it('is pure: repeated calls with the same arg return equal results', () => {
    expect(decidePostReviewOutcome(true)).toEqual(decidePostReviewOutcome(true));
    expect(decidePostReviewOutcome(false)).toEqual(decidePostReviewOutcome(false));
  });
});
