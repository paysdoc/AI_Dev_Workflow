import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  mergeModelUsageMaps,
  computeTotalCostUsd,
  fetchExchangeRates,
  buildCostBreakdown,
  formatCostBreakdownMarkdown,
} from '../core/costReport';
import type { ModelUsageMap, CostBreakdown } from '../core/costTypes';

vi.mock('../core/utils', () => ({
  log: vi.fn(),
}));

describe('costReport', () => {
  describe('mergeModelUsageMaps', () => {
    it('correctly sums fields across multiple maps', () => {
      const map1: ModelUsageMap = {
        'sonnet': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 200, cacheCreationInputTokens: 10, costUSD: 0.01 },
      };
      const map2: ModelUsageMap = {
        'sonnet': { inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 300, cacheCreationInputTokens: 20, costUSD: 0.02 },
      };

      const merged = mergeModelUsageMaps(map1, map2);
      expect(merged['sonnet'].inputTokens).toBe(300);
      expect(merged['sonnet'].outputTokens).toBe(150);
      expect(merged['sonnet'].cacheReadInputTokens).toBe(500);
      expect(merged['sonnet'].cacheCreationInputTokens).toBe(30);
      expect(merged['sonnet'].costUSD).toBeCloseTo(0.03);
    });

    it('handles empty maps', () => {
      const result = mergeModelUsageMaps({}, {});
      expect(result).toEqual({});
    });

    it('handles maps with different model keys', () => {
      const map1: ModelUsageMap = {
        'sonnet': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 },
      };
      const map2: ModelUsageMap = {
        'haiku': { inputTokens: 200, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.005 },
      };

      const merged = mergeModelUsageMaps(map1, map2);
      expect(Object.keys(merged)).toHaveLength(2);
      expect(merged['sonnet'].inputTokens).toBe(100);
      expect(merged['haiku'].inputTokens).toBe(200);
    });

    it('handles single map', () => {
      const map: ModelUsageMap = {
        'opus': { inputTokens: 500, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.1 },
      };
      const result = mergeModelUsageMaps(map);
      expect(result).toEqual(map);
    });
  });

  describe('computeTotalCostUsd', () => {
    it('sums costs correctly', () => {
      const usageMap: ModelUsageMap = {
        'sonnet': { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 1.5 },
        'haiku': { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.3 },
      };
      expect(computeTotalCostUsd(usageMap)).toBeCloseTo(1.8);
    });

    it('returns zero for empty map', () => {
      expect(computeTotalCostUsd({})).toBe(0);
    });
  });

  describe('fetchExchangeRates', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('handles network errors gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
      const rates = await fetchExchangeRates(['EUR']);
      expect(rates).toEqual({});
    });

    it('returns empty map for empty currencies', async () => {
      const rates = await fetchExchangeRates([]);
      expect(rates).toEqual({});
    });

    it('parses successful response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rates: { EUR: 0.92, GBP: 0.79 } }),
      }));

      const rates = await fetchExchangeRates(['EUR', 'GBP']);
      expect(rates['EUR']).toBe(0.92);
      expect(rates['GBP']).toBe(0.79);
    });

    it('handles non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }));

      const rates = await fetchExchangeRates(['EUR']);
      expect(rates).toEqual({});
    });
  });

  describe('buildCostBreakdown', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('constructs complete breakdown', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rates: { EUR: 0.92 } }),
      }));

      const usageMap: ModelUsageMap = {
        'sonnet': { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 2.0 },
      };

      const breakdown = await buildCostBreakdown(usageMap, ['EUR']);
      expect(breakdown.totalCostUsd).toBe(2.0);
      expect(breakdown.modelUsage).toBe(usageMap);
      expect(breakdown.currencies).toHaveLength(1);
      expect(breakdown.currencies[0].currency).toBe('EUR');
      expect(breakdown.currencies[0].amount).toBeCloseTo(1.84);
    });
  });

  describe('formatCostBreakdownMarkdown', () => {
    it('produces expected markdown table', () => {
      const breakdown: CostBreakdown = {
        totalCostUsd: 2.5,
        modelUsage: {
          'sonnet': { inputTokens: 10000, outputTokens: 5000, cacheReadInputTokens: 20000, cacheCreationInputTokens: 1000, costUSD: 2.0 },
          'haiku': { inputTokens: 5000, outputTokens: 2000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.5 },
        },
        currencies: [{ currency: 'EUR', amount: 2.3, symbol: '\u20ac' }],
      };

      const md = formatCostBreakdownMarkdown(breakdown);
      expect(md).toContain('| Model |');
      expect(md).toContain('| sonnet |');
      expect(md).toContain('| haiku |');
      expect(md).toContain('| **Total** |');
      expect(md).toContain('$2.5000');
      expect(md).toContain('\u20ac2.3000 EUR');
    });

    it('handles empty usage map', () => {
      const breakdown: CostBreakdown = {
        totalCostUsd: 0,
        modelUsage: {},
        currencies: [],
      };

      const md = formatCostBreakdownMarkdown(breakdown);
      expect(md).toContain('$0.0000');
      expect(md).not.toContain('| Model |');
    });
  });
});
