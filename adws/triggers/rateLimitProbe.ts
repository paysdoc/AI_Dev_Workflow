/**
 * Structural rate-limit probe for the pause queue. Runs a one-turn `claude` ping under
 * the same stream-json output mode the pipeline agents use, and classifies the result
 * through the shared `claudeStreamParser` state — the same signals `agentProcessHandler`
 * pauses a live agent run on. Text matching survives only as a fallback for output that
 * never reached stream-json (e.g. the process died before emitting any JSON).
 */

import { spawnSync } from 'child_process';
import { log, resolveClaudeCodePath } from '../core';
import { parseJsonlOutput, type JsonlParserState } from '../core/claudeStreamParser';

export type ProbeOutcome = 'clear' | 'limited' | 'unknown';

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

// Fallback only — used when stdout/stderr carried no structured stream-json signal at
// all (the process died before emitting one). The stable prefix covers both "You've hit
// your limit" and "You've hit your session limit" without hand-tracking every wording.
const RATE_LIMIT_TEXT_PATTERNS = [
  "You've hit your",
  "You're out of extra usage",
  '502 Bad Gateway',
  'Invalid authentication credentials',
];

function normalizeApostrophes(text: string): string {
  return text.replace(/[‘’]/g, "'");
}

function containsRateLimitText(text: string): boolean {
  const normalized = normalizeApostrophes(text);
  return RATE_LIMIT_TEXT_PATTERNS.some(pattern => normalized.includes(pattern));
}

function createProbeParserState(): JsonlParserState {
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
    deniedToolCallCount: 0,
  };
}

// parseJsonlOutput buffers a final segment that lacks a trailing '\n' instead of parsing
// it; a rate_limit_event that happens to be the last thing the CLI wrote would otherwise
// never be seen.
function withTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function hasPauseWorthySignal(state: JsonlParserState): boolean {
  return state.rateLimitRejected || state.serverErrorDetected
    || state.overloadedErrorDetected || state.authErrorDetected;
}

function tailOf(text: string, maxLength = 300): string {
  return text.length > maxLength ? text.slice(-maxLength) : text;
}

/**
 * Order matters: structural detection first, then the text fallback, then exit code.
 * Text is checked before `status === 0` so a run whose output still says the limit is
 * active is never treated as clear just because the process happened to exit 0.
 */
export function classifyProbeResult(result: ProbeExecResult): ProbeOutcome {
  const state = createProbeParserState();
  parseJsonlOutput(withTrailingNewline(result.stdout), state);
  if (hasPauseWorthySignal(state)) return 'limited';
  if (containsRateLimitText(`${result.stdout}\n${result.stderr}`)) return 'limited';
  if (result.status === 0) return 'clear';
  return 'unknown';
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

export function probeRateLimit(exec: ProbeExec = runClaudeProbe): ProbeOutcome {
  try {
    const result = exec(resolveClaudeCodePath(), PROBE_ARGS);
    const outcome = classifyProbeResult(result);
    if (outcome === 'unknown') {
      log(`Rate-limit probe unclassified (exit ${result.status}): ${tailOf(result.stderr || result.stdout)}`, 'warn');
    }
    return outcome;
  } catch (err) {
    log(`Rate-limit probe could not run: ${err}`, 'warn');
    return 'unknown';
  }
}
