import { describe, it, expect, vi } from 'vitest';
import { classifyProbeResult, probeRateLimit, PROBE_ARGS, type ProbeExecResult, type ProbeExec } from '../rateLimitProbe';

vi.mock('../../core', () => ({
  log: vi.fn(),
  resolveClaudeCodePath: () => '/fake/claude',
}));

vi.mock('../../core/agentState', () => ({
  AgentStateManager: {
    writeRawOutput: vi.fn(),
    appendLog: vi.fn(),
  },
}));

import { log } from '../../core';

const INIT = JSON.stringify({ type: 'system', subtype: 'init', cwd: '/tmp', session_id: 's1' });
const ASSISTANT = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Pong!' }] } });
const RATE_LIMIT_ALLOWED = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: 1790333400, rateLimitType: 'five_hour', overageStatus: 'rejected', overageDisabledReason: 'org_level_disabled', isUsingOverage: false } });
const RATE_LIMIT_ALLOWED_WARNING = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning', resetsAt: 1790333400, rateLimitType: 'five_hour' } });
const RATE_LIMIT_REJECTED = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1790333400, rateLimitType: 'five_hour' } });
const RESULT_OK = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Pong!' });
const RESULT_ERR = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Rate limit reached' });
const SESSION_LIMIT_TEXT = "You've hit your session limit · resets 1:50pm (Europe/Amsterdam)";

function result(overrides: Partial<ProbeExecResult>): ProbeExecResult {
  return { status: 0, stdout: '', stderr: '', ...overrides };
}

describe('classifyProbeResult', () => {
  it('reports clear on a healthy exit-0 stream carrying a non-rejected rate_limit_event', () => {
    const stdout = [INIT, ASSISTANT, RATE_LIMIT_ALLOWED, RESULT_OK].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 0, stdout }))).toBe('clear');
  });

  it('reports clear for an allowed_warning rate_limit_event — only "rejected" holds the probe', () => {
    const stdout = [INIT, RATE_LIMIT_ALLOWED_WARNING, ASSISTANT, RESULT_OK].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 0, stdout }))).toBe('clear');
  });

  it('reports limited from a rejected rate_limit_event regardless of text, exit 1', () => {
    const stdout = [RATE_LIMIT_REJECTED, RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toBe('limited');
  });

  it('reports limited from a rejected rate_limit_event even when the process exits 0 — structure beats exit code', () => {
    const stdout = [RATE_LIMIT_REJECTED, RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 0, stdout }))).toBe('limited');
  });

  it('reports limited on the first api_retry overloaded_error (HTTP 529)', () => {
    const retry = JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, error: 'overloaded_error', error_status: 529 });
    const stdout = [INIT, retry, RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toBe('limited');
  });

  it('reports limited on a second-attempt api_retry server error (HTTP 500)', () => {
    const retry = JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 2, error: 'api_error', error_status: 500 });
    const stdout = [INIT, retry, RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toBe('limited');
  });

  it('reports limited on an api_retry authentication error (HTTP 401)', () => {
    const retry = JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, error_status: 401 });
    const stdout = [INIT, retry, RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toBe('limited');
  });

  it('reports limited from fallback text on stderr when stdout carried no structured signal', () => {
    expect(classifyProbeResult(result({ status: 1, stdout: '', stderr: SESSION_LIMIT_TEXT }))).toBe('limited');
  });

  it('reports limited from the legacy "You\'ve hit your limit" wording', () => {
    expect(classifyProbeResult(result({ status: 1, stdout: '', stderr: "You've hit your limit · resets 3pm (Europe/Amsterdam)" }))).toBe('limited');
  });

  it('reports limited from a typographic-apostrophe variant of the session-limit text', () => {
    expect(classifyProbeResult(result({ status: 1, stdout: '', stderr: 'You’ve hit your session limit' }))).toBe('limited');
  });

  it('reports limited from "You\'re out of extra usage"', () => {
    expect(classifyProbeResult(result({ status: 1, stdout: '', stderr: "You're out of extra usage" }))).toBe('limited');
  });

  it('reports limited from fallback text found on stdout instead of stderr', () => {
    expect(classifyProbeResult(result({ status: 1, stdout: SESSION_LIMIT_TEXT, stderr: '' }))).toBe('limited');
  });

  it('reports limited from a rejected rate_limit_event that is the trailing line with no newline', () => {
    expect(classifyProbeResult(result({ status: 1, stdout: RATE_LIMIT_REJECTED, stderr: '' }))).toBe('limited');
  });

  it('reports unknown for a failure with no pause-worthy event and no limit wording', () => {
    expect(classifyProbeResult(result({ status: 1, stdout: '', stderr: 'Error: EACCES: permission denied' }))).toBe('unknown');
  });

  it('reports unknown when the process times out (null status, no output)', () => {
    expect(classifyProbeResult(result({ status: null, stdout: '', stderr: '' }))).toBe('unknown');
  });

  it('reports unknown for a first-attempt api_retry with a non-overloaded, non-auth error', () => {
    const retry = JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, error: 'unknown' });
    const stdout = [INIT, retry, RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toBe('unknown');
  });

  it('reports unknown for a stream-json error result with no pause-worthy flag', () => {
    const errResult = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'API Error: 400 invalid_request_error' });
    expect(classifyProbeResult(result({ status: 1, stdout: errResult + '\n' }))).toBe('unknown');
  });
});

describe('probeRateLimit', () => {
  function makeExec(response: ProbeExecResult): { exec: ProbeExec; calls: Array<{ claudePath: string; args: readonly string[] }> } {
    const calls: Array<{ claudePath: string; args: readonly string[] }> = [];
    const exec: ProbeExec = (claudePath, args) => {
      calls.push({ claudePath, args });
      return response;
    };
    return { exec, calls };
  }

  it('invokes exec with the resolved claude path and the stream-json probe args', () => {
    const { exec, calls } = makeExec(result({ status: 0, stdout: RESULT_OK + '\n' }));
    probeRateLimit(exec);
    expect(calls).toHaveLength(1);
    expect(calls[0].claudePath).toBe('/fake/claude');
    expect(calls[0].args).toEqual(PROBE_ARGS);
    expect(PROBE_ARGS).toContain('--output-format');
    expect(PROBE_ARGS).toContain('stream-json');
    expect(PROBE_ARGS).toContain('--verbose');
    expect(PROBE_ARGS).toContain('--print');
    expect(PROBE_ARGS[PROBE_ARGS.length - 1]).toBe('ping');
  });

  it('returns clear for a healthy exec result', () => {
    const { exec } = makeExec(result({ status: 0, stdout: [INIT, ASSISTANT, RESULT_OK].join('\n') + '\n' }));
    expect(probeRateLimit(exec)).toBe('clear');
  });

  it('returns limited for an exec result carrying a rejected rate_limit_event', () => {
    const { exec } = makeExec(result({ status: 1, stdout: RATE_LIMIT_REJECTED + '\n' }));
    expect(probeRateLimit(exec)).toBe('limited');
  });

  it('returns unknown and logs a warning, without throwing, when exec itself throws', () => {
    const exec: ProbeExec = () => { throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }); };
    expect(probeRateLimit(exec)).toBe('unknown');
    expect(vi.mocked(log)).toHaveBeenCalledWith(expect.stringContaining('ENOENT'), 'warn');
  });

  it('logs a warning containing the exit status and a stderr snippet when the outcome is unknown', () => {
    const { exec } = makeExec(result({ status: 7, stdout: '', stderr: 'Error: Claude Code process exited unexpectedly' }));
    probeRateLimit(exec);
    expect(vi.mocked(log)).toHaveBeenCalledWith(
      expect.stringMatching(/exit 7.*Claude Code process exited unexpectedly/s),
      'warn',
    );
  });
});
