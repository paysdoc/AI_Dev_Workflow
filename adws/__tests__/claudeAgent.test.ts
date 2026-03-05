import { describe, it, expect } from 'vitest';
import { computeTotalTokens } from '../agents/claudeAgent';
import type { ModelUsageMap } from '../types/costTypes';

describe('computeTotalTokens', () => {
  it('sums tokens for a single model', () => {
    const usage: ModelUsageMap = {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 300,
        costUSD: 0.01,
      },
    };

    const result = computeTotalTokens(usage);

    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
    expect(result.cacheCreationTokens).toBe(300);
    expect(result.total).toBe(1800); // 1000 + 500 + 300
  });

  it('sums tokens across multiple models', () => {
    const usage: ModelUsageMap = {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 300,
        costUSD: 0.01,
      },
      'claude-haiku-3-5-20241022': {
        inputTokens: 2000,
        outputTokens: 800,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 150,
        costUSD: 0.005,
      },
    };

    const result = computeTotalTokens(usage);

    expect(result.inputTokens).toBe(3000);
    expect(result.outputTokens).toBe(1300);
    expect(result.cacheCreationTokens).toBe(450);
    expect(result.total).toBe(4750); // 3000 + 1300 + 450
  });

  it('returns zeros for an empty map', () => {
    const result = computeTotalTokens({});

    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.total).toBe(0);
  });

  it('handles zero values correctly', () => {
    const usage: ModelUsageMap = {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0,
      },
    };

    const result = computeTotalTokens(usage);

    expect(result.total).toBe(0);
  });

  it('excludes cacheReadInputTokens from total', () => {
    const usage: ModelUsageMap = {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 99999,
        cacheCreationInputTokens: 25,
        costUSD: 0.01,
      },
    };

    const result = computeTotalTokens(usage);

    // cacheReadInputTokens should NOT be included in total
    expect(result.total).toBe(175); // 100 + 50 + 25
  });

  it('handles large token counts', () => {
    const usage: ModelUsageMap = {
      'claude-opus-4-6': {
        inputTokens: 150000,
        outputTokens: 40000,
        cacheReadInputTokens: 50000,
        cacheCreationInputTokens: 10000,
        costUSD: 5.0,
      },
    };

    const result = computeTotalTokens(usage);

    expect(result.inputTokens).toBe(150000);
    expect(result.outputTokens).toBe(40000);
    expect(result.cacheCreationTokens).toBe(10000);
    expect(result.total).toBe(200000);
  });
});
