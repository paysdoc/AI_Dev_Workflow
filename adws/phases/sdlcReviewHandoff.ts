/**
 * Extracted from adwSdlc.tsx main() so the BDD §2 scenario can phase-import
 * and drive the outcome in isolation over a mocked WorkflowConfig, without
 * spawning a full orchestrator subprocess.
 */

import { AgentStateManager, log } from '../core';
import { postIssueStageComment } from './phaseCommentHelpers';
import type { WorkflowContext } from '../forge/workflowCommentsIssue';
import type { RepoContext } from '@paysdoc/devplatform';

export interface SdlcReviewFailedConfig {
  adwId: string;
  issueNumber: number;
  repoContext?: RepoContext;
  ctx: WorkflowContext;
}

/**
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
