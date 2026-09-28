import { describe, it, expect, vi } from 'vitest';
import { parseJsonlOutput, createJsonlParserState, type JsonlParserState } from '../claudeStreamParser';
import {
  INCIDENT_STREAM,
  INCIDENT_RESETS_AT,
  INCIDENT_RATE_LIMIT_TYPE,
} from './fixtures/rateLimitIncident';

// Mock AgentStateManager to avoid filesystem side effects
vi.mock('../agentState', () => ({
  AgentStateManager: {
    writeRawOutput: vi.fn(),
    appendLog: vi.fn(),
  },
}));

function createState(overrides?: Partial<JsonlParserState>): JsonlParserState {
  return { ...createJsonlParserState(), ...overrides };
}

describe('createJsonlParserState', () => {
  it('returns a zeroed state with all flags false, counts zero, and no facts', () => {
    const state = createJsonlParserState();
    expect(state.lastResult).toBeNull();
    expect(state.fullOutput).toBe('');
    expect(state.turnCount).toBe(0);
    expect(state.toolCount).toBe(0);
    expect(state.lineBuffer).toBe('');
    expect(state.rateLimitDetected).toBe(false);
    expect(state.authErrorDetected).toBe(false);
    expect(state.serverErrorDetected).toBe(false);
    expect(state.overloadedErrorDetected).toBe(false);
    expect(state.compactionDetected).toBe(false);
    expect(state.deniedToolCallCount).toBe(0);
    expect(state.rateLimitType).toBeUndefined();
    expect(state.resetsAt).toBeUndefined();
    expect(state.primaryModel).toBeUndefined();
  });

  it('sets primaryModel only when given', () => {
    const state = createJsonlParserState('opus');
    expect(state.primaryModel).toBe('opus');
  });
});

describe('parseJsonlOutput — rate_limit_event facts', () => {
  it('sets rateLimitDetected and captures rateLimitType/resetsAt from a rejected event', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1790081400 } });
    parseJsonlOutput(line + '\n', state);
    expect(state.rateLimitDetected).toBe(true);
    expect(state.rateLimitType).toBe('five_hour');
    expect(state.resetsAt).toBe(1790081400);
  });

  it('sets the flag with no facts when a rejected event carries neither field', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } });
    parseJsonlOutput(line + '\n', state);
    expect(state.rateLimitDetected).toBe(true);
    expect(state.rateLimitType).toBeUndefined();
    expect(state.resetsAt).toBeUndefined();
  });

  it('captures rateLimitType with no resetsAt when the event omits the reset time', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } });
    parseJsonlOutput(line + '\n', state);
    expect(state.rateLimitType).toBe('five_hour');
    expect(state.resetsAt).toBeUndefined();
  });

  it('reads a seven_day limit type rather than assuming five_hour', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day', resetsAt: 1790578800 } });
    parseJsonlOutput(line + '\n', state);
    expect(state.rateLimitType).toBe('seven_day');
    expect(state.resetsAt).toBe(1790578800);
  });

  it('does NOT set rateLimitDetected when rate_limit_event has status "allowed"', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } });
    parseJsonlOutput(line + '\n', state);
    expect(state.rateLimitDetected).toBe(false);
  });

  it('does NOT set rateLimitDetected when rate_limit_event has status "allowed_warning", even carrying a resetsAt', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 1790081400, rateLimitType: 'five_hour' } });
    parseJsonlOutput(line + '\n', state);
    expect(state.rateLimitDetected).toBe(false);
    expect(state.rateLimitType).toBeUndefined();
    expect(state.resetsAt).toBeUndefined();
  });

  it('does NOT set rateLimitDetected when overageStatus is "rejected" but status is "allowed"', () => {
    const state = createState();
    const line = JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', overageStatus: 'rejected' },
    });
    parseJsonlOutput(line + '\n', state);
    expect(state.rateLimitDetected).toBe(false);
  });

  it('lets the later rejected event win when two are seen in one stream', () => {
    const state = createState();
    const first = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1790081400 } });
    const second = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'seven_day', resetsAt: 1790578800 } });
    parseJsonlOutput(first + '\n' + second + '\n', state);
    expect(state.rateLimitType).toBe('seven_day');
    expect(state.resetsAt).toBe(1790578800);
  });
});

describe('parseJsonlOutput — api_retry classification (documented enum + HTTP status)', () => {
  function apiRetry(overrides: Record<string, unknown>): string {
    return JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, ...overrides });
  }

  it('sets rateLimitDetected for error: "rate_limit" with error_status: 429, at attempt 1', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 1, error: 'rate_limit', error_status: 429 }) + '\n', state);
    expect(state.rateLimitDetected).toBe(true);
    expect(state.serverErrorDetected).toBe(false);
    expect(state.rateLimitType).toBeUndefined();
    expect(state.resetsAt).toBeUndefined();
  });

  it('sets rateLimitDetected for error: "rate_limit" with error_status: 429, at attempt 2', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 2, error: 'rate_limit', error_status: 429 }) + '\n', state);
    expect(state.rateLimitDetected).toBe(true);
    expect(state.serverErrorDetected).toBe(false);
  });

  it('sets rateLimitDetected for error: "rate_limit" with error_status: null', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 1, error: 'rate_limit', error_status: null }) + '\n', state);
    expect(state.rateLimitDetected).toBe(true);
  });

  it('sets rateLimitDetected for error_status: 429 with an unrecognised error enum', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 1, error: 'unknown', error_status: 429 }) + '\n', state);
    expect(state.rateLimitDetected).toBe(true);
  });

  it('sets overloadedErrorDetected for error: "overloaded" with error_status: 529, at attempt 1', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 1, error: 'overloaded', error_status: 529 }) + '\n', state);
    expect(state.overloadedErrorDetected).toBe(true);
    expect(state.serverErrorDetected).toBe(false);
  });

  it('sets overloadedErrorDetected for error: "overloaded" with error_status: null', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 1, error: 'overloaded', error_status: null }) + '\n', state);
    expect(state.overloadedErrorDetected).toBe(true);
  });

  it('sets overloadedErrorDetected for error_status: 529 with an unrecognised error enum, at attempt 1', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 1, error: 'unknown', error_status: 529 }) + '\n', state);
    expect(state.overloadedErrorDetected).toBe(true);
  });

  it('the legacy "overloaded_error" spelling sets nothing at attempt 1 (the documented value replaced it)', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 1, error: 'overloaded_error' }) + '\n', state);
    expect(state.overloadedErrorDetected).toBe(false);
    expect(state.serverErrorDetected).toBe(false);
  });

  it('the legacy "overloaded_error" spelling is treated as an unclassified retry — serverErrorDetected at attempt 2, never overloadedErrorDetected', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 2, error: 'overloaded_error' }) + '\n', state);
    expect(state.serverErrorDetected).toBe(true);
    expect(state.overloadedErrorDetected).toBe(false);
  });

  it('sets authErrorDetected for error: "authentication_failed" with error_status: null, at attempt 1', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 1, error: 'authentication_failed', error_status: null }) + '\n', state);
    expect(state.authErrorDetected).toBe(true);
    expect(state.serverErrorDetected).toBe(false);
  });

  it('sets authErrorDetected for error_status: 401 regardless of the error enum', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 1, error: 'unknown', error_status: 401 }) + '\n', state);
    expect(state.authErrorDetected).toBe(true);
    expect(state.serverErrorDetected).toBe(false);
  });

  it('auth wins the ranking on a contradictory pair (rate_limit enum, 401 status)', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 1, error: 'rate_limit', error_status: 401 }) + '\n', state);
    expect(state.authErrorDetected).toBe(true);
    expect(state.rateLimitDetected).toBe(false);
  });

  it('does NOT set serverErrorDetected for a non-auth, non-overloaded error at attempt 1', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 1, error: 'unknown' }) + '\n', state);
    expect(state.serverErrorDetected).toBe(false);
  });

  it('sets serverErrorDetected for error: "server_error" at attempt 2', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 2, error: 'server_error' }) + '\n', state);
    expect(state.serverErrorDetected).toBe(true);
  });

  it('sets serverErrorDetected for error_status: 503 at attempt 2', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 2, error: 'unknown', error_status: 503 }) + '\n', state);
    expect(state.serverErrorDetected).toBe(true);
  });

  it('sets serverErrorDetected for error: "unknown" at attempt 2 (behaviour retained)', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 2, error: 'unknown' }) + '\n', state);
    expect(state.serverErrorDetected).toBe(true);
  });

  it('a documented but non-pause category (billing_error) sets nothing at attempt 1, serverErrorDetected at attempt 2', () => {
    const state1 = createState();
    parseJsonlOutput(apiRetry({ attempt: 1, error: 'billing_error' }) + '\n', state1);
    expect(state1.serverErrorDetected).toBe(false);

    const state2 = createState();
    parseJsonlOutput(apiRetry({ attempt: 2, error: 'billing_error' }) + '\n', state2);
    expect(state2.serverErrorDetected).toBe(true);
  });

  it('serverErrorDetected remains true once set (idempotent)', () => {
    const state = createState();
    parseJsonlOutput(apiRetry({ attempt: 2, error: 'unknown' }) + '\n', state);
    expect(state.serverErrorDetected).toBe(true);
    parseJsonlOutput(apiRetry({ attempt: 1, error: 'unknown' }) + '\n', state);
    expect(state.serverErrorDetected).toBe(true);
  });
});

describe('parseJsonlOutput — result.api_error_status', () => {
  function resultMsg(apiErrorStatus: number | null): string {
    return JSON.stringify({
      type: 'result', subtype: 'success', is_error: apiErrorStatus !== null, api_error_status: apiErrorStatus,
      duration_ms: 1, duration_api_ms: 1, num_turns: 1, result: 'x', session_id: 's',
    });
  }

  it('429 sets rateLimitDetected with no facts', () => {
    const state = createState();
    parseJsonlOutput(resultMsg(429) + '\n', state);
    expect(state.rateLimitDetected).toBe(true);
    expect(state.rateLimitType).toBeUndefined();
    expect(state.resetsAt).toBeUndefined();
  });

  it('529 sets overloadedErrorDetected, not serverErrorDetected', () => {
    const state = createState();
    parseJsonlOutput(resultMsg(529) + '\n', state);
    expect(state.overloadedErrorDetected).toBe(true);
    expect(state.serverErrorDetected).toBe(false);
  });

  it('401 sets authErrorDetected', () => {
    const state = createState();
    parseJsonlOutput(resultMsg(401) + '\n', state);
    expect(state.authErrorDetected).toBe(true);
  });

  it('500 sets serverErrorDetected', () => {
    const state = createState();
    parseJsonlOutput(resultMsg(500) + '\n', state);
    expect(state.serverErrorDetected).toBe(true);
  });

  it('503 sets serverErrorDetected', () => {
    const state = createState();
    parseJsonlOutput(resultMsg(503) + '\n', state);
    expect(state.serverErrorDetected).toBe(true);
  });

  it('null (success) sets nothing', () => {
    const state = createState();
    parseJsonlOutput(resultMsg(null) + '\n', state);
    expect(state.rateLimitDetected).toBe(false);
    expect(state.overloadedErrorDetected).toBe(false);
    expect(state.authErrorDetected).toBe(false);
    expect(state.serverErrorDetected).toBe(false);
  });

  it('400 sets nothing (not a recognised pause status)', () => {
    const state = createState();
    parseJsonlOutput(resultMsg(400) + '\n', state);
    expect(state.rateLimitDetected).toBe(false);
    expect(state.overloadedErrorDetected).toBe(false);
    expect(state.authErrorDetected).toBe(false);
    expect(state.serverErrorDetected).toBe(false);
  });

  it('always sets lastResult, with is_error/api_error_status readable through the extended type', () => {
    const state = createState();
    parseJsonlOutput(resultMsg(429) + '\n', state);
    expect(state.lastResult).not.toBeNull();
    expect(state.lastResult!.is_error).toBe(true);
    expect(state.lastResult!.api_error_status).toBe(429);
  });
});

describe('parseJsonlOutput — the 2026-09-22 incident stream end to end', () => {
  it('sets rateLimitDetected, both facts, lastResult.api_error_status, and leaves authErrorDetected false', () => {
    const state = createState();
    parseJsonlOutput(INCIDENT_STREAM, state);
    expect(state.rateLimitDetected).toBe(true);
    expect(state.rateLimitType).toBe(INCIDENT_RATE_LIMIT_TYPE);
    expect(state.resetsAt).toBe(INCIDENT_RESETS_AT);
    expect(state.lastResult).not.toBeNull();
    expect(state.lastResult!.api_error_status).toBe(429);
    expect(state.authErrorDetected).toBe(false);
  });
});

describe('parseJsonlOutput — compaction and false positives', () => {
  it('sets compactionDetected when system compact_boundary is parsed', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'system', subtype: 'compact_boundary' });
    parseJsonlOutput(line + '\n', state);
    expect(state.compactionDetected).toBe(true);
  });

  it('does NOT set any flags for assistant text content containing detection strings (false-positive scenario)', () => {
    const state = createState();
    const toolResult = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'text',
          text: 'The file contains overloaded, overloaded_error, rate_limit, api_error_status, 502 Bad Gateway, compact_boundary, authentication_failed, rate_limit_event, and "status":"rejected" strings',
        }],
      },
    });
    parseJsonlOutput(toolResult + '\n', state);
    expect(state.rateLimitDetected).toBe(false);
    expect(state.authErrorDetected).toBe(false);
    expect(state.serverErrorDetected).toBe(false);
    expect(state.overloadedErrorDetected).toBe(false);
    expect(state.compactionDetected).toBe(false);
  });

  it('handles multiple detection events in a single chunk', () => {
    const state = createState();
    const lines = [
      JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } }),
      JSON.stringify({ type: 'system', subtype: 'compact_boundary' }),
    ].join('\n') + '\n';
    parseJsonlOutput(lines, state);
    expect(state.rateLimitDetected).toBe(true);
    expect(state.compactionDetected).toBe(true);
  });
});

describe('parseJsonlOutput — denied tool call counting (issue #762)', () => {
  it('counts a single top-level tool_result with is_error: true', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'tool_result', tool_use_id: 't1', content: 'denied', is_error: true });
    parseJsonlOutput(line + '\n', state);
    expect(state.deniedToolCallCount).toBe(1);
  });

  it('does NOT count a top-level tool_result without is_error', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'tool_result', tool_use_id: 't1', content: 'ok' });
    parseJsonlOutput(line + '\n', state);
    expect(state.deniedToolCallCount).toBe(0);
  });

  it('does NOT count a top-level tool_result with is_error: false', () => {
    const state = createState();
    const line = JSON.stringify({ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false });
    parseJsonlOutput(line + '\n', state);
    expect(state.deniedToolCallCount).toBe(0);
  });

  it('counts a tool_result block nested in an assistant message content array', () => {
    const state = createState();
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'permission denied', is_error: true },
        ],
      },
    });
    parseJsonlOutput(line + '\n', state);
    expect(state.deniedToolCallCount).toBe(1);
  });

  it('sums 3 permission-denied tool results across a mixed stream to 3', () => {
    const state = createState();
    const lines = [
      JSON.stringify({ type: 'tool_result', tool_use_id: 't1', content: 'denied', is_error: true }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'trying again' }] },
      }),
      JSON.stringify({ type: 'tool_result', tool_use_id: 't2', content: 'denied', is_error: true }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 't3', content: 'denied', is_error: true }],
        },
      }),
    ].join('\n') + '\n';
    parseJsonlOutput(lines, state);
    expect(state.deniedToolCallCount).toBe(3);
  });

  it('a clean stream with no errored tool results yields 0', () => {
    const state = createState();
    const lines = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }),
      JSON.stringify({ type: 'tool_result', tool_use_id: 't1', content: 'ok' }),
      JSON.stringify({ type: 'result', subtype: 'success', isError: false, durationMs: 1, durationApiMs: 1, numTurns: 1, result: 'done', sessionId: 's' }),
    ].join('\n') + '\n';
    parseJsonlOutput(lines, state);
    expect(state.deniedToolCallCount).toBe(0);
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

    parseJsonlOutput(half1, state);
    expect(state.compactionDetected).toBe(false);
    expect(state.lineBuffer).toBe(half1);

    parseJsonlOutput(half2 + '\n', state);
    expect(state.compactionDetected).toBe(true);
    expect(state.lineBuffer).toBe('');
  });

  it('parses multiple complete lines in a single chunk', () => {
    const state = createState();
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'compact_boundary' }),
      JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, error: 'authentication_failed' }),
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
    parseJsonlOutput('', state);
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

    parseJsonlOutput(completeLine + '\n' + partialLine, state);
    expect(state.compactionDetected).toBe(true);
    expect(state.lineBuffer).toBe(partialLine);

    const rest = 'ype":"api_retry","error":"authentication_failed","attempt":1}';
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
