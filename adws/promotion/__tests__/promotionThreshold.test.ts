import { describe, it, expect } from 'vitest';
import { computeThreshold } from '../promotionThreshold.ts';

describe('computeThreshold', () => {
  it('returns 3 for zero stats (bootstrap case)', () => {
    expect(computeThreshold({ promotedCount90d: 0, totalPerIssueCount90d: 0 })).toBe(3);
  });

  it('returns 3 for low promotion ratio', () => {
    expect(computeThreshold({ promotedCount90d: 1, totalPerIssueCount90d: 100 })).toBe(3);
  });

  it('returns 3 for high promotion ratio', () => {
    expect(computeThreshold({ promotedCount90d: 90, totalPerIssueCount90d: 100 })).toBe(3);
  });

  it('accepts the PromotionStats interface shape without type error', () => {
    const stats = { promotedCount90d: 42, totalPerIssueCount90d: 50 };
    const result = computeThreshold(stats);
    expect(typeof result).toBe('number');
  });
});
