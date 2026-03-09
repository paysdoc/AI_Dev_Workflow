/**
 * Pure mapper functions that convert between GitHub-specific types and
 * platform-agnostic provider types.
 */

import type { PRDetails, PRReviewComment, PRListItem } from '../../types/workflowTypes';
import type { MergeRequest, ReviewComment } from '../types';

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
