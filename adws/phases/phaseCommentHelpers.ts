/**
 * Shared helpers for posting workflow stage comments via RepoContext providers.
 *
 * These thin wrappers format a comment using the existing shared formatters
 * and post it through the platform-agnostic RepoContext interfaces, replacing
 * direct GitHub API calls in phase files.
 */

import { type WorkflowStage, type PRReviewWorkflowStage, log } from '../core';
import { formatWorkflowComment, type WorkflowContext } from '../github/workflowCommentsIssue';
import { formatPRReviewWorkflowComment, type PRReviewWorkflowContext } from '../github/workflowCommentsPR';
import type { RepoContext } from '../providers/types';

/**
 * Formats and posts an issue workflow comment via the RepoContext issue tracker.
 * Errors are caught and logged to prevent workflow crashes from comment failures.
 */
export function postIssueStageComment(
  repoContext: RepoContext,
  issueNumber: number,
  stage: WorkflowStage,
  ctx: WorkflowContext,
): void {
  try {
    const comment = formatWorkflowComment(stage, ctx);
    repoContext.issueTracker.commentOnIssue(issueNumber, comment);
  } catch (error) {
    log(`Failed to post workflow comment for stage '${stage}': ${error}`, 'error');
  }
}

/**
 * Formats and posts a PR review workflow comment via the RepoContext code host.
 * Errors are caught and logged to prevent workflow crashes from comment failures.
 */
export function postPRStageComment(
  repoContext: RepoContext,
  prNumber: number,
  stage: PRReviewWorkflowStage,
  ctx: PRReviewWorkflowContext,
): void {
  try {
    const comment = formatPRReviewWorkflowComment(stage, ctx);
    repoContext.codeHost.commentOnMergeRequest(prNumber, comment);
  } catch (error) {
    log(`Failed to post PR workflow comment for stage '${stage}': ${error}`, 'error');
  }
}
