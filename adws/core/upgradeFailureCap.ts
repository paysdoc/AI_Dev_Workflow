/** First line of the comment buildUpgradeFailureComment emits. */
export const UPGRADE_FAILURE_SIGNATURE = 'ADW upgrade regeneration failed.';

export interface IssueCommentRecord {
  readonly body: string;
  readonly author: string;
}

/**
 * Deliberately excludes HITL-deferred (`buildUpgradeHitlComment`), merge-failed
 * (`buildUpgradeMergeFailedComment`), escalation comments (different first line),
 * and any human-authored comment.
 */
export function isUpgradeFailureComment(body: string, author: string): boolean {
  return author.endsWith('[bot]') && body.startsWith(UPGRADE_FAILURE_SIGNATURE);
}

export function countUpgradeFailureComments(comments: readonly IssueCommentRecord[]): number {
  return comments.filter(c => isUpgradeFailureComment(c.body, c.author)).length;
}
