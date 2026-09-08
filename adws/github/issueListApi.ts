/**
 * Issue-listing wrapper — the one shared implementation behind
 * `IssueTracker.listIssues` and every `repoInfo`-only trigger helper that
 * used to list issues straight off a `GitContext`. Split out of `issueApi.ts`
 * (359 lines, must not grow) rather than added there.
 */

import type { IssueListQuery, IssueListEntry, RepoIdentifier } from '../providers/types';
import { gitContextForRepo } from './gitContextFactory';
import { createGhRepoApi } from '../providers/github/ghRepoApi';

/** Issues matching `query`; throws on failure — callers own the swallow policy. */
export function listIssues(query: IssueListQuery, repoInfo: RepoIdentifier): IssueListEntry[] {
  const json = createGhRepoApi(gitContextForRepo(repoInfo)).listOpenIssues(query);
  return JSON.parse(json) as IssueListEntry[];
}

/**
 * `{ body }[]` of an issue's comments via `gh issue view --json comments`
 * (the stage/adwId readers' exact command); throws on failure.
 */
export function fetchIssueCommentBodies(issueNumber: number, repoInfo: RepoIdentifier): { body: string }[] {
  const json = createGhRepoApi(gitContextForRepo(repoInfo)).issueComments(issueNumber);
  return JSON.parse(json) as { body: string }[];
}
