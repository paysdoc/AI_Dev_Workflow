import { describe, it, expect } from 'vitest';
import { computeCost, checkDivergence } from '../computation';
import { ANTHROPIC_PRICING } from '../providers/anthropic/pricing';

describe('computeCost', () => {
  it('computes cost for a single token type', () => {
    const usage = { input: 1_000_000 };
    const pricing = { input: 0.000005 };
    expect(computeCost(usage, pricing)).toBeCloseTo(5.0);
  });

  it('computes cost for multiple token types with Anthropic sonnet pricing', () => {
    const usage = { input: 1000, output: 500, cache_read: 200 };
    const pricing = ANTHROPIC_PRICING['sonnet']!;
    const expected =
      1000 * pricing['input']! +
      500 * pricing['output']! +
      200 * pricing['cache_read']!;
    expect(computeCost(usage, pricing)).toBeCloseTo(expected);
  });

  it('returns zero for usage keys with no matching pricing key', () => {
    const usage = { reasoning: 1000 };
    const pricing = { input: 0.000005 };
    expect(computeCost(usage, pricing)).toBe(0);
  });

  it('returns zero for empty usage map', () => {
    expect(computeCost({}, { input: 0.000005 })).toBe(0);
  });

  it('returns zero for empty pricing map', () => {
    expect(computeCost({ input: 1000 }, {})).toBe(0);
  });

  it('handles large token counts without overflow', () => {
    const usage = { input: 1_000_000_000 };
    const pricing = { input: 0.000005 };
    expect(computeCost(usage, pricing)).toBeCloseTo(5000);
  });

  it('ignores pricing keys with no matching usage key', () => {
    const usage = { input: 1000 };
    const pricing = { input: 0.000005, output: 0.000025 };
    expect(computeCost(usage, pricing)).toBeCloseTo(1000 * 0.000005);
  });
});

describe('checkDivergence', () => {
  it('returns not divergent when computed equals reported', () => {
    const result = checkDivergence(1.0, 1.0);
    expect(result.isDivergent).toBe(false);
    expect(result.percentDiff).toBe(0);
  });

  it('returns not divergent when difference is below 4.9%', () => {
    const reported = 1.0;
    const computed = 1.0 * (1 + 0.049);
    const result = checkDivergence(computed, reported);
    expect(result.isDivergent).toBe(false);
  });

  it('returns divergent when difference is above 5.1%', () => {
    const reported = 1.0;
    const computed = 1.0 * (1 + 0.051);
    const result = checkDivergence(computed, reported);
    expect(result.isDivergent).toBe(true);
  });

  it('returns not divergent at exactly 5.0% (threshold is exclusive)', () => {
    const reported = 100;
    const computed = 105;
    const result = checkDivergence(computed, reported);
    expect(result.isDivergent).toBe(false);
    expect(result.percentDiff).toBeCloseTo(5.0);
  });

  it('returns divergent when reported is 0 and computed is greater than 0', () => {
    const result = checkDivergence(1.0, 0);
    expect(result.isDivergent).toBe(true);
    expect(result.percentDiff).toBe(Infinity);
  });

  it('returns not divergent when both costs are 0', () => {
    const result = checkDivergence(0, 0);
    expect(result.isDivergent).toBe(false);
    expect(result.percentDiff).toBe(0);
  });

  it('returns not divergent when reportedCostUsd is undefined', () => {
    const result = checkDivergence(1.0, undefined);
    expect(result.isDivergent).toBe(false);
    expect(result.percentDiff).toBe(0);
    expect(result.reportedCostUsd).toBeUndefined();
  });

  it('uses custom threshold correctly — 7% diff with 10% threshold is not divergent', () => {
    const reported = 1.0;
    const computed = 1.07;
    const result = checkDivergence(computed, reported, 10);
    expect(result.isDivergent).toBe(false);
  });

  it('includes computedCostUsd and reportedCostUsd in result', () => {
    const result = checkDivergence(1.5, 1.0);
    expect(result.computedCostUsd).toBe(1.5);
    expect(result.reportedCostUsd).toBe(1.0);
  });
});
