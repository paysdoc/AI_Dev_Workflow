/**
 * I/O shell over the pure `pauseQueueDecider`. Reads the queue, probes at most once per
 * scan — and never at all while no entry this cron owns is due for a probe — decides
 * every entry's action through `decidePauseQueueAction` (so `skip_not_owner` is exercised
 * for real, not just structurally possible), and executes it:
 *   - `skip_not_owner`: untouched, no log line (the scan summary already counts it) — this
 *     process is not the entry's owning cron; it never strikes, refreshes, resumes or
 *     evicts an entry it does not own.
 *   - `skip_before_reset`: untouched, no log line (the scan summary already covers it).
 *   - `resume`: `resumeWorkflow` (clear probe, reset time past or absent) — removes the
 *     entry before spawning; see `pauseQueueResume.ts`.
 *   - `refresh_reset`: updates `lastProbeAt` and, when the probe reported one, `resetsAt`/
 *     `rateLimitType` — never `probeFailures` (a `limited` probe never strikes).
 *   - `count_strike`: updates `probeFailures`/`lastProbeAt`.
 *   - `evict`: removes the entry and posts an error comment naming `## Retry` as the
 *     recovery. Writes no top-level state — the stage stays `paused`, which is what makes
 *     `## Retry` applicable.
 *
 * One owning cron per entry: every process on the host runs this scanner, but each is
 * handed its own launch identity (`PauseQueueScanDeps.scanningCron`) and only acts on the
 * entries whose recorded target repository matches it (or, for entries recording none, only
 * the self-host cron). This is what stops two crons from striking or resuming the same
 * entry, as happened in production when two host processes scanned the same shared queue.
 */

import { log, PROBE_INTERVAL_CYCLES, MAX_UNKNOWN_PROBE_FAILURES } from '../core';
import {
  readPauseQueue,
  removeFromPauseQueue,
  updatePauseQueueEntry,
  type PausedWorkflow,
} from '../core/pauseQueue';
import type { ProbeClassification } from './rateLimitProbe';
import {
  isBeforeReset,
  decidePauseQueueAction,
  isOwnedByScanningCron,
  type PauseQueueAction,
  type ScanningCronIdentity,
  type StrikeVerdict,
} from './pauseQueueDecider';
import { resumeWorkflow, postEntryStageComment, type ResumeDeps } from './pauseQueueResume';

/** The identity that makes this process the owner of exactly the entries paused for its repo, plus the test seams (clock, spawn). */
export interface PauseQueueScanDeps extends ResumeDeps {
  readonly scanningCron: ScanningCronIdentity;
}

function describeStrikeVerdict(verdict: StrikeVerdict): string {
  return verdict === 'failed'
    ? 'a confirmed failure that was not a rate limit'
    : 'a probe result that could not be classified';
}

async function executePauseQueueAction(
  entry: PausedWorkflow,
  action: PauseQueueAction,
  now: Date,
  deps: PauseQueueScanDeps,
): Promise<void> {
  switch (action.kind) {
    case 'skip_not_owner':
      return;

    case 'skip_before_reset':
      return;

    case 'resume':
      log(`Rate limit cleared — resuming workflow ${entry.adwId}`, 'success');
      await resumeWorkflow(entry, { now: deps.now, spawn: deps.spawn });
      return;

    case 'refresh_reset':
      updatePauseQueueEntry(entry.adwId, {
        lastProbeAt: now.toISOString(),
        ...(action.resetsAt ? { resetsAt: action.resetsAt } : {}),
        ...(action.rateLimitType ? { rateLimitType: action.rateLimitType } : {}),
      });
      if (action.resetsAt) {
        log(`Rate limit still active for workflow ${entry.adwId} — waits until ${action.resetsAt}`, 'info');
      } else {
        log(`Rate limit still active for workflow ${entry.adwId} — will retry later`, 'info');
      }
      return;

    case 'count_strike':
      log(`Probe failure (${action.verdict}) for workflow ${entry.adwId} (${action.probeFailures}/${MAX_UNKNOWN_PROBE_FAILURES})`, 'warn');
      updatePauseQueueEntry(entry.adwId, { probeFailures: action.probeFailures, lastProbeAt: now.toISOString() });
      return;

    case 'evict':
      log(`Max probe failures reached for ${entry.adwId} — removing from queue`, 'error');
      removeFromPauseQueue(entry.adwId);
      postEntryStageComment(entry, 'error', {
        issueNumber: entry.issueNumber,
        adwId: entry.adwId,
        errorMessage: `Workflow paused at '${entry.pausedAtPhase}' failed to resume after ${action.probeFailures} probe attempts (last result: ${describeStrikeVerdict(action.verdict)}). It stays paused — post \`## Retry\` on this issue to respawn it.`,
      });
      return;

    default: {
      const exhaustive: never = action;
      throw new Error(`Unhandled pause-queue action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Only runs the probe every PROBE_INTERVAL_CYCLES cycles to avoid hammering the API. */
export async function scanPauseQueue(
  cycleCount: number,
  probe: () => ProbeClassification,
  deps: PauseQueueScanDeps,
): Promise<void> {
  if (cycleCount % PROBE_INTERVAL_CYCLES !== 0) return;

  const entries = readPauseQueue();
  if (entries.length === 0) return;

  const { scanningCron } = deps;
  const ownerLabel = `${scanningCron.repoId.owner}/${scanningCron.repoId.repo}`;
  const owned = entries.filter(entry => isOwnedByScanningCron(entry, scanningCron));

  if (owned.length === 0) {
    log(`Pause queue scan: ${entries.length} paused workflow(s), none owned by this cron (${ownerLabel}) — probe skipped`);
    return;
  }

  const now = (deps.now ?? (() => new Date()))();
  const due = owned.filter(entry => !isBeforeReset(entry, now));

  if (due.length === 0) {
    const earliestResetsAt = owned
      .map(entry => entry.resetsAt)
      .filter((resetsAt): resetsAt is string => Boolean(resetsAt))
      .sort()[0];
    log(`Pause queue scan: ${entries.length} paused workflow(s), all owned entries waiting for a reset time (earliest ${earliestResetsAt}) — probe skipped`);
    return;
  }

  log(`Pause queue scan: ${entries.length} paused workflow(s), ${owned.length} owned by ${ownerLabel}, ${due.length} due for a probe`);
  const classification = probe();

  for (const entry of entries) {
    const action = decidePauseQueueAction({ entry, scanningCron, probe: classification, now, maxProbeFailures: MAX_UNKNOWN_PROBE_FAILURES });
    await executePauseQueueAction(entry, action, now, deps);
  }
}
