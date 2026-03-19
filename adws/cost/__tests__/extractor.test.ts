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

  // ---------------------------------------------------------------------------
  // Streaming / per-turn assistant message tests
  // ---------------------------------------------------------------------------

  describe('per-turn assistant message streaming', () => {
    const makeAssistantMsg = (opts: {
      id?: string;
      model?: string;
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      content?: Array<{ type: string; text?: string }>;
    }) => ({
      type: 'assistant',
      message: {
        id: opts.id,
        model: opts.model ?? 'claude-sonnet-4-6',
        usage: {
          input_tokens: opts.input_tokens ?? 0,
          cache_creation_input_tokens: opts.cache_creation_input_tokens ?? 0,
          cache_read_input_tokens: opts.cache_read_input_tokens ?? 0,
        },
        content: opts.content ?? [],
      },
    });

    it('accumulates input tokens from a single assistant message', () => {
      const msg = makeAssistantMsg({ id: 'msg_1', input_tokens: 100 });
      extractor.onChunk(JSON.stringify(msg) + '\n');

      expect(extractor.isFinalized()).toBe(false);
      const usage = extractor.getCurrentUsage();
      expect(usage['claude-sonnet-4-6']!['input']).toBe(100);
    });

    it('accumulates cache tokens from assistant messages', () => {
      const msg = makeAssistantMsg({
        id: 'msg_1',
        input_tokens: 50,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 75,
      });
      extractor.onChunk(JSON.stringify(msg) + '\n');

      const usage = extractor.getCurrentUsage();
      expect(usage['claude-sonnet-4-6']!['cache_write']).toBe(200);
      expect(usage['claude-sonnet-4-6']!['cache_read']).toBe(75);
    });

    it('estimates output tokens from text content block character length (~4 chars/token)', () => {
      const content = [{ type: 'text', text: '1234' }]; // 4 chars → 1 token
      const msg = makeAssistantMsg({ id: 'msg_1', content });
      extractor.onChunk(JSON.stringify(msg) + '\n');

      const usage = extractor.getCurrentUsage();
      expect(usage['claude-sonnet-4-6']!['output']).toBe(1);
    });

    it('estimates output tokens across multiple text blocks', () => {
      // 8 chars + 12 chars = 20 chars → 5 tokens
      const content = [
        { type: 'text', text: '12345678' },
        { type: 'text', text: '123456789012' },
      ];
      const msg = makeAssistantMsg({ id: 'msg_1', content });
      extractor.onChunk(JSON.stringify(msg) + '\n');

      const usage = extractor.getCurrentUsage();
      expect(usage['claude-sonnet-4-6']!['output']).toBe(5);
    });

    it('does not count tool_use blocks towards output token estimation', () => {
      const content = [
        { type: 'tool_use', id: 'tool_1', name: 'read_file', input: {} },
        { type: 'text', text: '1234' }, // 4 chars → 1 token
      ];
      const msg = makeAssistantMsg({ id: 'msg_1', content });
      extractor.onChunk(JSON.stringify(msg) + '\n');

      const usage = extractor.getCurrentUsage();
      expect(usage['claude-sonnet-4-6']!['output']).toBe(1);
    });

    it('deduplicates usage by message.id (same ID counted only once)', () => {
      const msg1 = makeAssistantMsg({ id: 'msg_1', input_tokens: 100 });
      const msg2 = makeAssistantMsg({ id: 'msg_1', input_tokens: 100 }); // same ID

      extractor.onChunk(JSON.stringify(msg1) + '\n');
      extractor.onChunk(JSON.stringify(msg2) + '\n');

      const usage = extractor.getCurrentUsage();
      // Input should only be counted once
      expect(usage['claude-sonnet-4-6']!['input']).toBe(100);
    });

    it('accumulates input tokens across messages with different IDs', () => {
      const msg1 = makeAssistantMsg({ id: 'msg_1', input_tokens: 100 });
      const msg2 = makeAssistantMsg({ id: 'msg_2', input_tokens: 200 });
      const msg3 = makeAssistantMsg({ id: 'msg_3', input_tokens: 50 });

      extractor.onChunk(JSON.stringify(msg1) + '\n');
      extractor.onChunk(JSON.stringify(msg2) + '\n');
      extractor.onChunk(JSON.stringify(msg3) + '\n');

      const usage = extractor.getCurrentUsage();
      expect(usage['claude-sonnet-4-6']!['input']).toBe(350);
    });

    it('uses model hint from constructor when message has no model field', () => {
      const hintExtractor = new AnthropicTokenUsageExtractor('claude-opus-4-6');
      const msg = {
        type: 'assistant',
        message: {
          id: 'msg_1',
          // no model field
          usage: { input_tokens: 100 },
          content: [],
        },
      };
      hintExtractor.onChunk(JSON.stringify(msg) + '\n');

      const usage = hintExtractor.getCurrentUsage();
      expect(usage['claude-opus-4-6']).toBeDefined();
      expect(usage['claude-opus-4-6']!['input']).toBe(100);
    });

    it('uses message.model field over constructor hint when available', () => {
      const hintExtractor = new AnthropicTokenUsageExtractor('claude-opus-4-6');
      const msg = makeAssistantMsg({ id: 'msg_1', model: 'claude-sonnet-4-6', input_tokens: 100 });
      hintExtractor.onChunk(JSON.stringify(msg) + '\n');

      const usage = hintExtractor.getCurrentUsage();
      // message.model takes precedence
      expect(usage['claude-sonnet-4-6']).toBeDefined();
      expect(usage['claude-sonnet-4-6']!['input']).toBe(100);
    });

    it('handles assistant message with no message.usage field gracefully', () => {
      const msg = {
        type: 'assistant',
        message: {
          id: 'msg_1',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: '1234' }],
          // no usage field
        },
      };
      extractor.onChunk(JSON.stringify(msg) + '\n');

      expect(extractor.isFinalized()).toBe(false);
      const usage = extractor.getCurrentUsage();
      // Output estimated from content, input/cache default to 0
      expect(usage['claude-sonnet-4-6']!['output']).toBe(1);
      expect(usage['claude-sonnet-4-6']!['input']).toBe(0);
    });

    it('handles assistant message with no content field gracefully', () => {
      const msg = {
        type: 'assistant',
        message: {
          id: 'msg_1',
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 50 },
          // no content field
        },
      };
      extractor.onChunk(JSON.stringify(msg) + '\n');

      const usage = extractor.getCurrentUsage();
      expect(usage['claude-sonnet-4-6']!['input']).toBe(50);
      expect(usage['claude-sonnet-4-6']!['output']).toBe(0);
    });

    it('getEstimatedUsage() returns current estimates before finalization', () => {
      const msg = makeAssistantMsg({ id: 'msg_1', input_tokens: 300 });
      extractor.onChunk(JSON.stringify(msg) + '\n');

      expect(extractor.isFinalized()).toBe(false);
      const estimated = extractor.getEstimatedUsage();
      expect(estimated['claude-sonnet-4-6']!['input']).toBe(300);
    });

    it('getEstimatedUsage() returns pre-finalization snapshot after result arrives', () => {
      // Feed assistant messages first
      const msg1 = makeAssistantMsg({ id: 'msg_1', input_tokens: 300 });
      const msg2 = makeAssistantMsg({ id: 'msg_2', input_tokens: 400 });
      extractor.onChunk(JSON.stringify(msg1) + '\n');
      extractor.onChunk(JSON.stringify(msg2) + '\n');

      // Then finalize with result
      extractor.onChunk(JSON.stringify(RESULT_MESSAGE) + '\n');

      expect(extractor.isFinalized()).toBe(true);

      // getCurrentUsage() returns authoritative data from result message
      const actual = extractor.getCurrentUsage();
      expect(actual['claude-sonnet-4-5-20250929']!['input']).toBe(1000);

      // getEstimatedUsage() returns the pre-finalization snapshot
      const estimated = extractor.getEstimatedUsage();
      expect(estimated['claude-sonnet-4-6']!['input']).toBe(700); // 300 + 400
    });

    it('getCurrentUsage() returns actual result data after finalization (estimates replaced)', () => {
      const msg = makeAssistantMsg({ id: 'msg_1', input_tokens: 999 });
      extractor.onChunk(JSON.stringify(msg) + '\n');
      extractor.onChunk(JSON.stringify(RESULT_MESSAGE) + '\n');

      expect(extractor.isFinalized()).toBe(true);
      const usage = extractor.getCurrentUsage();
      // Actual from result message, not estimated
      expect(usage['claude-sonnet-4-5-20250929']!['input']).toBe(1000);
      expect(usage['claude-sonnet-4-5-20250929']!['output']).toBe(500);
    });

    it('incomplete stream (no result message): getCurrentUsage() returns accumulated estimates, isFinalized() is false', () => {
      const msg1 = makeAssistantMsg({ id: 'msg_1', input_tokens: 100 });
      const msg2 = makeAssistantMsg({ id: 'msg_2', input_tokens: 150 });
      extractor.onChunk(JSON.stringify(msg1) + '\n');
      extractor.onChunk(JSON.stringify(msg2) + '\n');

      expect(extractor.isFinalized()).toBe(false);
      const usage = extractor.getCurrentUsage();
      expect(usage['claude-sonnet-4-6']!['input']).toBe(250);
    });

    it('result message before any assistant messages: estimated usage is empty', () => {
      extractor.onChunk(JSON.stringify(RESULT_MESSAGE) + '\n');

      expect(extractor.isFinalized()).toBe(true);
      const estimated = extractor.getEstimatedUsage();
      // No assistant messages were processed, so estimated usage is empty
      expect(Object.keys(estimated)).toHaveLength(0);
    });

    it('zero-length text content block contributes 0 estimated output tokens', () => {
      const content = [{ type: 'text', text: '' }];
      const msg = makeAssistantMsg({ id: 'msg_1', content });
      extractor.onChunk(JSON.stringify(msg) + '\n');

      const usage = extractor.getCurrentUsage();
      expect(usage['claude-sonnet-4-6']!['output']).toBe(0);
    });

    it('getEstimatedUsage() is immutable-safe (returns a copy)', () => {
      const msg = makeAssistantMsg({ id: 'msg_1', input_tokens: 100 });
      extractor.onChunk(JSON.stringify(msg) + '\n');

      const est1 = extractor.getEstimatedUsage();
      est1['tampered'] = {};
      const est2 = extractor.getEstimatedUsage();
      expect(est2['tampered']).toBeUndefined();
    });
  });
});
