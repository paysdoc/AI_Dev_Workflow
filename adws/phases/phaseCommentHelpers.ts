/**
 * Shared helpers for posting workflow stage comments via RepoContext providers.
 *
 * These thin wrappers format a comment using the existing shared formatters
 * and post it through the platform-agnostic RepoContext interfaces, replacing
 * direct GitHub API calls in phase files.
 */

import { type WorkflowStage, type PRReviewWorkflowStage, log } from '../core';
import { formatWorkflowComment, type WorkflowContext } from '../forge/workflowCommentsIssue';
import { formatPRReviewWorkflowComment, type PRReviewWorkflowContext } from '../forge/workflowCommentsPR';
import type { RepoContext } from '../providers/types';

/**
 * Formats a denial-count notice for run reporting (issue #762): a bad deny
 * rule must read as "N denials", not masquerade as agent flakiness. Returns
 * `null` when `count` is 0 so a clean run adds no denial line to its
 * comment/summary — the signal stays a signal.
 */
export function formatDenialNotice(count: number): string | null {
  if (count <= 0) return null;
  const noun = count === 1 ? 'tool call was' : 'tool calls were';
  return `:warning: **${count} ${noun} denied** by ADW's guardrails during this run.`;
}

/**
 * Formats and posts an issue workflow comment via the RepoContext issue tracker.
 * Errors are caught and logged to prevent workflow crashes from comment failures.
 *
 * @param deniedToolCallCount - Optional per-run permission-denied tool-call count
 *   (issue #762). Appended as a denial notice when greater than 0; omitted otherwise.
 */
export function postIssueStageComment(
  repoContext: Pick<RepoContext, 'issueTracker'>,
  issueNumber: number,
  stage: WorkflowStage,
  ctx: WorkflowContext,
  deniedToolCallCount?: number,
): void {
  try {
    const comment = formatWorkflowComment(stage, ctx);
    const denialNotice = deniedToolCallCount !== undefined ? formatDenialNotice(deniedToolCallCount) : null;
    const fullComment = denialNotice ? `${comment}\n\n${denialNotice}` : comment;
    repoContext.issueTracker.commentOnIssue(issueNumber, fullComment);
  } catch (error) {
    log(`Failed to post workflow comment for stage '${stage}': ${error}`, 'error');
  }
}

/**
 * Formats and posts a PR review workflow comment via the RepoContext code host.
 * Errors are caught and logged to prevent workflow crashes from comment failures.
 *
 * @param deniedToolCallCount - Optional per-run permission-denied tool-call count
 *   (issue #762). Appended as a denial notice when greater than 0; omitted otherwise.
 */
export function postPRStageComment(
  repoContext: RepoContext,
  prNumber: number,
  stage: PRReviewWorkflowStage,
  ctx: PRReviewWorkflowContext,
  deniedToolCallCount?: number,
): void {
  try {
    const comment = formatPRReviewWorkflowComment(stage, ctx);
    const denialNotice = deniedToolCallCount !== undefined ? formatDenialNotice(deniedToolCallCount) : null;
    const fullComment = denialNotice ? `${comment}\n\n${denialNotice}` : comment;
    repoContext.codeHost.commentOnPullRequest(prNumber, fullComment);
  } catch (error) {
    log(`Failed to post PR workflow comment for stage '${stage}': ${error}`, 'error');
  }
}
