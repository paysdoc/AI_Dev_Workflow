import { describe, it, expect, vi } from 'vitest';
import { parseJsonlOutput, type JsonlParserState } from '../claudeStreamParser';

// Mock AgentStateManager to avoid filesystem side effects
vi.mock('../agentState', () => ({
  AgentStateManager: {
    writeRawOutput: vi.fn(),
    appendLog: vi.fn(),
  },
}));

function createState(overrides?: Partial<JsonlParserState>): JsonlParserState {
  return {
    lastResult: null,
    fullOutput: '',
    turnCount: 0,
    toolCount: 0,
    lineBuffer: '',
    rateLimitRejected: false,
    authErrorDetected: false,
    serverErrorDetected: false,
    overloadedErrorDetected: false,
    compactionDetected: false,
    ...overrides,
  };
}

describe('parseJsonlOutput — structured detection', () => {
  it('sets rateLimitRejected when rate_limit_event has status "rejected"', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } });
    parseJsonlOutput(line + '\n', state);
    expect(state.rateLimitRejected).toBe(true);
  });

  it('does NOT set rateLimitRejected when rate_limit_event has status "allowed"', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } });
    parseJsonlOutput(line + '\n', state);
    expect(state.rateLimitRejected).toBe(false);
  });

  it('does NOT set rateLimitRejected when rate_limit_event has status "allowed_warning"', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } });
    parseJsonlOutput(line + '\n', state);
    expect(state.rateLimitRejected).toBe(false);
  });

  it('sets authErrorDetected when system api_retry has authentication_error', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'system', subtype: 'api_retry', error: 'authentication_error', attempt: 1 });
    parseJsonlOutput(line + '\n', state);
    expect(state.authErrorDetected).toBe(true);
  });

  it('does NOT set serverErrorDetected when api_retry has attempt 1 with non-auth error', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'system', subtype: 'api_retry', error: 'unknown', attempt: 1 });
    parseJsonlOutput(line + '\n', state);
    expect(state.serverErrorDetected).toBe(false);
  });

  it('sets serverErrorDetected when api_retry has attempt >= 2 with non-auth, non-overloaded error', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'system', subtype: 'api_retry', error: 'api_error', attempt: 2 });
    parseJsonlOutput(line + '\n', state);
    expect(state.serverErrorDetected).toBe(true);
  });

  it('sets overloadedErrorDetected on first api_retry with overloaded_error (HTTP 529)', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'system', subtype: 'api_retry', error: 'overloaded_error', attempt: 1 });
    parseJsonlOutput(line + '\n', state);
    expect(state.overloadedErrorDetected).toBe(true);
    expect(state.serverErrorDetected).toBe(false);
  });

  it('does NOT set serverErrorDetected for overloaded_error even at attempt >= 2', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'system', subtype: 'api_retry', error: 'overloaded_error', attempt: 3 });
    parseJsonlOutput(line + '\n', state);
    expect(state.overloadedErrorDetected).toBe(true);
    expect(state.serverErrorDetected).toBe(false);
  });

  it('sets compactionDetected when system compact_boundary is parsed', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'system', subtype: 'compact_boundary' });
    parseJsonlOutput(line + '\n', state);
    expect(state.compactionDetected).toBe(true);
  });

  it('does NOT set any flags for tool result content containing detection strings (false-positive scenario)', () => {
    const state = createState();
    // Simulate a tool result message where the content contains detection strings
    const toolResult = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'text',
          text: 'The file contains overloaded_error, 502 Bad Gateway, compact_boundary, authentication_error, rate_limit_event, and "status":"rejected" strings',
        }],
      },
    });
    parseJsonlOutput(toolResult + '\n', state);
    expect(state.rateLimitRejected).toBe(false);
    expect(state.authErrorDetected).toBe(false);
    expect(state.serverErrorDetected).toBe(false);
    expect(state.compactionDetected).toBe(false);
  });

  it('does NOT set rateLimitRejected when overageStatus is "rejected" but status is "allowed"', () => {
    const state = createState();
    const line = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', overageStatus: 'rejected' },
    });
    parseJsonlOutput(line + '\n', state);
    expect(state.rateLimitRejected).toBe(false);
  });

  it('handles multiple detection events in a single chunk', () => {
    const state = createState();
    const lines = [
      JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } }),
      JSON.stringify({ type: 'system', subtype: 'compact_boundary' }),
    ].join('\n') + '\n';
    parseJsonlOutput(lines, state);
    expect(state.rateLimitRejected).toBe(true);
    expect(state.compactionDetected).toBe(true);
  });

  it('serverErrorDetected remains true once set (idempotent)', () => {
    const state = createState();
    const line1 = JSON.stringify({ type: 'system', subtype: 'api_retry', error: 'unknown', attempt: 2 });
    const line2 = JSON.stringify({ type: 'system', subtype: 'api_retry', error: 'unknown', attempt: 1 });
    parseJsonlOutput(line1 + '\n', state);
    expect(state.serverErrorDetected).toBe(true);
    parseJsonlOutput(line2 + '\n', state);
    expect(state.serverErrorDetected).toBe(true);
  });
});

describe('parseJsonlOutput — cross-chunk line buffering', () => {
  it('parses a complete JSONL line in a single chunk', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'result', subtype: 'success', isError: false, durationMs: 100, durationApiMs: 80, numTurns: 1, result: 'done', sessionId: 's1' });
    parseJsonlOutput(line + '\n', state);
    expect(state.lastResult).not.toBeNull();
    expect(state.lastResult!.result).toBe('done');
  });

  it('buffers a partial line and completes it with the next chunk', () => {
    const state = createState();
    const full = JSON.stringify({ type: 'system', subtype: 'compact_boundary' });
    const half1 = full.substring(0, 15);
    const half2 = full.substring(15);

    // First chunk: partial line, no trailing newline
    parseJsonlOutput(half1, state);
    expect(state.compactionDetected).toBe(false);
    expect(state.lineBuffer).toBe(half1);

    // Second chunk: rest of line + newline
    parseJsonlOutput(half2 + '\n', state);
    expect(state.compactionDetected).toBe(true);
    expect(state.lineBuffer).toBe('');
  });

  it('parses multiple complete lines in a single chunk', () => {
    const state = createState();
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'compact_boundary' }),
      JSON.stringify({ type: 'system', subtype: 'api_retry', error: 'authentication_error', attempt: 1 }),
    ].join('\n') + '\n';
    parseJsonlOutput(lines, state);
    expect(state.compactionDetected).toBe(true);
    expect(state.authErrorDetected).toBe(true);
  });

  it('handles a JSONL line split across 3+ chunks', () => {
    const state = createState();
    const full = JSON.stringify({ type: 'system', subtype: 'compact_boundary' });
    const part1 = full.substring(0, 10);
    const part2 = full.substring(10, 25);
    const part3 = full.substring(25);

    parseJsonlOutput(part1, state);
    expect(state.compactionDetected).toBe(false);
    parseJsonlOutput(part2, state);
    expect(state.compactionDetected).toBe(false);
    parseJsonlOutput(part3 + '\n', state);
    expect(state.compactionDetected).toBe(true);
  });

  it('handles empty chunks between partial lines', () => {
    const state = createState();
    const full = JSON.stringify({ type: 'system', subtype: 'compact_boundary' });
    const half1 = full.substring(0, 15);
    const half2 = full.substring(15);

    parseJsonlOutput(half1, state);
    parseJsonlOutput('', state); // empty chunk
    expect(state.lineBuffer).toBe(half1);
    parseJsonlOutput(half2 + '\n', state);
    expect(state.compactionDetected).toBe(true);
  });

  it('handles a chunk containing only a newline', () => {
    const state = createState();
    parseJsonlOutput('\n', state);
    expect(state.lineBuffer).toBe('');
    expect(state.fullOutput).toBe('');
  });

  it('trailing partial line is buffered and completed by subsequent chunk', () => {
    const state = createState();
    const completeLine = JSON.stringify({ type: 'system', subtype: 'compact_boundary' });
    const partialLine = '{"type":"system","subt';

    // Chunk with complete line + partial next line (no trailing newline)
    parseJsonlOutput(completeLine + '\n' + partialLine, state);
    expect(state.compactionDetected).toBe(true);
    expect(state.lineBuffer).toBe(partialLine);

    // Complete the partial line
    const rest = 'ype":"api_retry","error":"authentication_error","attempt":1}';
    parseJsonlOutput(rest + '\n', state);
    expect(state.authErrorDetected).toBe(true);
    expect(state.lineBuffer).toBe('');
  });
});

describe('parseJsonlOutput — existing behavior preserved', () => {
  it('extracts text from assistant messages and increments turnCount', () => {
    const state = createState();
    const msg = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello world' }] },
    });
    parseJsonlOutput(msg + '\n', state);
    expect(state.turnCount).toBe(1);
    expect(state.fullOutput).toContain('Hello world');
  });

  it('tracks tool usage and increments toolCount', () => {
    const state = createState();
    const progress = vi.fn();
    const msg = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: '/foo' }] },
    });
    parseJsonlOutput(msg + '\n', state, progress);
    expect(state.toolCount).toBe(1);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool_use', toolName: 'Read' }));
  });

  it('appends unparseable lines to fullOutput', () => {
    const state = createState();
    parseJsonlOutput('not valid json\n', state);
    expect(state.fullOutput).toContain('not valid json');
  });
});
