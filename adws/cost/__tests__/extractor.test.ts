import { describe, it, expect, beforeEach } from 'vitest';
import { AnthropicTokenUsageExtractor } from '../providers/anthropic/extractor';

const RESULT_MESSAGE = {
  type: 'result',
  total_cost_usd: 0.0123,
  modelUsage: {
    'claude-sonnet-4-5-20250929': {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadInputTokens: 200,
      cacheCreationInputTokens: 100,
      costUSD: 0.0123,
    },
  },
};

describe('AnthropicTokenUsageExtractor', () => {
  let extractor: AnthropicTokenUsageExtractor;

  beforeEach(() => {
    extractor = new AnthropicTokenUsageExtractor();
  });

  it('starts unfinalized with empty usage and undefined cost', () => {
    expect(extractor.isFinalized()).toBe(false);
    expect(extractor.getCurrentUsage()).toEqual({});
    expect(extractor.getReportedCostUsd()).toBeUndefined();
  });

  it('parses a complete result JSONL line and finalizes', () => {
    extractor.onChunk(JSON.stringify(RESULT_MESSAGE) + '\n');
    expect(extractor.isFinalized()).toBe(true);
    expect(extractor.getReportedCostUsd()).toBe(0.0123);
  });

  it('converts modelUsage camelCase fields to snake_case keys', () => {
    extractor.onChunk(JSON.stringify(RESULT_MESSAGE) + '\n');
    const usage = extractor.getCurrentUsage();
    const modelUsage = usage['claude-sonnet-4-5-20250929'];
    expect(modelUsage).toBeDefined();
    expect(modelUsage!['input']).toBe(1000);
    expect(modelUsage!['output']).toBe(500);
    expect(modelUsage!['cache_read']).toBe(200);
    expect(modelUsage!['cache_write']).toBe(100);
  });

  it('handles multi-model result with both models in getCurrentUsage()', () => {
    const multiModelResult = {
      type: 'result',
      total_cost_usd: 0.05,
      modelUsage: {
        'claude-opus-4-6': {
          inputTokens: 2000,
          outputTokens: 1000,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0.04,
        },
        'claude-haiku-4-5-20251001': {
          inputTokens: 500,
          outputTokens: 200,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0.01,
        },
      },
    };
    extractor.onChunk(JSON.stringify(multiModelResult) + '\n');
    const usage = extractor.getCurrentUsage();
    expect(usage['claude-opus-4-6']).toBeDefined();
    expect(usage['claude-haiku-4-5-20251001']).toBeDefined();
    expect(usage['claude-opus-4-6']!['input']).toBe(2000);
    expect(usage['claude-haiku-4-5-20251001']!['input']).toBe(500);
  });

  it('buffers partial lines split across multiple chunks', () => {
    const line = JSON.stringify(RESULT_MESSAGE);
    extractor.onChunk(line.slice(0, 20));
    expect(extractor.isFinalized()).toBe(false);
    extractor.onChunk(line.slice(20) + '\n');
    expect(extractor.isFinalized()).toBe(true);
    expect(extractor.getReportedCostUsd()).toBe(0.0123);
  });

  it('silently skips invalid JSON lines', () => {
    expect(() => {
      extractor.onChunk('not valid json\n');
    }).not.toThrow();
    expect(extractor.isFinalized()).toBe(false);
  });

  it('ignores non-result message types', () => {
    const assistantMsg = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello' }] },
    };
    extractor.onChunk(JSON.stringify(assistantMsg) + '\n');
    expect(extractor.isFinalized()).toBe(false);
    expect(extractor.getReportedCostUsd()).toBeUndefined();
  });

  it('handles result message with missing total_cost_usd', () => {
    const noCoast = { type: 'result', modelUsage: {} };
    extractor.onChunk(JSON.stringify(noCoast) + '\n');
    expect(extractor.isFinalized()).toBe(true);
    expect(extractor.getReportedCostUsd()).toBeUndefined();
  });

  it('handles result message with missing modelUsage', () => {
    const noUsage = { type: 'result', total_cost_usd: 0.01 };
    extractor.onChunk(JSON.stringify(noUsage) + '\n');
    expect(extractor.isFinalized()).toBe(true);
    expect(extractor.getCurrentUsage()).toEqual({});
    expect(extractor.getReportedCostUsd()).toBe(0.01);
  });

  it('returns a copy of usage (getCurrentUsage is immutable-safe)', () => {
    extractor.onChunk(JSON.stringify(RESULT_MESSAGE) + '\n');
    const usage1 = extractor.getCurrentUsage();
    usage1['tampered'] = {};
    const usage2 = extractor.getCurrentUsage();
    expect(usage2['tampered']).toBeUndefined();
  });
});
