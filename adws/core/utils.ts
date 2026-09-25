import * as fs from 'fs';
import * as path from 'path';
import { execSync, type ExecSyncOptions } from 'child_process';
import { LOGS_DIR } from './environment';
import { log } from './logger';

export { generateAdwId, slugify } from './adwId';
export { log, setLogAdwId, getLogAdwId, resetLogAdwId, type LogLevel } from './logger';
export { parseTargetRepoArgs } from './orchestratorCli';

/**
 * When execWithRetry catches one of these, it throws immediately without backoff.
 */
const NON_RETRYABLE_PATTERNS = [
  'No commits between',
  'already exists',
  'is not mergeable',
  'gh auth login',
  'GH_TOKEN',
  'HTTP 401',
  'Bad credentials',
  'authentication',
];

/**
 * Drop-in synchronous replacement for execSync at gh CLI callsites.
 *
 * @param options - execSync options plus optional `maxAttempts` (default: 3)
 */
export function execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string {
  const maxAttempts = options?.maxAttempts ?? 3;
  const { maxAttempts: _maxAttempts, ...execOptions } = (options ?? {}) as ExecSyncOptions & { maxAttempts?: number };
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = execSync(command, { encoding: 'utf-8', ...execOptions });
      return (result as string).trim();
    } catch (error) {
      lastError = error;
      log(`execWithRetry failed (attempt ${attempt + 1}/${maxAttempts}): ${error}`, 'error');
      const errorMessage = String(error);
      if (NON_RETRYABLE_PATTERNS.some(pattern => errorMessage.includes(pattern))) {
        log('execWithRetry: non-retryable error, failing immediately', 'error');
        throw error;
      }
      if (attempt < maxAttempts - 1) {
        const backoff = 500 * Math.pow(2, attempt);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoff);
      }
    }
  }

  throw lastError;
}

export function ensureLogsDirectory(adwId: string): string {
  const sessionDir = path.join(LOGS_DIR, adwId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  return sessionDir;
}
