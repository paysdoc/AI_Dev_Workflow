/**
 * Type mapping functions between GitHub-specific types and platform-agnostic provider types.
 *
 * These pure functions convert GitHub API response types (PRDetails, PRReviewComment, PRListItem)
 * to the platform-agnostic types (MergeRequest, ReviewComment) defined in the provider interfaces.
 */

import type { PRDetails, PRReviewComment, PRListItem } from '../../types/workflowTypes';
import type { MergeRequest, ReviewComment } from '../types';

/**
 * Maps a GitHub PRDetails object to a platform-agnostic MergeRequest.
 *
 * @param pr - The GitHub PR details to convert
 * @returns A platform-agnostic MergeRequest representation
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
 *
 * Handles type conversions:
 * - Numeric `id` is converted to string
 * - `author.login` is extracted to a flat string
 * - Empty `path` string is mapped to `undefined`
 * - `null` line is mapped to `undefined`
 *
 * @param comment - The GitHub PR review comment to convert
 * @returns A platform-agnostic ReviewComment representation
 */
export function mapPRReviewCommentToReviewComment(comment: PRReviewComment): ReviewComment {
  return {
    id: String(comment.id),
    author: comment.author.login,
    body: comment.body,
    createdAt: comment.createdAt,
    path: comment.path === '' ? undefined : comment.path,
    line: comment.line ?? undefined,
  };
}

/**
 * Maps a GitHub PRListItem to a platform-agnostic MergeRequest.
 *
 * Since PRListItem only contains `number` and `headBranch`, the remaining
 * MergeRequest fields are set to empty strings.
 *
 * @param item - The GitHub PR list item to convert
 * @returns A platform-agnostic MergeRequest with minimal fields populated
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
