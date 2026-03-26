/**
 * Backward-compatible re-export barrel for utilities.
 *
 * The utils.ts junk drawer has been split into focused modules:
 * - adwId.ts: generateAdwId(), slugify()
 * - logger.ts: log(), setLogAdwId(), getLogAdwId(), resetLogAdwId(), LogLevel
 * - orchestratorCli.ts: parseTargetRepoArgs() (moved — logically CLI-related)
 *
 * ensureLogsDirectory() stays here as it doesn't fit neatly elsewhere and is
 * widely used. ensureAgentStateDirectory() and getAgentStatePath() are removed
 * (they duplicated AgentStateManager.initializeState / AgentStateManager.getStatePath).
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, type ExecSyncOptions } from 'child_process';
import { LOGS_DIR } from './environment';
import { log } from './logger';

// Re-export from focused modules
export { generateAdwId, slugify } from './adwId';
export { log, setLogAdwId, getLogAdwId, resetLogAdwId, type LogLevel } from './logger';
export { parseTargetRepoArgs } from './orchestratorCli';

// ---------------------------------------------------------------------------
// Retry-wrapped execSync (exponential backoff, synchronous sleep via Atomics)
// ---------------------------------------------------------------------------

/**
 * Executes a shell command with retry logic and exponential backoff.
 * Drop-in synchronous replacement for execSync at gh CLI callsites.
 *
 * @param command - The shell command to run
 * @param options - execSync options plus optional `maxAttempts` (default: 3)
 * @returns The trimmed stdout string
 * @throws The last error after all attempts are exhausted
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
      if (attempt < maxAttempts - 1) {
        const backoff = 500 * Math.pow(2, attempt);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoff);
      }
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Logs directory helper (kept here — widely used, no better home)
// ---------------------------------------------------------------------------

/**
 * Ensures the logs directory exists for a given ADW session.
 * Creates the directory if it doesn't exist.
 * @returns The path to the session logs directory.
 */
export function ensureLogsDirectory(adwId: string): string {
  const sessionDir = path.join(LOGS_DIR, adwId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  return sessionDir;
}
