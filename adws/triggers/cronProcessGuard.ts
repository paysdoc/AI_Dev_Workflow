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
 * Atomically attempts to create the PID file for `repoKey` using the `wx` (exclusive create) flag.
 * Returns `true` if the file was created exclusively (this process won the race).
 * Returns `false` if the file already exists (EEXIST — another process got there first).
 * Re-throws any unexpected filesystem error.
 */
function tryExclusiveCreate(repoKey: string, pid: number): boolean {
  ensureCronDir();
  const record: CronPidRecord = { pid, repoKey, startedAt: new Date().toISOString() };
  try {
    fs.writeFileSync(getCronPidFilePath(repoKey), JSON.stringify(record, null, 2), { flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

/**
 * Registers `ownPid` as the cron process for `repoKey` using atomic exclusive file creation
 * to prevent TOCTOU races.
 *
 * Returns `true` if this process may proceed (exclusively created the PID file or re-registered self).
 * Returns `false` if another live cron process is already registered for the same repo
 * (caller should exit immediately).
 */
export function registerAndGuard(repoKey: string, ownPid: number): boolean {
  // Attempt atomic exclusive create — only one process can win this, no race possible.
  if (tryExclusiveCreate(repoKey, ownPid)) return true;

  // File already exists — inspect who owns it.
  const record = readCronPid(repoKey);

  if (record !== null) {
    if (record.pid === ownPid) return true; // Re-registration of self.
    if (isProcessAlive(record.pid)) return false; // Another live cron is running.
  }

  // Record is null/malformed or the recorded PID is dead — stale file, clean it up and retry.
  const stalePid = record?.pid ?? 'unknown';
  log(`Removing stale cron PID file for ${repoKey} (PID ${stalePid} is dead)`);
  removeCronPid(repoKey);

  // Retry exclusive create — only one process wins even if multiple are racing here.
  return tryExclusiveCreate(repoKey, ownPid);
}
