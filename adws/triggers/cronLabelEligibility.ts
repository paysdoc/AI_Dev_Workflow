/**
 * A truly-unlabeled issue (no adw:* label at all) is eligible with no
 * deterministic classification attached — the downstream spawn path LLM-
 * classifies it, exactly as the webhook opened-path and comment-path do.
 * Only a reserved, non-classification adw:* label (adw:upgrade /
 * adw:blocked / adw:unverified) is filtered: it reads as classification ===
 * null too, but must stay out of the standard spawn loop (upgradeRedrive.ts
 * depends on adw:upgrade issues never appearing here).
 */

import { readAdwLabelNames } from '../core/adwLabels';
import type { AdwLabelReading } from '../core/adwLabels';
import { isAdwComment } from '../core';
import { hasLinkedMergedOrClosedPR } from '../forge/linkedPrDetector';
import type { LinkedPRRef } from '../forge/linkedPrDetector';

export type LabelRecoveryReason =
  | 'opt_out'
  | 'multi_label'
  | 'reserved_label'
  | 'in_progress_comment'
  | 'linked_closed_pr';

export interface LabelRecoveryResult {
  readonly eligible: boolean;
  readonly reason?: LabelRecoveryReason;
  /** When eligible, the adw:<type> classification slash command. */
  readonly classification?: string;
}

export interface LabelRecoveryIssue {
  readonly number: number;
  readonly labels: readonly { name: string }[];
  readonly comments: readonly { body: string }[];
}

/**
 * Guard clauses in strict precedence order:
 *   opt_out → multi_label → reserved_label (non-classification adw:* label)
 *     → in_progress_comment → linked_closed_pr → eligible
 */
export function decideLabelRecovery(
  reading: AdwLabelReading,
  hasInProgressComment: boolean,
  hasLinkedClosedPR: boolean,
  hasAdwLabel: boolean,
): LabelRecoveryResult {
  if (reading.optOut) return { eligible: false, reason: 'opt_out' };
  if (reading.conflict) return { eligible: false, reason: 'multi_label' };
  if (reading.classification === null && hasAdwLabel) return { eligible: false, reason: 'reserved_label' };
  if (hasInProgressComment) return { eligible: false, reason: 'in_progress_comment' };
  if (hasLinkedClosedPR) return { eligible: false, reason: 'linked_closed_pr' };
  return { eligible: true, classification: reading.classification ?? undefined };
}

export function evaluateLabelRecovery(
  issue: LabelRecoveryIssue,
  linkedPrs: readonly LinkedPRRef[],
): LabelRecoveryResult {
  const names = issue.labels.map((l) => l.name);
  const reading = readAdwLabelNames(names);
  const hasAdwLabel = names.some((n) => n.startsWith('adw:'));
  const hasInProgressComment = issue.comments.some((c) => isAdwComment(c.body));
  const hasLinkedClosedPR = hasLinkedMergedOrClosedPR(issue.number, linkedPrs);
  return decideLabelRecovery(reading, hasInProgressComment, hasLinkedClosedPR, hasAdwLabel);
}
