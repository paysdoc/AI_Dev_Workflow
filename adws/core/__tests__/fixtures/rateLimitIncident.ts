/**
 * Hand-written, shaped like the 2026-09-22 incident (issue #840): a rejected five-hour
 * `rate_limit_event` at 12:50 UTC, followed by a terminal `result` carrying
 * `api_error_status: 429`. The PRD's envelope-gate issue will replace this with a
 * captured fixture. Shared by the parser, handler and probe unit tests.
 */

export const INCIDENT_RESETS_AT = 1790081400;
export const INCIDENT_RATE_LIMIT_TYPE = 'five_hour';

export const INCIDENT_INIT = JSON.stringify({
  type: 'system',
  subtype: 'init',
  cwd: '/tmp',
  session_id: 'incident-840',
});

export const INCIDENT_RATE_LIMIT_REJECTED = JSON.stringify({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'rejected',
    resetsAt: INCIDENT_RESETS_AT,
    rateLimitType: INCIDENT_RATE_LIMIT_TYPE,
    overageStatus: 'rejected',
    overageDisabledReason: 'org_level_disabled',
    isUsingOverage: false,
  },
});

export const INCIDENT_RESULT_429 = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: true,
  api_error_status: 429,
  terminal_reason: 'api_error',
  duration_ms: 1200,
  duration_api_ms: 900,
  num_turns: 0,
  result: "You've hit your session limit · resets 2:50pm (Europe/Amsterdam)",
  session_id: 'incident-840',
});

export const INCIDENT_STREAM = [INCIDENT_INIT, INCIDENT_RATE_LIMIT_REJECTED, INCIDENT_RESULT_429].join('\n') + '\n';
