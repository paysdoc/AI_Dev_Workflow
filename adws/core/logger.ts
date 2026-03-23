/**
 * ADW structured logger.
 *
 * Provides timestamped, emoji-prefixed log output with optional per-session
 * ADW ID tagging. Extracted from utils.ts to give logging a focused module.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'info' | 'error' | 'success' | 'warn';

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const LOG_PREFIXES: Record<LogLevel, string> = {
  info: '\u{1F4CB}',
  error: '\u{274C}',
  success: '\u{2705}',
  warn: '\u{26A0}\u{FE0F}',
};

// ANSI color codes
const COLORS = {
  red: '\x1b[31m',
  reset: '\x1b[0m',
};

/** Module-level adwId for log output. */
let _logAdwId: string | undefined;

// ---------------------------------------------------------------------------
// ADW ID management
// ---------------------------------------------------------------------------

/** Sets the adwId included in all subsequent log lines. */
export function setLogAdwId(adwId: string): void {
  _logAdwId = adwId;
}

/** Returns the current adwId used by the logger, or undefined if not set. */
export function getLogAdwId(): string | undefined {
  return _logAdwId;
}

/** Resets the logger adwId to undefined. Intended for test isolation only. */
export function resetLogAdwId(): void {
  _logAdwId = undefined;
}

// ---------------------------------------------------------------------------
// Log function
// ---------------------------------------------------------------------------

/**
 * Logs a message with timestamp and emoji prefix.
 * When an adwId has been set via setLogAdwId(), it is included after the timestamp.
 * Error messages are displayed in red.
 */
export function log(message: string, level: LogLevel = 'info'): void {
  const timestamp = new Date().toISOString();
  const prefix = LOG_PREFIXES[level];
  const adwIdSegment = _logAdwId ? ` [${_logAdwId}]` : '';
  const text = `${prefix} [${timestamp}]${adwIdSegment} ${message}`;
  if (level === 'error') {
    console.log(`${COLORS.red}${text}${COLORS.reset}`);
  } else {
    console.log(text);
  }
}
