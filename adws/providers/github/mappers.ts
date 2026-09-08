/**
 * Pure mapper functions that convert between GitHub-specific types and
 * platform-agnostic provider types.
 * All functions are pure — no side effects, no imports of global state.
 */

import type { GitHubIssue, GitHubComment, IssueCommentSummary } from './domain/issue';
import type { PRDetails, PRReviewComment, PRListItem, RawPR } from './domain/pullRequest';
import type { Issue, IssueComment, PullRequest, PullRequestSummary, ReviewComment } from '../types';

// ── IssueTracker mappers ──────────────────────────────────────────────

/**
 * Maps a GitHubComment to a platform-agnostic IssueComment.
 */
export function mapGitHubCommentToIssueComment(comment: GitHubComment): IssueComment {
  return {
    id: comment.id,
    body: comment.body,
    author: comment.author.login,
    createdAt: comment.createdAt,
  };
}

/**
 * Maps a GitHubIssue to a platform-agnostic Issue.
 */
export function mapGitHubIssueToIssue(issue: GitHubIssue): Issue {
  return {
    id: issue.number.toString(),
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    author: issue.author.login,
    labels: issue.labels.map((l) => l.name),
    comments: issue.comments.map(mapGitHubCommentToIssueComment),
  };
}

/**
 * Maps an IssueCommentSummary (REST API format) to a platform-agnostic IssueComment.
 */
export function mapIssueCommentSummaryToIssueComment(comment: IssueCommentSummary): IssueComment {
  return {
    id: comment.id.toString(),
    body: comment.body,
    author: comment.authorLogin,
    createdAt: comment.createdAt,
  };
}

// ── CodeHost mappers ──────────────────────────────────────────────────

/**
 * Maps a GitHub PRDetails object to a platform-agnostic PullRequest.
 */
export function mapPRDetailsToPullRequest(pr: PRDetails): PullRequest {
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
 * Maps a GitHub PRListItem to a platform-agnostic PullRequest.
 * PRListItem carries only number and headBranch, so remaining fields are empty strings.
 */
export function mapPRListItemToPullRequest(item: PRListItem): PullRequest {
  return {
    number: item.number,
    title: '',
    body: '',
    sourceBranch: item.headBranch,
    targetBranch: '',
    url: '',
  };
}

/**
 * Maps a RawPR (from `defaultFindPRByBranch`) to a platform-agnostic PullRequestSummary.
 * Flattens `labels?: {name}[]` to `string[]`, defaulting a missing field to `[]`.
 */
export function mapRawPRToSummary(pr: RawPR): PullRequestSummary {
  return {
    number: pr.number,
    state: pr.state,
    sourceBranch: pr.headRefName,
    targetBranch: pr.baseRefName,
    labels: (pr.labels ?? []).map((l) => l.name),
  };
}
