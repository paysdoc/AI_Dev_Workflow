import * as fs from 'fs';

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
let _logFilePath: string | undefined;

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

/** Every later `log()` line is also appended to this file, without the colour the console shows. */
export function setLogFile(filePath: string): void {
  _logFilePath = filePath;
}

/** Intended for test isolation only. */
export function resetLogFile(): void {
  _logFilePath = undefined;
}

// Synchronous, so every line is on disk before a caller's process.exit().
function appendToLogFile(filePath: string, text: string): void {
  try {
    fs.appendFileSync(filePath, `${text}\n`, 'utf-8');
  } catch {
    // A log file that cannot be written must never break the run it records.
  }
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
  if (_logFilePath) appendToLogFile(_logFilePath, text);
}
