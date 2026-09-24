#!/usr/bin/env npx tsx
import * as fs from 'fs';
import * as path from 'path';

export const LOG_BASE_DIR = process.env.CLAUDE_HOOKS_LOG_DIR || 'logs';

export function getSessionLogDir(sessionId: string): string {
  return path.join(LOG_BASE_DIR, sessionId);
}

export function ensureSessionLogDir(sessionId: string): string {
  const logDir = getSessionLogDir(sessionId);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}
