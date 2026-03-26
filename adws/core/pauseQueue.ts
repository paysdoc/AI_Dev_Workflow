/**
 * Pause queue — atomic read/write/remove operations on agents/paused_queue.json.
 *
 * Shared across all repos/workflows; uses read-modify-write for each operation.
 * Race conditions between concurrent cron processes are low-risk (each entry
 * has a unique adwId) but the pattern minimizes window size.
 */

import * as fs from 'fs';

/** Path to the shared pause queue file. */
export const PAUSE_QUEUE_PATH = 'agents/paused_queue.json';

/**
 * A workflow entry in the pause queue.
 */
export interface PausedWorkflow {
  /** Unique ADW session identifier. */
  adwId: string;
  /** GitHub issue number being processed. */
  issueNumber: number;
  /** Script path used to spawn the orchestrator (e.g. 'adws/adwSdlc.tsx'). */
  orchestratorScript: string;
  /** Phase name where the workflow paused. */
  pausedAtPhase: string;
  /** Reason for the pause. */
  pauseReason: 'rate_limited' | 'unknown_error';
  /** ISO 8601 timestamp when the workflow paused. */
  pausedAt: string;
  /** ISO 8601 timestamp of the last probe attempt. */
  lastProbeAt?: string;
  /** Number of consecutive probe failures that did not match rate-limit text. */
  probeFailures?: number;
  /** Absolute path to the worktree used by this workflow. */
  worktreePath: string;
  /** Git branch name for this workflow. */
  branchName: string;
  /** Optional extra CLI args to pass on resume (e.g. --target-repo owner/repo). */
  extraArgs?: string[];
}

/** Reads the pause queue file. Returns an empty array if the file is missing or unreadable. */
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

/** Appends an entry to the pause queue. Skips duplicates by adwId. */
export function appendToPauseQueue(entry: PausedWorkflow): void {
  const existing = readPauseQueue();
  if (existing.some(e => e.adwId === entry.adwId)) return;
  writePauseQueue([...existing, entry]);
}

/** Removes an entry from the pause queue by adwId. */
export function removeFromPauseQueue(adwId: string): void {
  const existing = readPauseQueue();
  writePauseQueue(existing.filter(e => e.adwId !== adwId));
}

/** Updates fields on an existing pause queue entry by adwId. No-op if not found. */
export function updatePauseQueueEntry(adwId: string, updates: Partial<PausedWorkflow>): void {
  const existing = readPauseQueue();
  writePauseQueue(existing.map(e => e.adwId === adwId ? { ...e, ...updates } : e));
}
