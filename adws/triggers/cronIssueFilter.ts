/**
 * Cron issue evaluation and filtering logic.
 *
 * Extracted from trigger_cron.ts so the logic is testable without triggering
 * the cron's module-level side effects (setInterval, process guard).
 *
 * Evaluates whether a given issue should be processed, and if so, determines
 * the action to take ('spawn' a new workflow or 'merge' an awaiting_merge PR).
 */

import { resolveIssueWorkflowStage } from './cronStageResolver';
import { classifyStageString } from '../core/stageClassifier';
import { decideSerialization, parseRelevantFilesSection } from './regionOverlap';
import type { StageResolution } from './cronStageResolver';
import type { LabelRecoveryResult } from './cronLabelEligibility';

/** Minimal issue shape required for evaluation. */
export interface CronIssue {
  readonly number: number;
  readonly body?: string;
  readonly comments: { body: string }[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly labels: readonly { name: string }[];
  readonly title?: string;
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

/** An issue deferred by the region-overlap serialization gate. */
export interface OverlapDeferral {
  readonly issueNumber: number;
  readonly blockedBy: number;
  readonly overlapPaths: string[];
}

/**
 * Dedup signals for the cron. Tracks which issues have had their SDLC workflow
 * spawned by this process. The merge path uses the spawn lock on disk
 * (via `shouldDispatchMerge`) rather than an in-memory set.
 */
export interface ProcessedSets {
  readonly spawns: ReadonlySet<number>;
}

/**
 * Determines if an issue should be processed by the cron backlog sweeper.
 *
 * `awaiting_merge` bypasses the grace period entirely — the original orchestrator
 * has already exited and there is no race condition risk.
 *
 * `processed.spawns` tracks issues whose SDLC workflow this process has already
 * spawned. The merge path uses the spawn lock on disk (via `shouldDispatchMerge`)
 * so an issue in `spawns` may still be eligible for the merge path once it
 * transitions into `awaiting_merge`.
 *
 * @param issue                - The issue to evaluate
 * @param now                  - Current timestamp in ms
 * @param processed            - Set of issue numbers already spawned this cycle
 * @param gracePeriodMs        - Minimum ms of inactivity before a fresh issue is eligible
 * @param resolveStage         - Injectable stage resolver (defaults to the real implementation)
 * @param cancelledThisCycle   - Issue numbers that were cancelled earlier in the current
 *                               cycle and must be skipped once; this set is not persisted
 *                               across cycles.
 * @param labelRecovery        - Optional label-eligibility evaluator. Applied only on the
 *                               truly-fresh path (stage === null && adwId === null). When
 *                               omitted, legacy behaviour is preserved.
 */
export function evaluateIssue(
  issue: CronIssue,
  now: number,
  processed: ProcessedSets,
  gracePeriodMs: number,
  resolveStage: (comments: { body: string }[]) => StageResolution = resolveIssueWorkflowStage,
  cancelledThisCycle: ReadonlySet<number> = new Set(),
  labelRecovery?: (issue: CronIssue) => LabelRecoveryResult,
): FilterResult {
  if (cancelledThisCycle.has(issue.number)) {
    return { eligible: false, reason: 'cancelled' };
  }

  // Resolve stage first so we can dispatch to the right dedup set. The spawn
  // dedup must NOT short-circuit the awaiting_merge path: an issue this process
  // originally spawned legitimately re-enters the filter once it transitions
  // into awaiting_merge, and the merge orchestrator must be allowed to run.
  const resolution = resolveStage(issue.comments);

  // awaiting_merge bypasses grace period — spawn merge orchestrator immediately.
  // Dedup is handled by shouldDispatchMerge (spawn lock on disk), not an in-memory set.
  if (resolution.stage === 'awaiting_merge') {
    if (!resolution.adwId) {
      return { eligible: false, reason: 'awaiting_merge_no_adwid' };
    }
    return { eligible: true, action: 'merge', adwId: resolution.adwId };
  }

  // discarded bypasses grace period — this is a deliberate terminal decision,
  // never re-spawn regardless of how recent the last activity was.
  if (resolution.stage === 'discarded') {
    return { eligible: false, reason: 'discarded' };
  }

  // merge_blocked bypasses grace period — escalated merge awaiting an explicit
  // human `## Retry`. Never auto-spawned; recovery resets it to awaiting_merge.
  if (resolution.stage === 'merge_blocked') {
    return { eligible: false, reason: 'merge_blocked' };
  }

  // human_gated bypasses grace period — escalated resume awaiting an explicit
  // human `## Retry`. Never auto-spawned; recovery re-arms it to phase_timeout.
  if (resolution.stage === 'human_gated') {
    return { eligible: false, reason: 'human_gated' };
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
    // Apply the label-recovery gate only when this is truly fresh (no prior adwId)
    // and an evaluator has been injected. Issues with a non-null adwId bypass the gate
    // and reach the existing takeover machinery (evaluated by evaluateCandidate).
    if (resolution.adwId === null && labelRecovery) {
      const labelResult = labelRecovery(issue);
      if (!labelResult.eligible) {
        return { eligible: false, reason: `label:${labelResult.reason}` };
      }
    }
    return { eligible: true, action: 'spawn' };
  }
  if (stage === 'completed') {
    return { eligible: false, reason: 'completed' };
  }
  // Paused workflows are handled exclusively by the pause queue scanner
  if (stage === 'paused') {
    return { eligible: false, reason: 'paused' };
  }
  if (classifyStageString(stage) === 'active') {
    return { eligible: false, reason: 'active' };
  }
  if (classifyStageString(stage) === 'retriable') {
    return { eligible: true, action: 'spawn', adwId: resolution.adwId ?? undefined };
  }
  // phase_timeout: a watchdog-killed workflow whose orchestrator exited. Make it
  // eligible so trigger_cron routes it through evaluateCandidate (takeover), which
  // recovers it via reset-from-remote. Without this it falls through to the
  // unknown-stage exclusion below and strands forever (issue #637).
  if (stage === 'phase_timeout') {
    return { eligible: true, action: 'spawn', adwId: resolution.adwId ?? undefined };
  }
  // Unknown stage — exclude
  return { eligible: false, reason: `adw_stage:${stage}` };
}

/**
 * Production touched-files resolver: derives an issue's touched paths from its
 * body's `## Touched Files` / `## Relevant Files` section. Deterministic, no I/O.
 * It is the default `resolveTouchedFiles` for `filterEligibleIssues`, so the
 * region-overlap pass runs in the live cron and cannot be silently dropped at a
 * call site. Tests may inject a different resolver to drive the pass directly.
 */
export function resolveTouchedFilesFromBody(issue: CronIssue): string[] {
  return parseRelevantFilesSection(issue.body ?? '');
}

/**
 * Filters and sorts issues for backlog sweep processing.
 * Returns eligible issues (with action metadata) sorted oldest-first.
 * Builds an annotation list of excluded issues for verbose logging.
 *
 * A cross-issue region-overlap pass is applied to the eligible spawn candidates
 * after per-issue filtering. `resolveTouchedFiles` defaults to
 * `resolveTouchedFilesFromBody` (issue-body section parse), so the pass runs by
 * default in the live cron. Overlapping pairs are serialized: the lower-numbered
 * issue in each cluster proceeds; others are deferred and recorded in
 * `overlapDeferrals`. Tests may inject a different resolver to drive the pass
 * directly without requiring a formatted issue body.
 */
export function filterEligibleIssues(
  issues: readonly CronIssue[],
  now: number,
  processed: ProcessedSets,
  gracePeriodMs: number,
  resolveStage?: (comments: { body: string }[]) => StageResolution,
  cancelledThisCycle: ReadonlySet<number> = new Set(),
  labelRecovery?: (issue: CronIssue) => LabelRecoveryResult,
  resolveTouchedFiles: (issue: CronIssue) => string[] = resolveTouchedFilesFromBody,
): { eligible: EligibleIssue[]; filteredAnnotations: string[]; overlapDeferrals: OverlapDeferral[] } {
  const initialEligible: EligibleIssue[] = [];
  const filteredAnnotations: string[] = [];

  for (const issue of issues) {
    const result = evaluateIssue(issue, now, processed, gracePeriodMs, resolveStage, cancelledThisCycle, labelRecovery);
    if (result.eligible) {
      initialEligible.push({
        issue,
        action: result.action ?? 'spawn',
        adwId: result.adwId,
      });
    } else {
      filteredAnnotations.push(`#${issue.number}(${result.reason})`);
    }
  }

  initialEligible.sort((a, b) => new Date(a.issue.createdAt).getTime() - new Date(b.issue.createdAt).getTime());

  // Region-overlap serialization pass over spawn-eligible candidates.
  const spawnCandidates = initialEligible.filter(e => e.action === 'spawn');
  if (spawnCandidates.length < 2) {
    return { eligible: initialEligible, filteredAnnotations, overlapDeferrals: [] };
  }
  const signals = spawnCandidates.map(e => ({
    issueNumber: e.issue.number,
    paths: resolveTouchedFiles(e.issue),
    inFlight: false,
  }));

  const overlapDeferrals: OverlapDeferral[] = [];
  const deferredNumbers = new Set<number>();

  for (const signal of signals) {
    const siblings = signals.filter(s => s.issueNumber !== signal.issueNumber);
    const decision = decideSerialization(signal, siblings);
    if (decision.serialize && decision.blockedBy !== undefined) {
      deferredNumbers.add(signal.issueNumber);
      overlapDeferrals.push({
        issueNumber: signal.issueNumber,
        blockedBy: decision.blockedBy,
        overlapPaths: decision.overlapPaths ?? [],
      });
      filteredAnnotations.push(`#${signal.issueNumber}(region_overlap:#${decision.blockedBy})`);
    }
  }

  const eligible = initialEligible.filter(e => !deferredNumbers.has(e.issue.number));
  return { eligible, filteredAnnotations, overlapDeferrals };
}
