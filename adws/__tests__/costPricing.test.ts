import { describe, it, expect } from 'vitest';
import { getModelPricing, computeModelCost, MODEL_PRICING } from '../core/costPricing';

describe('costPricing', () => {
  describe('getModelPricing', () => {
    it('returns correct pricing for opus', () => {
      const pricing = getModelPricing('claude-opus-4-6');
      expect(pricing.inputPerMillion).toBe(5.0);
      expect(pricing.outputPerMillion).toBe(25.0);
      expect(pricing.cacheReadPerMillion).toBe(0.5);
      expect(pricing.cacheCreationPerMillion).toBe(6.25);
    });

    it('returns correct pricing for sonnet', () => {
      const pricing = getModelPricing('claude-sonnet-4-5-20250929');
      expect(pricing.inputPerMillion).toBe(3.0);
      expect(pricing.outputPerMillion).toBe(15.0);
    });

    it('returns correct pricing for haiku', () => {
      const pricing = getModelPricing('haiku');
      expect(pricing.inputPerMillion).toBe(1.0);
      expect(pricing.outputPerMillion).toBe(5.0);
    });

    it('returns correct pricing for short aliases', () => {
      expect(getModelPricing('opus')).toEqual(MODEL_PRICING['claude-opus-4-6']);
      expect(getModelPricing('sonnet')).toEqual(MODEL_PRICING['claude-sonnet-4-5-20250929']);
    });

    it('returns sonnet fallback for unknown models', () => {
      const pricing = getModelPricing('unknown-model-v99');
      expect(pricing).toEqual(getModelPricing('sonnet'));
    });
  });

  describe('computeModelCost', () => {
    it('calculates correct cost for known token counts', () => {
      const usage = {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheReadInputTokens: 2_000_000,
        cacheCreationInputTokens: 100_000,
        costUSD: 0,
      };

      // Using sonnet pricing: 3/M input, 15/M output, 0.3/M cache read, 3.75/M cache creation
      const cost = computeModelCost('sonnet', usage);
      const expected = (1_000_000 * 3.0 / 1_000_000) + (500_000 * 15.0 / 1_000_000) + (2_000_000 * 0.3 / 1_000_000) + (100_000 * 3.75 / 1_000_000);
      expect(cost).toBeCloseTo(expected, 6);
    });

    it('calculates zero cost for zero tokens', () => {
      const usage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0,
      };
      expect(computeModelCost('sonnet', usage)).toBe(0);
    });
  });
});
