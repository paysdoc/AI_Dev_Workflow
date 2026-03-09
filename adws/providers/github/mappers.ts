/**
 * Type mapping functions between GitHub-specific types and platform-agnostic provider types.
 * All functions are pure — no side effects, no imports of global state.
 */

import type { GitHubIssue, GitHubComment, IssueCommentSummary } from '../../types/issueTypes';
import type { WorkItem, WorkItemComment } from '../types';
import type { RepoInfo } from '../../github/githubApi';
import type { RepoIdentifier } from '../types';

/**
 * Maps a GitHubComment to a platform-agnostic WorkItemComment.
 */
export function mapGitHubCommentToWorkItemComment(comment: GitHubComment): WorkItemComment {
  return {
    id: comment.id,
    body: comment.body,
    author: comment.author.login,
    createdAt: comment.createdAt,
  };
}

/**
 * Maps a GitHubIssue to a platform-agnostic WorkItem.
 */
export function mapGitHubIssueToWorkItem(issue: GitHubIssue): WorkItem {
  return {
    id: issue.number.toString(),
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    author: issue.author.login,
    labels: issue.labels.map((l) => l.name),
    comments: issue.comments.map(mapGitHubCommentToWorkItemComment),
  };
}

/**
 * Maps an IssueCommentSummary (REST API format) to a platform-agnostic WorkItemComment.
 */
export function mapIssueCommentSummaryToWorkItemComment(comment: IssueCommentSummary): WorkItemComment {
  return {
    id: comment.id.toString(),
    body: comment.body,
    author: comment.authorLogin,
    createdAt: comment.createdAt,
  };
}

/**
 * Converts a provider RepoIdentifier to the RepoInfo format used by existing GitHub API functions.
 */
export function toRepoInfo(repoId: RepoIdentifier): RepoInfo {
  return { owner: repoId.owner, repo: repoId.repo };
}
