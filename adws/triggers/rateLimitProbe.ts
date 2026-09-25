/**
 * Structural rate-limit probe for the pause queue. Runs a one-turn `claude` ping under
 * the same stream-json output mode the pipeline agents use, and classifies the result
 * through the shared `claudeStreamParser` state — the same signals `agentProcessHandler`
 * pauses a live agent run on. There is no text fallback: output that never reached
 * stream-json (the process died before emitting any JSON) classifies as `unknown`.
 */

import { spawnSync } from 'child_process';
import { log, resolveClaudeCodePath } from '../core';
import { parseJsonlOutput, createJsonlParserState, type JsonlParserState } from '../core/claudeStreamParser';
import type { RateLimitFacts } from '../types/agentTypes';

export type ProbeOutcome = 'clear' | 'limited' | 'failed' | 'unknown';

export interface ProbeClassification extends RateLimitFacts {
  verdict: ProbeOutcome;
}

export interface ProbeExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type ProbeExec = (claudePath: string, args: readonly string[]) => ProbeExecResult;

const PROBE_TIMEOUT_MS = 30_000;

// Same output mode the pipeline agents run under (see claudeAgent.ts's cliArgs), so the
// probe sees the same rate_limit_event / api_retry envelopes the orchestrator pauses on.
export const PROBE_ARGS: readonly string[] = [
  '--print', '--verbose', '--output-format', 'stream-json',
  '--model', 'haiku', '--max-turns', '1', '--dangerously-skip-permissions',
  'ping',
];

// parseJsonlOutput buffers a final segment that lacks a trailing '\n' instead of parsing
// it; a rate_limit_event that happens to be the last thing the CLI wrote would otherwise
// never be seen.
function withTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function factsOf(state: JsonlParserState): RateLimitFacts {
  const facts: RateLimitFacts = {};
  if (state.rateLimitType !== undefined) facts.rateLimitType = state.rateLimitType;
  if (state.resetsAt !== undefined) facts.resetsAt = state.resetsAt;
  return facts;
}

function tailOf(text: string, maxLength = 300): string {
  return text.length > maxLength ? text.slice(-maxLength) : text;
}

/**
 * Ranked: a confirmed authentication failure is never a limit, even alongside a rejected
 * rate_limit_event. `clear` requires an actual non-errored result envelope at exit 0 — a
 * clean exit with no parseable JSON is `unknown`, not `clear` (never guess from text).
 */
export function classifyProbeResult(result: ProbeExecResult): ProbeClassification {
  const state = createJsonlParserState();
  parseJsonlOutput(withTrailingNewline(result.stdout), state);

  if (state.authErrorDetected) return { verdict: 'failed' };
  if (state.rateLimitDetected || state.overloadedErrorDetected || state.serverErrorDetected) {
    return { verdict: 'limited', ...factsOf(state) };
  }
  if (result.status === 0 && state.lastResult !== null && state.lastResult.is_error !== true) {
    return { verdict: 'clear' };
  }
  return { verdict: 'unknown' };
}

export function runClaudeProbe(claudePath: string, args: readonly string[]): ProbeExecResult {
  // No shell (an args array), so a claudePath containing spaces is safe. stdin is
  // 'ignore' — the real CLI waits ~3s for stdin on an open pipe and warns; ignoring it
  // avoids that stall entirely.
  const result = spawnSync(claudePath, [...args], {
    encoding: 'utf-8',
    timeout: PROBE_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function probeRateLimit(exec: ProbeExec = runClaudeProbe): ProbeClassification {
  try {
    const result = exec(resolveClaudeCodePath(), PROBE_ARGS);
    const classification = classifyProbeResult(result);
    if (classification.verdict === 'unknown') {
      log(`Rate-limit probe unclassified (exit ${result.status}): ${tailOf(result.stderr || result.stdout)}`, 'warn');
    } else if (classification.verdict === 'failed') {
      log('Rate-limit probe hit a confirmed authentication failure — the auth queue owns recovery, not the pause queue.', 'error');
    }
    return classification;
  } catch (err) {
    log(`Rate-limit probe could not run: ${err}`, 'warn');
    return { verdict: 'unknown' };
  }
}
