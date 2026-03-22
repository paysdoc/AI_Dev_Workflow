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
import { LOGS_DIR } from './environment';

// Re-export from focused modules
export { generateAdwId, slugify } from './adwId';
export { log, setLogAdwId, getLogAdwId, resetLogAdwId, type LogLevel } from './logger';
export { parseTargetRepoArgs } from './orchestratorCli';

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
