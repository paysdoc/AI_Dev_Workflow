export type LogLevel = 'info' | 'error' | 'success' | 'warn';

const LOG_PREFIXES: Record<LogLevel, string> = {
  info: '\u{1F4CB}',
  error: '\u{274C}',
  success: '\u{2705}',
  warn: '\u{26A0}\u{FE0F}',
};

const COLORS = {
  red: '\x1b[31m',
  reset: '\x1b[0m',
};

let _logAdwId: string | undefined;

export function setLogAdwId(adwId: string): void {
  _logAdwId = adwId;
}

export function getLogAdwId(): string | undefined {
  return _logAdwId;
}

/** Intended for test isolation only. */
export function resetLogAdwId(): void {
  _logAdwId = undefined;
}

/**
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
