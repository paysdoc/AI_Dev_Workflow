/**
 * Cron Process Guard
 *
 * Provides persistent PID-file-based duplicate cron prevention.
 * Stores the PID and repo key of each running cron process on disk under
 * `agents/cron/{owner}_{repo}.json` so that duplicate detection survives
 * webhook server restarts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log } from '../core';
import { AGENTS_STATE_DIR } from '../core/config';
import { isProcessAlive } from '../core/stateHelpers';

interface CronPidRecord {
  pid: number;
  repoKey: string;
  startedAt: string;
}

/** Returns the PID file path for a given repo key (e.g. `owner/repo` → `agents/cron/owner_repo.json`). */
function getCronPidFilePath(repoKey: string): string {
  return path.join(AGENTS_STATE_DIR, 'cron', repoKey.replace('/', '_') + '.json');
}

/** Creates the `agents/cron/` directory if it does not exist. */
function ensureCronDir(): void {
  fs.mkdirSync(path.join(AGENTS_STATE_DIR, 'cron'), { recursive: true });
}

/** Writes a PID record for the given repo key to disk. */
export function writeCronPid(repoKey: string, pid: number): void {
  ensureCronDir();
  const record: CronPidRecord = { pid, repoKey, startedAt: new Date().toISOString() };
  fs.writeFileSync(getCronPidFilePath(repoKey), JSON.stringify(record, null, 2), 'utf-8');
}

/** Reads and parses the PID record for a repo key. Returns null if missing or malformed. */
function readCronPid(repoKey: string): CronPidRecord | null {
  const filePath = getCronPidFilePath(repoKey);
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CronPidRecord;
  } catch {
    return null;
  }
}

/** Removes the PID file for a repo key if it exists. */
function removeCronPid(repoKey: string): void {
  const filePath = getCronPidFilePath(repoKey);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore removal errors
  }
}

/**
 * Returns true if a live cron process is registered for the given repo key.
 * Removes stale PID files (dead processes) automatically.
 */
export function isCronAliveForRepo(repoKey: string): boolean {
  const record = readCronPid(repoKey);
  if (!record) return false;
  if (isProcessAlive(record.pid)) return true;
  log(`Removing stale cron PID file for ${repoKey} (PID ${record.pid} is dead)`);
  removeCronPid(repoKey);
  return false;
}

/**
 * Registers `ownPid` as the cron process for `repoKey` after verifying no live duplicate exists.
 *
 * Returns `true` if this process may proceed (no live duplicate found, PID written).
 * Returns `false` if another live cron process is already registered for the same repo
 * (caller should exit immediately).
 */
export function registerAndGuard(repoKey: string, ownPid: number): boolean {
  const record = readCronPid(repoKey);
  if (record) {
    if (record.pid !== ownPid && isProcessAlive(record.pid)) {
      return false;
    }
    if (!isProcessAlive(record.pid)) {
      removeCronPid(repoKey);
    }
  }
  writeCronPid(repoKey, ownPid);
  return true;
}
