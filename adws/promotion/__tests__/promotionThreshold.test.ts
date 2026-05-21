import { describe, it, expect } from 'vitest';
import { computeThreshold, BOOTSTRAP_THRESHOLD, MAX_THRESHOLD, RATIO_CAP } from '../promotionThreshold.ts';
import type { PromotionStats } from '../types.ts';

describe('computeThreshold', () => {
  it('(i) returns BOOTSTRAP_THRESHOLD for { 0, 0 }', () => {
    expect(computeThreshold({ promotedCount90d: 0, totalPerIssueCount90d: 0 })).toBe(BOOTSTRAP_THRESHOLD);
  });

  it('(ii) bootstrap guard fires before division: { 5, 0 } → BOOTSTRAP_THRESHOLD', () => {
    expect(computeThreshold({ promotedCount90d: 5, totalPerIssueCount90d: 0 })).toBe(BOOTSTRAP_THRESHOLD);
  });

  it('(iii) zero-ratio: { 0, 100 } → BOOTSTRAP_THRESHOLD', () => {
    expect(computeThreshold({ promotedCount90d: 0, totalPerIssueCount90d: 100 })).toBe(3);
  });

  it('(iv) low-ratio: { 5, 100 } → 3 (rounds down)', () => {
    // ratio = 0.05; cappedRatio = 0.1; 3 + round(4 * 0.1) = 3 + 0 = 3
    expect(computeThreshold({ promotedCount90d: 5, totalPerIssueCount90d: 100 })).toBe(3);
  });

  it('(v) mid-low-ratio: { 12, 100 } → 4', () => {
    // ratio = 0.12; cappedRatio = 0.24; 3 + round(4 * 0.24) = 3 + 1 = 4
    expect(computeThreshold({ promotedCount90d: 12, totalPerIssueCount90d: 100 })).toBe(4);
  });

  it('(vi) mid-ratio: { 25, 100 } → 5', () => {
    // ratio = 0.25; cappedRatio = 0.5; 3 + round(4 * 0.5) = 3 + 2 = 5
    expect(computeThreshold({ promotedCount90d: 25, totalPerIssueCount90d: 100 })).toBe(5);
  });

  it('(vii) mid-high-ratio: { 40, 100 } → 6', () => {
    // ratio = 0.4; cappedRatio = 0.8; 3 + round(4 * 0.8) = 3 + 3 = 6
    expect(computeThreshold({ promotedCount90d: 40, totalPerIssueCount90d: 100 })).toBe(6);
  });

  it('(viii) saturation at RATIO_CAP: { 50, 100 } → MAX_THRESHOLD', () => {
    // ratio = 0.5; cappedRatio = 1.0; 3 + round(4 * 1.0) = 7
    expect(computeThreshold({ promotedCount90d: 50, totalPerIssueCount90d: 100 })).toBe(MAX_THRESHOLD);
  });

  it('(ix) above-cap: { 90, 100 } → MAX_THRESHOLD (saturates)', () => {
    expect(computeThreshold({ promotedCount90d: 90, totalPerIssueCount90d: 100 })).toBe(MAX_THRESHOLD);
  });

  it('(x) full-ratio: { 100, 100 } → MAX_THRESHOLD', () => {
    expect(computeThreshold({ promotedCount90d: 100, totalPerIssueCount90d: 100 })).toBe(MAX_THRESHOLD);
  });

  it('(xi) produces a monotonically non-decreasing N as ratio rises', () => {
    const series: PromotionStats[] = [
      { promotedCount90d: 0, totalPerIssueCount90d: 100 },
      { promotedCount90d: 5, totalPerIssueCount90d: 100 },
      { promotedCount90d: 12, totalPerIssueCount90d: 100 },
      { promotedCount90d: 25, totalPerIssueCount90d: 100 },
      { promotedCount90d: 40, totalPerIssueCount90d: 100 },
      { promotedCount90d: 50, totalPerIssueCount90d: 100 },
      { promotedCount90d: 100, totalPerIssueCount90d: 100 },
    ];
    for (let i = 1; i < series.length; i++) {
      expect(computeThreshold(series[i])).toBeGreaterThanOrEqual(computeThreshold(series[i - 1]));
    }
  });

  it('constants are exported with the expected values', () => {
    expect(BOOTSTRAP_THRESHOLD).toBe(3);
    expect(MAX_THRESHOLD).toBe(7);
    expect(RATIO_CAP).toBe(0.5);
  });
});
