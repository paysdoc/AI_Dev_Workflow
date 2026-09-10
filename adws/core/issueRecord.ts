/**
 * The workflow's issue record — the port's `Issue`, read through the launch
 * boundary's `IssueTracker` (#844). Before #844 this was a bound
 * `createGhRepoApi(ctx).fetchIssue` + `parseGitHubIssue` reproduction of the
 * legacy GitHub-shaped record; the GitHub-shaped record is gone as of this
 * issue. `Issue` gained `createdAt`/`url` in `adws/providers/types.ts` so the
 * port crossing is byte-stable for the four agents that read them
 * (`planAgent`/`scenarioAgent`'s `createdAt`, `buildAgent`'s `url`).
 *
 * Callers receive the tracker through the launch boundary's `BoundProviders`
 * — this helper constructs nothing.
 */

import type { Issue, IssueTracker } from '../providers/types';

/**
 * Delegates to `issueTracker.fetchIssue(issueNumber)` and returns its `Issue`
 * untouched. No additional error wrap: the GitHub tracker already throws
 * `Failed to fetch issue #N: …`, and wrapping again would double the prefix.
 */
export async function fetchIssueRecord(issueTracker: Pick<IssueTracker, 'fetchIssue'>, issueNumber: number): Promise<Issue> {
  return issueTracker.fetchIssue(issueNumber);
}
