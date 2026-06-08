/**
 * Pure label-recovery decision module for the CRON backlog sweeper.
 *
 * Determines whether a fresh (no-ADW-state) issue should be spawned based on
 * its adw:* labels, in-progress comment presence, and linked PR status.
 * Mirrors the pure-decision + DI pattern of issueOpenedRouter.ts.
 */

import { readAdwLabelNames } from '../github/labelManager';
import type { AdwLabelReading } from '../github/labelManager';
import { isAdwComment } from '../core';
import { hasLinkedMergedOrClosedPR } from '../github/linkedPrDetector';
import type { LinkedPRRef } from '../github/linkedPrDetector';

// ── Result types ──────────────────────────────────────────────────────────────

export type LabelRecoveryReason =
  | 'opt_out'
  | 'multi_label'
  | 'no_adw_label'
  | 'in_progress_comment'
  | 'linked_closed_pr';

export interface LabelRecoveryResult {
  readonly eligible: boolean;
  readonly reason?: LabelRecoveryReason;
  /** When eligible, the adw:<type> classification slash command. */
  readonly classification?: string;
}

// ── Input shape ───────────────────────────────────────────────────────────────

export interface LabelRecoveryIssue {
  readonly number: number;
  readonly labels: readonly { name: string }[];
  readonly comments: readonly { body: string }[];
}

// ── Pure decision ─────────────────────────────────────────────────────────────

/**
 * Pure eligibility decision from pre-computed signals.
 * Guard clauses in strict precedence order:
 *   opt_out → multi_label → no_adw_label → in_progress_comment → linked_closed_pr → eligible
 */
export function decideLabelRecovery(
  reading: AdwLabelReading,
  hasInProgressComment: boolean,
  hasLinkedClosedPR: boolean,
): LabelRecoveryResult {
  if (reading.optOut) return { eligible: false, reason: 'opt_out' };
  if (reading.conflict) return { eligible: false, reason: 'multi_label' };
  if (reading.classification === null) return { eligible: false, reason: 'no_adw_label' };
  if (hasInProgressComment) return { eligible: false, reason: 'in_progress_comment' };
  if (hasLinkedClosedPR) return { eligible: false, reason: 'linked_closed_pr' };
  return { eligible: true, classification: reading.classification };
}

// ── Composing evaluator ───────────────────────────────────────────────────────

/**
 * Derives the three eligibility signals from a real issue + the cycle's PR list,
 * then delegates to `decideLabelRecovery`.
 */
export function evaluateLabelRecovery(
  issue: LabelRecoveryIssue,
  linkedPrs: readonly LinkedPRRef[],
): LabelRecoveryResult {
  const reading = readAdwLabelNames(issue.labels.map((l) => l.name));
  const hasInProgressComment = issue.comments.some((c) => isAdwComment(c.body));
  const hasLinkedClosedPR = hasLinkedMergedOrClosedPR(issue.number, linkedPrs);
  return decideLabelRecovery(reading, hasInProgressComment, hasLinkedClosedPR);
}
