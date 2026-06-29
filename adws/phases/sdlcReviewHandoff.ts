/**
 * SDLC review-failure handoff.
 *
 * Extracted from adwSdlc.tsx main() so the BDD §2 scenario can phase-import
 * and drive the outcome in isolation over a mocked WorkflowConfig, without
 * spawning a full orchestrator subprocess.
 *
 * Mirrors the completePRReviewWorkflow pattern from prReviewCompletion.ts.
 */

import { AgentStateManager, log } from '../core';
import { postIssueStageComment } from './phaseCommentHelpers';
import type { WorkflowContext } from '../github/workflowCommentsIssue';
import type { RepoContext } from '../providers/types';

export interface SdlcReviewFailedConfig {
  adwId: string;
  issueNumber: number;
  repoContext?: RepoContext;
  ctx: WorkflowContext;
}

/**
 * Writes the `review_failed` terminal state and posts the branch-pointing
 * issue comment that tells the operator to push a fix and post `## Retry`.
 *
 * Called by adwSdlc.tsx when decidePostReviewOutcome returns skipDocAndPR:true.
 * The orchestrator persists its own cost/metadata separately.
 */
export function executeSdlcReviewFailedHandoff(config: SdlcReviewFailedConfig): void {
  AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'review_failed' });
  if (config.repoContext) {
    postIssueStageComment(config.repoContext, config.issueNumber, 'review_failed', config.ctx);
  }
  log('===================================', 'warn');
  log('Review exhausted — stage set to review_failed (no PR created). Post ## Retry after fixing.', 'warn');
  if (config.ctx.branchName) log(`Branch: ${config.ctx.branchName}`, 'info');
  log('===================================', 'warn');
}
