/**
 * Shared across all repos/workflows; uses read-modify-write for each operation.
 * Race conditions between concurrent cron processes are low-risk (each entry
 * has a unique adwId) but the pattern minimizes window size.
 */

import * as fs from 'fs';

export const PAUSE_QUEUE_PATH = 'agents/paused_queue.json';

export interface PausedWorkflow {
  adwId: string;
  issueNumber: number;
  orchestratorScript: string;
  pausedAtPhase: string;
  pauseReason: 'rate_limited' | 'unknown_error';
  /** ISO 8601 timestamp when the workflow paused. */
  pausedAt: string;
  /** ISO 8601 timestamp of the last probe attempt. */
  lastProbeAt?: string;
  /** Consecutive probes classified 'unknown' (not a rate limit); reset is not automatic. */
  probeFailures?: number;
  /** Absolute path to the worktree used by this workflow. */
  worktreePath: string;
  branchName: string;
  /** Optional extra CLI args to pass on resume (e.g. --target-repo owner/repo). */
  extraArgs?: string[];
  /**
   * ISO 8601; the CLI's epoch-seconds reset time converted once at the boundary.
   * Absent when the pause carried no reset time or the entry predates this field.
   */
  resetsAt?: string;
  /** As reported by the CLI (five_hour, seven_day, …); absent for the same reasons. */
  rateLimitType?: string;
}

/** Returns an empty array if the file is missing or unreadable. */
export function readPauseQueue(): PausedWorkflow[] {
  try {
    if (!fs.existsSync(PAUSE_QUEUE_PATH)) return [];
    const content = fs.readFileSync(PAUSE_QUEUE_PATH, 'utf-8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Writes the pause queue file atomically (write to temp then rename). */
function writePauseQueue(entries: PausedWorkflow[]): void {
  const tmp = `${PAUSE_QUEUE_PATH}.tmp`;
  fs.mkdirSync('agents', { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf-8');
  fs.renameSync(tmp, PAUSE_QUEUE_PATH);
}

/** Skips duplicates by adwId. */
export function appendToPauseQueue(entry: PausedWorkflow): void {
  const existing = readPauseQueue();
  if (existing.some(e => e.adwId === entry.adwId)) return;
  writePauseQueue([...existing, entry]);
}

export function removeFromPauseQueue(adwId: string): void {
  const existing = readPauseQueue();
  writePauseQueue(existing.filter(e => e.adwId !== adwId));
}

/** No-op if not found. */
export function updatePauseQueueEntry(adwId: string, updates: Partial<PausedWorkflow>): void {
  const existing = readPauseQueue();
  writePauseQueue(existing.map(e => e.adwId === adwId ? { ...e, ...updates } : e));
}

/**
 * The CLI emits Unix epoch seconds; the queue stores ISO so the file is
 * human-readable and Date.parse-able. This is the only place that conversion happens.
 */
export function resetsAtIsoFromEpochSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}
