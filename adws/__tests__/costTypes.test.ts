import { describe, it, expect } from 'vitest';
import { emptyModelUsage, emptyModelUsageMap } from '../core/costTypes';

describe('costTypes', () => {
  describe('emptyModelUsage', () => {
    it('returns all-zero fields', () => {
      const usage = emptyModelUsage();
      expect(usage.inputTokens).toBe(0);
      expect(usage.outputTokens).toBe(0);
      expect(usage.cacheReadInputTokens).toBe(0);
      expect(usage.cacheCreationInputTokens).toBe(0);
      expect(usage.costUSD).toBe(0);
    });
  });

  describe('emptyModelUsageMap', () => {
    it('returns an empty object', () => {
      const map = emptyModelUsageMap();
      expect(map).toEqual({});
      expect(Object.keys(map)).toHaveLength(0);
    });
  });
});
