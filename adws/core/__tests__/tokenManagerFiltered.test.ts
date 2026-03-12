import { describe, it, expect } from 'vitest';
import { isModelMatch, computePrimaryModelTokens, computeDisplayTokens } from '../tokenManager';
import type { ModelUsageMap } from '../../types/costTypes';

describe('isModelMatch', () => {
  it('matches opus tier against full model ID', () => {
    expect(isModelMatch('claude-opus-4-6', 'opus')).toBe(true);
  });

  it('matches haiku tier against full model ID', () => {
    expect(isModelMatch('claude-haiku-4-5-20251001', 'haiku')).toBe(true);
  });

  it('matches sonnet tier against full model ID', () => {
    expect(isModelMatch('claude-sonnet-4-5-20250929', 'sonnet')).toBe(true);
  });

  it('does not match haiku key against opus tier', () => {
    expect(isModelMatch('claude-haiku-4-5-20251001', 'opus')).toBe(false);
  });

  it('does not match sonnet key against opus tier', () => {
    expect(isModelMatch('claude-sonnet-4-5-20250929', 'opus')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isModelMatch('claude-OPUS-4-6', 'opus')).toBe(true);
    expect(isModelMatch('claude-opus-4-6', 'OPUS')).toBe(true);
    expect(isModelMatch('Claude-Opus-4-6', 'Opus')).toBe(true);
  });

  it('handles versioned model IDs with date suffix', () => {
    expect(isModelMatch('claude-opus-4-6-20260101', 'opus')).toBe(true);
    expect(isModelMatch('claude-haiku-3-5-20241022', 'haiku')).toBe(true);
  });
});

describe('computePrimaryModelTokens', () => {
  const mixedUsage: ModelUsageMap = {
    'claude-opus-4-6': {
      inputTokens: 50000,
      outputTokens: 20000,
      cacheReadInputTokens: 5000,
      cacheCreationInputTokens: 10000,
      costUSD: 2.0,
    },
    'claude-haiku-4-5-20251001': {
      inputTokens: 100000,
      outputTokens: 40000,
      cacheReadInputTokens: 10000,
      cacheCreationInputTokens: 5000,
      costUSD: 0.05,
    },
    'claude-sonnet-4-5-20250929': {
      inputTokens: 80000,
      outputTokens: 30000,
      cacheReadInputTokens: 8000,
      cacheCreationInputTokens: 3000,
      costUSD: 0.5,
    },
  };

  it('filters to only opus tokens when primary model is opus', () => {
    const result = computePrimaryModelTokens(mixedUsage, 'opus');

    expect(result.inputTokens).toBe(50000);
    expect(result.outputTokens).toBe(20000);
    expect(result.cacheCreationTokens).toBe(10000);
    expect(result.total).toBe(80000); // 50000 + 20000 + 10000
  });

  it('filters to only haiku tokens when primary model is haiku', () => {
    const result = computePrimaryModelTokens(mixedUsage, 'haiku');

    expect(result.inputTokens).toBe(100000);
    expect(result.outputTokens).toBe(40000);
    expect(result.cacheCreationTokens).toBe(5000);
    expect(result.total).toBe(145000);
  });

  it('filters to only sonnet tokens when primary model is sonnet', () => {
    const result = computePrimaryModelTokens(mixedUsage, 'sonnet');

    expect(result.inputTokens).toBe(80000);
    expect(result.outputTokens).toBe(30000);
    expect(result.cacheCreationTokens).toBe(3000);
    expect(result.total).toBe(113000);
  });

  it('returns zeros when no model matches', () => {
    const result = computePrimaryModelTokens(mixedUsage, 'nonexistent');

    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.total).toBe(0);
  });

  it('returns zeros for empty map', () => {
    const result = computePrimaryModelTokens({}, 'opus');

    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.total).toBe(0);
  });

  it('behaves like computeTotalTokens when only the primary model is present', () => {
    const singleModel: ModelUsageMap = {
      'claude-opus-4-6': {
        inputTokens: 50000,
        outputTokens: 20000,
        cacheReadInputTokens: 5000,
        cacheCreationInputTokens: 10000,
        costUSD: 2.0,
      },
    };

    const result = computePrimaryModelTokens(singleModel, 'opus');

    expect(result.inputTokens).toBe(50000);
    expect(result.outputTokens).toBe(20000);
    expect(result.cacheCreationTokens).toBe(10000);
    expect(result.total).toBe(80000);
  });

  it('excludes cacheReadInputTokens from total', () => {
    const usage: ModelUsageMap = {
      'claude-opus-4-6': {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 99999,
        cacheCreationInputTokens: 25,
        costUSD: 0.01,
      },
    };

    const result = computePrimaryModelTokens(usage, 'opus');

    expect(result.total).toBe(175); // 100 + 50 + 25, not including 99999
  });
});

describe('computeDisplayTokens', () => {
  it('computes only inputTokens + outputTokens for a single model', () => {
    const usage: ModelUsageMap = {
      'claude-opus-4-6': {
        inputTokens: 5000,
        outputTokens: 3000,
        cacheReadInputTokens: 100000,
        cacheCreationInputTokens: 20000,
        costUSD: 1.5,
      },
    };

    const result = computeDisplayTokens(usage);

    expect(result.inputTokens).toBe(5000);
    expect(result.outputTokens).toBe(3000);
    expect(result.total).toBe(8000);
  });

  it('always returns cacheCreationTokens as 0', () => {
    const usage: ModelUsageMap = {
      'claude-opus-4-6': {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 50000,
        cacheCreationInputTokens: 10000,
        costUSD: 0.5,
      },
    };

    const result = computeDisplayTokens(usage);

    expect(result.cacheCreationTokens).toBe(0);
  });

  it('excludes all cache tokens from modelBreakdown entries', () => {
    const usage: ModelUsageMap = {
      'claude-opus-4-6': {
        inputTokens: 4620,
        outputTokens: 75372,
        cacheReadInputTokens: 8394568,
        cacheCreationInputTokens: 336948,
        costUSD: 8.21,
      },
    };

    const result = computeDisplayTokens(usage);

    expect(result.modelBreakdown).toHaveLength(1);
    expect(result.modelBreakdown[0]).toEqual({ model: 'claude-opus-4-6', total: 79992 });
  });

  it('aggregates across multiple models without cache tokens', () => {
    const usage: ModelUsageMap = {
      'claude-opus-4-6': {
        inputTokens: 4620,
        outputTokens: 75372,
        cacheReadInputTokens: 8394568,
        cacheCreationInputTokens: 336948,
        costUSD: 8.21,
      },
      'claude-haiku-4-5-20251001': {
        inputTokens: 166,
        outputTokens: 47910,
        cacheReadInputTokens: 1230803,
        cacheCreationInputTokens: 282700,
        costUSD: 0.72,
      },
      'claude-sonnet-4-6': {
        inputTokens: 6,
        outputTokens: 1313,
        cacheReadInputTokens: 68224,
        cacheCreationInputTokens: 12885,
        costUSD: 0.09,
      },
    };

    const result = computeDisplayTokens(usage);

    expect(result.inputTokens).toBe(4792);
    expect(result.outputTokens).toBe(124595);
    expect(result.total).toBe(129387);
    expect(result.cacheCreationTokens).toBe(0);
  });

  it('returns zeros for empty map', () => {
    const result = computeDisplayTokens({});

    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.total).toBe(0);
    expect(result.modelBreakdown).toHaveLength(0);
  });

  it('sorts modelBreakdown descending by total', () => {
    const usage: ModelUsageMap = {
      'claude-haiku-4-5': {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0.01,
      },
      'claude-opus-4-6': {
        inputTokens: 5000,
        outputTokens: 3000,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 1.0,
      },
    };

    const result = computeDisplayTokens(usage);

    expect(result.modelBreakdown[0].model).toBe('claude-opus-4-6');
    expect(result.modelBreakdown[1].model).toBe('claude-haiku-4-5');
  });
});
