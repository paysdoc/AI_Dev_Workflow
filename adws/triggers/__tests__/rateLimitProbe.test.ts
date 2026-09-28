import { describe, it, expect, vi } from 'vitest';
import { classifyProbeResult, probeRateLimit, PROBE_ARGS, type ProbeExecResult, type ProbeExec } from '../rateLimitProbe';
import {
  INCIDENT_STREAM,
  INCIDENT_RESULT_429,
  INCIDENT_RESETS_AT,
  INCIDENT_RATE_LIMIT_TYPE,
} from '../../core/__tests__/fixtures/rateLimitIncident';

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
const RATE_LIMIT_REJECTED_FIVE_HOUR_NO_RESET = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } });
const RESULT_OK = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, api_error_status: null, result: 'Pong!' });
const RESULT_ERR = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, api_error_status: null, result: 'Rate limit reached' });
const SESSION_LIMIT_TEXT = "You've hit your session limit · resets 1:50pm (Europe/Amsterdam)";

function result(overrides: Partial<ProbeExecResult>): ProbeExecResult {
  return { status: 0, stdout: '', stderr: '', ...overrides };
}

function apiRetry(overrides: Record<string, unknown>): string {
  return JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, ...overrides });
}

function resultWithStatus(apiErrorStatus: number): string {
  return JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: apiErrorStatus, terminal_reason: 'api_error', result: 'x' });
}

describe('classifyProbeResult', () => {
  it('reports clear on a healthy exit-0 stream carrying a non-rejected rate_limit_event', () => {
    const stdout = [INIT, ASSISTANT, RATE_LIMIT_ALLOWED, RESULT_OK].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 0, stdout }))).toEqual({ verdict: 'clear' });
  });

  it('reports clear for an allowed_warning rate_limit_event — only "rejected" holds the probe, and no facts leak in', () => {
    const stdout = [INIT, RATE_LIMIT_ALLOWED_WARNING, ASSISTANT, RESULT_OK].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 0, stdout }))).toEqual({ verdict: 'clear' });
  });

  it('reports limited with facts from the incident stream at exit 1', () => {
    expect(classifyProbeResult(result({ status: 1, stdout: INCIDENT_STREAM }))).toEqual({
      verdict: 'limited', rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT,
    });
  });

  it('reports limited with facts from the incident stream at exit 0 — structure beats exit code', () => {
    expect(classifyProbeResult(result({ status: 0, stdout: INCIDENT_STREAM }))).toEqual({
      verdict: 'limited', rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT,
    });
  });

  it('reports limited with no facts for a rejected event that carries none, alongside an error result', () => {
    const bareRejected = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } });
    const stdout = [INIT, bareRejected, RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'limited' });
  });

  it('reports limited with only the limit type when the rejected event has no reset time', () => {
    const stdout = [INIT, RATE_LIMIT_REJECTED_FIVE_HOUR_NO_RESET, RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'limited', rateLimitType: 'five_hour' });
  });

  it('reports limited with no facts for a 429 result with no rate_limit_event', () => {
    const stdout = [INIT, INCIDENT_RESULT_429].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'limited' });
  });

  it.each([529, 500, 502])('reports limited with no facts for a result api_error_status of %i and no event', (status) => {
    const stdout = [INIT, resultWithStatus(status)].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'limited' });
  });

  it('reports limited on api_retry rate_limit at attempt 1, with no event', () => {
    const stdout = [INIT, apiRetry({ error: 'rate_limit', error_status: 429 }), RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'limited' });
  });

  it('reports limited on error_status: 429 alone at attempt 1', () => {
    const stdout = [INIT, apiRetry({ error: 'unknown', error_status: 429 }), RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'limited' });
  });

  it('reports limited on api_retry overloaded at attempt 1 (the documented value)', () => {
    const stdout = [INIT, apiRetry({ error: 'overloaded', error_status: 529 }), RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'limited' });
  });

  it('reports limited on error_status: 529 alone at attempt 1', () => {
    const stdout = [INIT, apiRetry({ error: 'unknown', error_status: 529 }), RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'limited' });
  });

  it('reports limited on a second-attempt api_retry server error (HTTP 500)', () => {
    const stdout = [INIT, apiRetry({ attempt: 2, error: 'server_error', error_status: 500 }), RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'limited' });
  });

  it('reports unknown for a first-attempt server_error retry (the repeated-retry rule still applies)', () => {
    const stdout = [INIT, apiRetry({ attempt: 1, error: 'server_error' }), RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'unknown' });
  });

  it('reports failed on an api_retry authentication_failed (HTTP 401)', () => {
    const stdout = [INIT, apiRetry({ error: 'authentication_failed', error_status: 401 }), RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'failed' });
  });

  it('reports failed on authentication_failed with error_status: null', () => {
    const stdout = [INIT, apiRetry({ error: 'authentication_failed', error_status: null }), RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'failed' });
  });

  it('reports failed on error_status: 401 alone', () => {
    const stdout = [INIT, apiRetry({ error: 'unknown', error_status: 401 }), RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'failed' });
  });

  it('reports failed on a result api_error_status of 401', () => {
    const stdout = [INIT, resultWithStatus(401)].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'failed' });
  });

  it('reports failed when a rejected event AND a 401 retry appear in the same stream — auth is never mistaken for a limit', () => {
    const stdout = [INIT, RATE_LIMIT_REJECTED_FIVE_HOUR_NO_RESET, apiRetry({ error: 'authentication_failed', error_status: 401 }), RESULT_ERR].join('\n') + '\n';
    expect(classifyProbeResult(result({ status: 1, stdout }))).toEqual({ verdict: 'failed' });
  });

  it.each([
    ['stderr', SESSION_LIMIT_TEXT],
    ['stdout', SESSION_LIMIT_TEXT],
    ['stderr', "You've hit your limit · resets 3pm (Europe/Amsterdam)"],
    ['stderr', 'You’ve hit your session limit'],
    ['stderr', "You're out of extra usage"],
  ])('reports unknown for former fallback text (no JSON) on %s', (stream, text) => {
    const onStdout = stream === 'stdout';
    expect(classifyProbeResult(result({ status: 1, stdout: onStdout ? text : '', stderr: onStdout ? '' : text }))).toEqual({ verdict: 'unknown' });
  });

  it('reports limited for a rejected rate_limit_event that is the trailing line with no newline', () => {
    expect(classifyProbeResult(result({ status: 1, stdout: RATE_LIMIT_REJECTED_FIVE_HOUR_NO_RESET, stderr: '' }))).toEqual({ verdict: 'limited', rateLimitType: 'five_hour' });
  });

  it('reports unknown for a failure with no pause-worthy event and no limit wording', () => {
    expect(classifyProbeResult(result({ status: 1, stdout: '', stderr: 'Error: EACCES: permission denied' }))).toEqual({ verdict: 'unknown' });
  });

  it('reports unknown for exit 0 with no output at all — clear now requires a result envelope', () => {
    expect(classifyProbeResult(result({ status: 0, stdout: '', stderr: '' }))).toEqual({ verdict: 'unknown' });
  });

  it('reports unknown when the process times out (null status, no output)', () => {
    expect(classifyProbeResult(result({ status: null, stdout: '', stderr: '' }))).toEqual({ verdict: 'unknown' });
  });

  it('reports unknown for an errored result with api_error_status: null (a 400-class failure) and no signal', () => {
    const errResult = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, api_error_status: null, result: 'API Error: 400 invalid_request_error' });
    expect(classifyProbeResult(result({ status: 1, stdout: errResult + '\n' }))).toEqual({ verdict: 'unknown' });
  });

  it('reports unknown for an errored result at exit 0 with no other signal', () => {
    expect(classifyProbeResult(result({ status: 0, stdout: RESULT_ERR + '\n' }))).toEqual({ verdict: 'unknown' });
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
    expect(probeRateLimit(exec)).toEqual({ verdict: 'clear' });
  });

  it('returns limited with facts for an exec result carrying a rejected rate_limit_event', () => {
    const { exec } = makeExec(result({ status: 1, stdout: INCIDENT_STREAM }));
    expect(probeRateLimit(exec)).toEqual({ verdict: 'limited', rateLimitType: INCIDENT_RATE_LIMIT_TYPE, resetsAt: INCIDENT_RESETS_AT });
  });

  it('returns unknown and logs a warning, without throwing, when exec itself throws', () => {
    const exec: ProbeExec = () => { throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }); };
    expect(probeRateLimit(exec)).toEqual({ verdict: 'unknown' });
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

  it('logs at error level mentioning authentication when the outcome is failed', () => {
    const stdout = [INIT, apiRetry({ error: 'authentication_failed', error_status: 401 }), RESULT_ERR].join('\n') + '\n';
    const { exec } = makeExec(result({ status: 1, stdout }));
    probeRateLimit(exec);
    expect(vi.mocked(log)).toHaveBeenCalledWith(expect.stringContaining('authentication'), 'error');
  });
});
