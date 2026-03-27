/**
 * Pure mapper functions that convert between GitLab-specific types and
 * platform-agnostic provider types.
 * All functions are pure — no side effects, no imports of global state.
 */

import type { PullRequest, ReviewComment, RepoIdentifier } from '../types';
import type { GitLabMergeRequest, GitLabNote, GitLabDiscussion } from './gitlabTypes';

/**
 * Extracts the first linked issue number from a merge request description.
 * Looks for patterns like `Closes #42`, `Fixes #7`, or standalone `#123`.
 */
function extractLinkedIssueNumber(description: string): number | undefined {
  const closesMatch = description.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
  if (closesMatch) {
    return parseInt(closesMatch[1], 10);
  }

  const hashMatch = description.match(/#(\d+)/);
  if (hashMatch) {
    return parseInt(hashMatch[1], 10);
  }

  return undefined;
}

/**
 * Maps a GitLab MergeRequest API response to a platform-agnostic PullRequest.
 * Uses `iid` (project-scoped ID) as the `number` field.
 */
export function mapGitLabMRToPullRequest(mr: GitLabMergeRequest): PullRequest {
  return {
    number: mr.iid,
    title: mr.title,
    body: mr.description,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch,
    url: mr.web_url,
    linkedIssueNumber: mr.description ? extractLinkedIssueNumber(mr.description) : undefined,
  };
}

/**
 * Maps a GitLab Note to a platform-agnostic ReviewComment.
 */
export function mapGitLabNoteToReviewComment(note: GitLabNote): ReviewComment {
  return {
    id: String(note.id),
    body: note.body,
    author: note.author.username,
    createdAt: note.created_at,
    path: note.position?.new_path ?? undefined,
    line: note.position?.new_line ?? undefined,
  };
}

/**
 * Flattens GitLab discussions into a flat array of ReviewComments.
 * Includes both positioned (inline) and non-positioned (general) notes.
 */
export function mapGitLabDiscussionsToReviewComments(
  discussions: readonly GitLabDiscussion[],
): ReviewComment[] {
  return discussions.flatMap((discussion) =>
    discussion.notes.map(mapGitLabNoteToReviewComment),
  );
}

/**
 * Converts a RepoIdentifier to a GitLab project path (owner/repo).
 */
export function toProjectPath(repoId: RepoIdentifier): string {
  return `${repoId.owner}/${repoId.repo}`;
}
