/**
 * Pure helpers behind the stub's on-demand rate-limited response. No I/O here —
 * the stub does its own file reads/writes around these.
 */

import type { ManifestResponse } from './manifestInterpreter.ts';

export interface DefaultResponseMode {
  kind: 'default';
}

export interface RateLimitedResponseMode {
  kind: 'rate-limited';
  /** Epoch seconds. */
  resetsAt: number;
  rateLimitType: string;
  /** Reject only the first N invocations counted per worktree; absent means every invocation. */
  limitedInvocations?: number;
}

export type ResponseMode = DefaultResponseMode | RateLimitedResponseMode;

const DEFAULT_RATE_LIMIT_TYPE = 'five_hour';
const DEFAULT_RESET_OFFSET_SECONDS = 300;

function nowPlusDefaultOffset(): number {
  return Math.floor(Date.now() / 1000) + DEFAULT_RESET_OFFSET_SECONDS;
}

/**
 * Precedence: a manifest `response` block, then MOCK_RESPONSE=rate-limited (+
 * MOCK_RATE_LIMIT_RESETS_AT / MOCK_RATE_LIMIT_TYPE), else the default response.
 * `resetsAt` defaults to now + 300s so a rejected event always names a reset
 * that has not yet passed, as a real one does.
 */
export function resolveResponseMode(
  manifestResponse: ManifestResponse | undefined,
  env: Record<string, string | undefined>,
): ResponseMode {
  if (manifestResponse?.kind === 'rate-limited') {
    return {
      kind: 'rate-limited',
      resetsAt: manifestResponse.resetsAt ?? nowPlusDefaultOffset(),
      rateLimitType: manifestResponse.rateLimitType ?? DEFAULT_RATE_LIMIT_TYPE,
      limitedInvocations: manifestResponse.limitedInvocations,
    };
  }

  if (env['MOCK_RESPONSE'] === 'rate-limited') {
    const resetsAtOverride = env['MOCK_RATE_LIMIT_RESETS_AT'];
    return {
      kind: 'rate-limited',
      resetsAt: resetsAtOverride !== undefined && resetsAtOverride !== '' ? Number(resetsAtOverride) : nowPlusDefaultOffset(),
      rateLimitType: env['MOCK_RATE_LIMIT_TYPE'] ?? DEFAULT_RATE_LIMIT_TYPE,
    };
  }

  return { kind: 'default' };
}

/** `invocationCount` is the number of prior invocations (0-based) seen so far this worktree. */
export function shouldRateLimit(mode: ResponseMode, invocationCount: number): boolean {
  if (mode.kind !== 'rate-limited') return false;
  if (mode.limitedInvocations === undefined) return true;
  return invocationCount < mode.limitedInvocations;
}

export interface RateLimitedTemplates {
  event: Record<string, unknown>;
  assistant: Record<string, unknown>;
  result: Record<string, unknown>;
}

/** Builds the three JSON lines of the rate-limited response, mirroring the real sequence. */
export function buildRateLimitedLines(
  templates: RateLimitedTemplates,
  opts: { resetsAt: number; rateLimitType: string },
): string[] {
  const rateLimitInfo = {
    ...(templates.event['rate_limit_info'] as Record<string, unknown> | undefined ?? {}),
    resetsAt: opts.resetsAt,
    rateLimitType: opts.rateLimitType,
  };
  const event = { ...templates.event, rate_limit_info: rateLimitInfo };

  return [
    JSON.stringify(event),
    JSON.stringify(templates.assistant),
    JSON.stringify(templates.result),
  ];
}
