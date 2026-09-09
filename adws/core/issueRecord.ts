/**
 * The full forge-shaped issue record, read over the boundary's own
 * `GitContext` — the single GitHub-shaped read left in the framework (#820).
 *
 * `WorkflowConfig.issue` is a `GitHubIssue`, not the provider-neutral `Issue`:
 * it is `JSON.stringify`'d whole into the commit/PR/alignment/validation
 * agent prompts, and `planAgent.ts`/`scenarioAgent.ts`/`buildAgent.ts` print
 * `issue.state`, `issue.author.login`, `issue.createdAt` and `issue.url` —
 * none of which `IssueTracker.fetchIssue`'s `Issue` shape carries. Reading
 * through the port would silently change every byte those agents see, so
 * this helper reproduces the legacy `fetchGitHubIssue`'s exact command, parse
 * and error text over the ONE `GitContext` the launch boundary constructed,
 * rather than minting a fresh `gitContextForRepo(repoInfo)` per call.
 *
 * Promoting the record to a forge-neutral `IssueRecord` port type (and typing
 * the agents on it) is a separate, HITL-worthy design decision — not this
 * slice's call.
 *
 * `createGhRepoApi` is a bound view over an existing context, not a provider
 * or context constructor, so this file is outside the construction guard's
 * sanctioned-site allowlist entirely.
 */

import { createGhRepoApi } from '../providers/github/ghRepoApi';
import { parseGitHubIssue } from '../providers/github/ghIssueParsers';
import type { GitContext } from '../gitContext';
import type { GitHubIssue } from '../providers/github/domain/issue';

/** Reads issue #`issueNumber` over `ctx`; wraps any failure in the legacy `Failed to fetch issue #N: …` message. */
export async function fetchIssueRecord(ctx: GitContext, issueNumber: number): Promise<GitHubIssue> {
  try {
    return parseGitHubIssue(createGhRepoApi(ctx).fetchIssue(issueNumber));
  } catch (error) {
    throw new Error(`Failed to fetch issue #${issueNumber}: ${error}`);
  }
}
