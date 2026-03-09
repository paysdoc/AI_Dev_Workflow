/**
 * Pure mapper functions that convert between GitHub-specific types and
 * platform-agnostic provider types.
 * All functions are pure — no side effects, no imports of global state.
 */

import type { GitHubIssue, GitHubComment, IssueCommentSummary } from '../../types/issueTypes';
import type { PRDetails, PRReviewComment, PRListItem } from '../../types/workflowTypes';
import type { WorkItem, WorkItemComment, MergeRequest, ReviewComment, RepoIdentifier } from '../types';
import type { RepoInfo } from '../../github/githubApi';

// ── IssueTracker mappers ──────────────────────────────────────────────

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

// ── CodeHost mappers ──────────────────────────────────────────────────

/**
 * Maps a GitHub PRDetails object to a platform-agnostic MergeRequest.
 */
export function mapPRDetailsToMergeRequest(pr: PRDetails): MergeRequest {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    sourceBranch: pr.headBranch,
    targetBranch: pr.baseBranch,
    url: pr.url,
    linkedIssueNumber: pr.issueNumber ?? undefined,
  };
}

/**
 * Maps a GitHub PRReviewComment to a platform-agnostic ReviewComment.
 */
export function mapPRReviewCommentToReviewComment(comment: PRReviewComment): ReviewComment {
  return {
    id: String(comment.id),
    body: comment.body,
    author: comment.author.login,
    createdAt: comment.createdAt,
    path: comment.path || undefined,
    line: comment.line ?? undefined,
  };
}

/**
 * Maps a GitHub PRListItem to a platform-agnostic MergeRequest.
 * PRListItem carries only number and headBranch, so remaining fields are empty strings.
 */
export function mapPRListItemToMergeRequest(item: PRListItem): MergeRequest {
  return {
    number: item.number,
    title: '',
    body: '',
    sourceBranch: item.headBranch,
    targetBranch: '',
    url: '',
  };
}
