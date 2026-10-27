import type { LocalMergeCheck, MergeOutcome } from '../triggers/autoMergeHandler';

const LAST_ERROR_MAX_CHARS = 500;

export function buildMergeBlockedComment(cause: string, adwId: string): string {
  return [
    '## ADW Merge Blocked',
    '',
    `**Cause:** ${cause}`,
    '',
    '**Remedy:** Resolve the issue above, then comment `## Retry` on this issue. ADW will reset to `awaiting_merge` and re-attempt the merge on the next cron tick.',
    '',
    `**ADW ID:** \`${adwId}\``,
  ].join('\n');
}

/** What the merge loop did and saw, one fact to a line, for the comment that tells a human why the merge was blocked. */
export function buildMergeFailureCause(prNumber: number, baseBranch: string, outcome: MergeOutcome): string {
  const localMergeCheckSummary: Record<LocalMergeCheck, string> = {
    clean: `clean against \`origin/${baseBranch}\` — the forge's merge errors were treated as stale mergeability and retried with backoff`,
    conflicts: `found conflicts with \`origin/${baseBranch}\``,
    unavailable: `could not run (fetching \`origin/${baseBranch}\` failed)`,
  };
  const lines = [
    `Automated merge of PR #${prNumber} failed.`,
    '',
    `- Merge attempts: ${outcome.mergeAttempts}`,
    `- Conflict resolution: ${outcome.conflictResolutionRan ? 'ran' : 'did not run'}`,
    `- Local merge check: ${localMergeCheckSummary[outcome.localMergeCheck]}`,
  ];
  if (outcome.error) lines.push(`- Last error: ${outcome.error.substring(0, LAST_ERROR_MAX_CHARS)}`);
  return lines.join('\n');
}
