/**
 * Replaces the process-lifetime `processedMerges` Set with a spawn-lock
 * check so that an `adwMerge` that exits without merging (e.g. because the
 * PR was not yet approved) will be re-dispatched on the next cron cycle once
 * the spawn lock is no longer held by a live process.
 */

import { readSpawnLockRecord } from './spawnGate';
import { isProcessLive } from '../core/processLiveness';
import { log } from '../core';
import type { RepoIdentifier } from '@paysdoc/devplatform';

export interface MergeDispatchDeps {
  readonly readLock: (repoInfo: RepoIdentifier, issueNumber: number) => { pid: number; pidStartedAt: string } | null;
  readonly isLive: (pid: number, pidStartedAt: string) => boolean;
}

const defaultDeps: MergeDispatchDeps = {
  readLock: readSpawnLockRecord,
  isLive: isProcessLive,
};

/**
 * Decision table:
 *   - no lock record         → dispatch (true)
 *   - malformed JSON         → dispatch (true) — treated as no lock
 *   - lock with dead PID     → dispatch (true) — stale lock, acquireIssueSpawnLock will reclaim
 *   - lock with live PID     → defer  (false) — a previous adwMerge is still in flight
 */
export function shouldDispatchMerge(
  repoInfo: RepoIdentifier,
  issueNumber: number,
  deps: MergeDispatchDeps = defaultDeps,
): boolean {
  let record: { pid: number; pidStartedAt: string } | null;
  try {
    record = deps.readLock(repoInfo, issueNumber);
  } catch {
    // Malformed JSON or unexpected read error — treat as no lock
    return true;
  }

  if (record === null) {
    return true;
  }

  // Empty pidStartedAt means stale-format record — treat as no lock (same as acquireIssueSpawnLock's reclaim path)
  if (!record.pidStartedAt) {
    return true;
  }

  const live = deps.isLive(record.pid, record.pidStartedAt);
  if (live) {
    log(
      `merge orchestrator already in flight for issue #${issueNumber} (pid=${record.pid}), deferring`,
      'info',
    );
    return false;
  }

  return true;
}
