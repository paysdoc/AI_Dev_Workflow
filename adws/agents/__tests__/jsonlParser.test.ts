import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractTextFromAssistantMessage,
  extractToolUseFromMessage,
  parseJsonlOutput,
  type JsonlParserState,
  type JsonlAssistantMessage,
  type ContentBlock,
} from '../jsonlParser';

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    AgentStateManager: {
      writeRawOutput: vi.fn(),
      appendLog: vi.fn(),
    },
  };
});

vi.mock('../../core/tokenManager', () => ({
  computeTotalTokens: vi.fn().mockReturnValue({ inputTokens: 100, outputTokens: 50, cacheCreationTokens: 10, total: 160 }),
  computePrimaryModelTokens: vi.fn().mockReturnValue({ inputTokens: 80, outputTokens: 40, cacheCreationTokens: 5, total: 125 }),
}));

import { AgentStateManager } from '../../core';

function createState(overrides: Partial<JsonlParserState> = {}): JsonlParserState {
  return {
    lastResult: null,
    fullOutput: '',
    turnCount: 0,
    toolCount: 0,
    modelUsage: undefined,
    totalTokens: 0,
    ...overrides,
  };
}

function makeAssistantLine(content: ContentBlock[]): string {
  return JSON.stringify({
    type: 'assistant',
    message: { content },
  });
}

function makeResultLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    isError: false,
    durationMs: 1000,
    durationApiMs: 900,
    numTurns: 1,
    result: 'done',
    sessionId: 'sess-123',
    totalCostUsd: 0.05,
    ...overrides,
  });
}

describe('extractTextFromAssistantMessage', () => {
  it('extracts text from text content blocks', () => {
    const message = {
      content: [
        { type: 'text' as const, text: 'Hello' },
        { type: 'text' as const, text: 'World' },
      ],
    };

    const result = extractTextFromAssistantMessage(message);

    expect(result).toBe('Hello\nWorld\n');
  });

  it('ignores non-text content blocks', () => {
    const message = {
      content: [
        { type: 'text' as const, text: 'Hello' },
        { type: 'tool_use' as const, id: 'tu-1', name: 'Read', input: { path: '/file' } },
        { type: 'text' as const, text: 'World' },
      ],
    };

    const result = extractTextFromAssistantMessage(message);

    expect(result).toBe('Hello\nWorld\n');
  });

  it('returns empty string for undefined message', () => {
    expect(extractTextFromAssistantMessage(undefined)).toBe('');
  });

  it('returns empty string for message without content', () => {
    expect(extractTextFromAssistantMessage({} as JsonlAssistantMessage['message'])).toBe('');
  });

  it('returns empty string when content has no text blocks', () => {
    const message = {
      content: [
        { type: 'tool_use' as const, id: 'tu-1', name: 'Read', input: {} },
      ],
    };

    expect(extractTextFromAssistantMessage(message)).toBe('');
  });
});

describe('extractToolUseFromMessage', () => {
  it('extracts tool use blocks with name and stringified input', () => {
    const message = {
      content: [
        {
          type: 'tool_use' as const,
          id: 'tu-1',
          name: 'Read',
          input: { path: '/file.ts' },
        },
      ],
    };

    const result = extractToolUseFromMessage(message);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Read');
    expect(result[0].input).toContain('/file.ts');
  });

  it('handles string input on tool_use blocks', () => {
    const message = {
      content: [
        {
          type: 'tool_use' as const,
          id: 'tu-1',
          name: 'Bash',
          input: 'echo hello',
        },
      ],
    };

    const result = extractToolUseFromMessage(message);

    expect(result[0].input).toBe('echo hello');
  });

  it('truncates long input to 200 characters', () => {
    const longInput = 'a'.repeat(300);
    const message = {
      content: [
        {
          type: 'tool_use' as const,
          id: 'tu-1',
          name: 'Write',
          input: longInput,
        },
      ],
    };

    const result = extractToolUseFromMessage(message);

    expect(result[0].input).toHaveLength(200);
  });

  it('truncates long object input to 200 characters', () => {
    const longContent = 'x'.repeat(300);
    const message = {
      content: [
        {
          type: 'tool_use' as const,
          id: 'tu-1',
          name: 'Write',
          input: { content: longContent },
        },
      ],
    };

    const result = extractToolUseFromMessage(message);

    expect(result[0].input.length).toBeLessThanOrEqual(200);
  });

  it('returns empty array for undefined message', () => {
    expect(extractToolUseFromMessage(undefined)).toEqual([]);
  });

  it('returns empty array for message without content', () => {
    expect(extractToolUseFromMessage({} as JsonlAssistantMessage['message'])).toEqual([]);
  });

  it('ignores non-tool_use blocks', () => {
    const message = {
      content: [
        { type: 'text' as const, text: 'Hello' },
        { type: 'tool_result' as const, tool_use_id: 'tu-1', content: 'result' },
      ],
    };

    expect(extractToolUseFromMessage(message)).toEqual([]);
  });

  it('extracts multiple tool uses', () => {
    const message = {
      content: [
        { type: 'tool_use' as const, id: 'tu-1', name: 'Read', input: { path: '/a.ts' } },
        { type: 'text' as const, text: 'between tools' },
        { type: 'tool_use' as const, id: 'tu-2', name: 'Write', input: { path: '/b.ts' } },
      ],
    };

    const result = extractToolUseFromMessage(message);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Read');
    expect(result[1].name).toBe('Write');
  });
});

describe('parseJsonlOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses assistant message and accumulates text output', () => {
    const state = createState();
    const line = makeAssistantLine([{ type: 'text', text: 'Hello world' }]);

    parseJsonlOutput(line, state);

    expect(state.fullOutput).toContain('Hello world');
    expect(state.turnCount).toBe(1);
  });

  it('increments turnCount for each assistant message', () => {
    const state = createState();
    const lines = [
      makeAssistantLine([{ type: 'text', text: 'First' }]),
      makeAssistantLine([{ type: 'text', text: 'Second' }]),
    ].join('\n');

    parseJsonlOutput(lines, state);

    expect(state.turnCount).toBe(2);
  });

  it('increments toolCount for tool_use blocks', () => {
    const state = createState();
    const line = makeAssistantLine([
      { type: 'tool_use', id: 'tu-1', name: 'Read', input: { path: '/f' } },
      { type: 'tool_use', id: 'tu-2', name: 'Write', input: { path: '/g' } },
    ]);

    parseJsonlOutput(line, state);

    expect(state.toolCount).toBe(2);
  });

  it('parses result message and stores lastResult', () => {
    const state = createState();
    const line = makeResultLine();

    parseJsonlOutput(line, state);

    expect(state.lastResult).not.toBeNull();
    expect(state.lastResult?.type).toBe('result');
  });

  it('extracts modelUsage and computes totalTokens from result', () => {
    const state = createState();
    const modelUsage = {
      'claude-sonnet-4-20250514': {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 20,
        cacheCreationInputTokens: 10,
      },
    };
    const line = makeResultLine({ modelUsage });

    parseJsonlOutput(line, state);

    expect(state.modelUsage).toBeDefined();
    expect(state.totalTokens).toBe(160); // from mocked computeTotalTokens
  });

  it('uses computePrimaryModelTokens when primaryModel is set', () => {
    const state = createState({ primaryModel: 'opus' });
    const modelUsage = {
      'claude-opus-4-20250514': {
        inputTokens: 80,
        outputTokens: 40,
        cacheReadInputTokens: 15,
        cacheCreationInputTokens: 5,
      },
    };
    const line = makeResultLine({ modelUsage });

    parseJsonlOutput(line, state);

    expect(state.totalTokens).toBe(125); // from mocked computePrimaryModelTokens
  });

  it('handles malformed JSON lines by appending to fullOutput', () => {
    const state = createState();
    const text = 'this is not json\nalso not json';

    parseJsonlOutput(text, state);

    expect(state.fullOutput).toContain('this is not json');
    expect(state.fullOutput).toContain('also not json');
    expect(state.turnCount).toBe(0);
  });

  it('handles mixed valid and invalid JSONL lines', () => {
    const state = createState();
    const lines = [
      'invalid line',
      makeAssistantLine([{ type: 'text', text: 'Valid message' }]),
      'another bad line',
    ].join('\n');

    parseJsonlOutput(lines, state);

    expect(state.fullOutput).toContain('invalid line');
    expect(state.fullOutput).toContain('Valid message');
    expect(state.fullOutput).toContain('another bad line');
    expect(state.turnCount).toBe(1);
  });

  it('skips empty lines', () => {
    const state = createState();
    const text = '\n\n  \n';

    parseJsonlOutput(text, state);

    expect(state.turnCount).toBe(0);
    expect(state.fullOutput).toBe('');
  });

  it('calls onProgress with tool_use info', () => {
    const state = createState();
    const onProgress = vi.fn();
    const line = makeAssistantLine([
      { type: 'tool_use', id: 'tu-1', name: 'Read', input: { path: '/file' } },
    ]);

    parseJsonlOutput(line, state, onProgress);

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_use',
        toolName: 'Read',
        turnCount: 1,
        toolCount: 1,
      }),
    );
  });

  it('calls onProgress with text info when text content present', () => {
    const state = createState();
    const onProgress = vi.fn();
    const line = makeAssistantLine([{ type: 'text', text: 'Analyzing code...' }]);

    parseJsonlOutput(line, state, onProgress);

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'text',
        text: 'Analyzing code...',
        turnCount: 1,
      }),
    );
  });

  it('does not call onProgress when callback is not provided', () => {
    const state = createState();
    const line = makeAssistantLine([
      { type: 'text', text: 'Hello' },
      { type: 'tool_use', id: 'tu-1', name: 'Read', input: {} },
    ]);

    // Should not throw
    expect(() => parseJsonlOutput(line, state)).not.toThrow();
  });

  it('truncates long text content in progress callback to 500 chars', () => {
    const state = createState();
    const onProgress = vi.fn();
    const longText = 'x'.repeat(600);
    const line = makeAssistantLine([{ type: 'text', text: longText }]);

    parseJsonlOutput(line, state, onProgress);

    const textCall = onProgress.mock.calls.find(
      (call) => call[0].type === 'text',
    );
    expect(textCall).toBeDefined();
    expect(textCall![0].text.length).toBeLessThanOrEqual(500);
  });

  it('writes raw output to state when statePath is provided', () => {
    const state = createState();
    const line = makeAssistantLine([{ type: 'text', text: 'Hello' }]);

    parseJsonlOutput(line, state, undefined, '/state/path');

    expect(AgentStateManager.writeRawOutput).toHaveBeenCalledWith(
      '/state/path',
      'output.jsonl',
      expect.objectContaining({ type: 'assistant' }),
      true,
    );
  });

  it('appends tool usage to state log when statePath is provided', () => {
    const state = createState();
    const line = makeAssistantLine([
      { type: 'tool_use', id: 'tu-1', name: 'Read', input: {} },
    ]);

    parseJsonlOutput(line, state, undefined, '/state/path');

    expect(AgentStateManager.appendLog).toHaveBeenCalledWith(
      '/state/path',
      '[Turn 1] Tool: Read',
    );
  });

  it('does not write to state when statePath is not provided', () => {
    const state = createState();
    const line = makeAssistantLine([{ type: 'text', text: 'Hello' }]);

    parseJsonlOutput(line, state);

    expect(AgentStateManager.writeRawOutput).not.toHaveBeenCalled();
    expect(AgentStateManager.appendLog).not.toHaveBeenCalled();
  });

  it('accumulates state across multiple parseJsonlOutput calls', () => {
    const state = createState();

    parseJsonlOutput(makeAssistantLine([{ type: 'text', text: 'First' }]), state);
    parseJsonlOutput(makeAssistantLine([{ type: 'text', text: 'Second' }]), state);

    expect(state.turnCount).toBe(2);
    expect(state.fullOutput).toContain('First');
    expect(state.fullOutput).toContain('Second');
  });

  it('does not update modelUsage when result has no modelUsage', () => {
    const state = createState();
    const line = makeResultLine(); // no modelUsage field

    parseJsonlOutput(line, state);

    expect(state.modelUsage).toBeUndefined();
    expect(state.totalTokens).toBe(0);
  });
});
