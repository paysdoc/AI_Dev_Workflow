/**
 * Cron issue evaluation and filtering logic.
 *
 * Extracted from trigger_cron.ts so the logic is testable without triggering
 * the cron's module-level side effects (setInterval, process guard).
 *
 * Evaluates whether a given issue should be processed, and if so, determines
 * the action to take ('spawn' a new workflow or 'merge' an awaiting_merge PR).
 */

import { isActiveStage, isRetriableStage, resolveIssueWorkflowStage } from './cronStageResolver';
import type { StageResolution } from './cronStageResolver';

/** Minimal issue shape required for evaluation. */
export interface CronIssue {
  readonly number: number;
  readonly body?: string;
  readonly comments: { body: string }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Result of evaluating a single issue. */
export interface FilterResult {
  readonly eligible: boolean;
  readonly reason?: string;
  /** 'merge' for awaiting_merge issues; 'spawn' for all standard-eligible issues. */
  readonly action?: 'spawn' | 'merge';
  /** The adw-id associated with the issue (set for awaiting_merge issues). */
  readonly adwId?: string;
}

/** Eligible issue enriched with cron action metadata. */
export interface EligibleIssue {
  readonly issue: CronIssue;
  readonly action: 'spawn' | 'merge';
  readonly adwId?: string;
}

/**
 * Dedup signals split by event type. The cron tracks two distinct lifecycle
 * events per issue: spawning the SDLC workflow, and spawning the merge
 * orchestrator. Conflating them caused issues that this process originally
 * spawned to be invisible to the merge path once they reached `awaiting_merge`.
 */
export interface ProcessedSets {
  readonly spawns: ReadonlySet<number>;
  readonly merges: ReadonlySet<number>;
}

/**
 * Determines if an issue should be processed by the cron backlog sweeper.
 *
 * `awaiting_merge` bypasses the grace period entirely — the original orchestrator
 * has already exited and there is no race condition risk.
 *
 * Dedup is split: `processed.spawns` tracks issues whose SDLC workflow this
 * process has already spawned; `processed.merges` tracks issues whose merge
 * orchestrator this process has already spawned. The two events have different
 * lifecycles, so an issue in `spawns` may still be eligible for the merge path
 * once it transitions into `awaiting_merge`.
 *
 * @param issue                - The issue to evaluate
 * @param now                  - Current timestamp in ms
 * @param processed            - Sets of issue numbers already queued this cycle, split
 *                               by event type (spawns vs merges)
 * @param gracePeriodMs        - Minimum ms of inactivity before a fresh issue is eligible
 * @param resolveStage         - Injectable stage resolver (defaults to the real implementation)
 * @param cancelledThisCycle   - Issue numbers that were cancelled earlier in the current
 *                               cycle and must be skipped once; this set is not persisted
 *                               across cycles.
 */
export function evaluateIssue(
  issue: CronIssue,
  now: number,
  processed: ProcessedSets,
  gracePeriodMs: number,
  resolveStage: (comments: { body: string }[]) => StageResolution = resolveIssueWorkflowStage,
  cancelledThisCycle: ReadonlySet<number> = new Set(),
): FilterResult {
  if (cancelledThisCycle.has(issue.number)) {
    return { eligible: false, reason: 'cancelled' };
  }

  // Resolve stage first so we can dispatch to the right dedup set. The spawn
  // dedup must NOT short-circuit the awaiting_merge path: an issue this process
  // originally spawned legitimately re-enters the filter once it transitions
  // into awaiting_merge, and the merge orchestrator must be allowed to run.
  const resolution = resolveStage(issue.comments);

  // awaiting_merge bypasses grace period — spawn merge orchestrator immediately
  if (resolution.stage === 'awaiting_merge') {
    if (!resolution.adwId) {
      return { eligible: false, reason: 'awaiting_merge_no_adwid' };
    }
    if (processed.merges.has(issue.number)) {
      return { eligible: false, reason: 'processed' };
    }
    return { eligible: true, action: 'merge', adwId: resolution.adwId };
  }

  if (processed.spawns.has(issue.number)) {
    return { eligible: false, reason: 'processed' };
  }

  // Prefer state file phase timestamp; fall back to issue.updatedAt for fresh issues
  const activityMs = resolution.lastActivityMs ?? new Date(issue.updatedAt).getTime();
  if (now - activityMs < gracePeriodMs) {
    return { eligible: false, reason: 'grace_period' };
  }

  const { stage } = resolution;
  if (stage === null) {
    // No adw-id in comments, or no state file — fresh issue, eligible
    return { eligible: true, action: 'spawn' };
  }
  if (stage === 'completed') {
    return { eligible: false, reason: 'completed' };
  }
  // Paused workflows are handled exclusively by the pause queue scanner
  if (stage === 'paused') {
    return { eligible: false, reason: 'paused' };
  }
  if (isActiveStage(stage)) {
    return { eligible: false, reason: 'active' };
  }
  if (isRetriableStage(stage)) {
    return { eligible: true, action: 'spawn', adwId: resolution.adwId ?? undefined };
  }
  // Unknown stage — exclude
  return { eligible: false, reason: `adw_stage:${stage}` };
}

/**
 * Filters and sorts issues for backlog sweep processing.
 * Returns eligible issues (with action metadata) sorted oldest-first.
 * Builds an annotation list of excluded issues for verbose logging.
 */
export function filterEligibleIssues(
  issues: readonly CronIssue[],
  now: number,
  processed: ProcessedSets,
  gracePeriodMs: number,
  resolveStage?: (comments: { body: string }[]) => StageResolution,
  cancelledThisCycle: ReadonlySet<number> = new Set(),
): { eligible: EligibleIssue[]; filteredAnnotations: string[] } {
  const eligible: EligibleIssue[] = [];
  const filteredAnnotations: string[] = [];

  for (const issue of issues) {
    const result = evaluateIssue(issue, now, processed, gracePeriodMs, resolveStage, cancelledThisCycle);
    if (result.eligible) {
      eligible.push({
        issue,
        action: result.action ?? 'spawn',
        adwId: result.adwId,
      });
    } else {
      filteredAnnotations.push(`#${issue.number}(${result.reason})`);
    }
  }

  eligible.sort((a, b) => new Date(a.issue.createdAt).getTime() - new Date(b.issue.createdAt).getTime());
  return { eligible, filteredAnnotations };
}
