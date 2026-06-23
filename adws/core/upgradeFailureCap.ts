/**
 * Pure helpers for counting bot-authored upgrade-failure comments on a tracking issue.
 * No I/O — all logic is deterministic and unit-testable in isolation.
 */

/** First line of the comment buildUpgradeFailureComment emits. Used as the failure signature. */
export const UPGRADE_FAILURE_SIGNATURE = 'ADW upgrade regeneration failed.';

/** Minimal comment record shape needed by the cap helpers. */
export interface IssueCommentRecord {
  readonly body: string;
  readonly author: string;
}

/**
 * Returns true iff the comment was bot-authored (author ends with `[bot]`) and
 * its body begins with UPGRADE_FAILURE_SIGNATURE.
 *
 * Deliberately excludes HITL-deferred (`buildUpgradeHitlComment`), merge-failed
 * (`buildUpgradeMergeFailedComment`), escalation comments (different first line),
 * and any human-authored comment.
 */
export function isUpgradeFailureComment(body: string, author: string): boolean {
  return author.endsWith('[bot]') && body.startsWith(UPGRADE_FAILURE_SIGNATURE);
}

/**
 * Counts how many comments in `comments` are bot-authored upgrade-failure comments.
 */
export function countUpgradeFailureComments(comments: readonly IssueCommentRecord[]): number {
  return comments.filter(c => isUpgradeFailureComment(c.body, c.author)).length;
}
