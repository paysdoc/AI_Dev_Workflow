/**
 * `Issue` gained `createdAt`/`url` in `adws/providers/types.ts` so the
 * port crossing is byte-stable for the four agents that read them
 * (`planAgent`/`scenarioAgent`'s `createdAt`, `buildAgent`'s `url`).
 */

import type { Issue, IssueTracker } from '@paysdoc/devplatform';

/**
 * No additional error wrap: the GitHub tracker already throws
 * `Failed to fetch issue #N: …`, and wrapping again would double the prefix.
 */
export async function fetchIssueRecord(issueTracker: Pick<IssueTracker, 'fetchIssue'>, issueNumber: number): Promise<Issue> {
  return issueTracker.fetchIssue(issueNumber);
}
