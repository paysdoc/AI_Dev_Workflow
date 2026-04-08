/**
 * PR review workflow completion and error handling.
 *
 * Contains only terminal-state handlers: building cost section, writing final
 * orchestrator state, posting completion comments, and error handling.
 */

import { log, AgentStateManager, COST_REPORT_CURRENCIES, type ModelUsageMap, buildCostBreakdown, persistTokenCounts } from '../core';
import { createPhaseCostRecords, PhaseCostStatus } from '../cost';
import { formatCostCommentSection } from '../cost/reporting/commentFormatter';
import { BoardStatus } from '../providers/types';
import { postPRStageComment } from './phaseCommentHelpers';
import type { PRReviewWorkflowConfig } from './prReviewPhase';

async function buildPRReviewCostSection(config: PRReviewWorkflowConfig, modelUsage: ModelUsageMap): Promise<void> {
  const { ctx } = config;

  // Keep legacy costBreakdown for backward compatibility
  const costBreakdown = await buildCostBreakdown(modelUsage, [...COST_REPORT_CURRENCIES]);
  ctx.costBreakdown = costBreakdown;

  // Pre-compute cost section for the GitHub comment using per-phase modelUsage totals.
  // D1 posting is now handled per-phase by runPhase via tracker.commit().
  try {
    const phaseCostRecords = createPhaseCostRecords({
      workflowId: config.base.adwId,
      issueNumber: config.base.issueNumber,
      phase: 'pr_review',
      status: PhaseCostStatus.Success,
      retryCount: 0,
      contextResetCount: 0,
      durationMs: 0,
      modelUsage,
    });
    ctx.phaseCostRecords = phaseCostRecords;
    ctx.costSection = await formatCostCommentSection(phaseCostRecords);
  } catch (costError) {
    log(`Failed to build cost section: ${costError}`, 'error');
  }
}

/**
 * Completes the PR review workflow: builds cost section, writes final state,
 * posts completion comment, moves board status, and logs banner.
 * Terminal handler only — commit+push is handled by executePRReviewCommitPushPhase.
 */
export async function completePRReviewWorkflow(config: PRReviewWorkflowConfig, modelUsage?: ModelUsageMap): Promise<void> {
  const { prNumber, prDetails, unaddressedComments, ctx } = config;
  const { orchestratorStatePath, repoContext } = config.base;

  // Build cost section for GitHub comment and write new-format CSV
  if (modelUsage && Object.keys(modelUsage).length > 0) {
    await buildPRReviewCostSection(config, modelUsage);
  }

  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_completed', ctx);
    if (config.base.issueNumber) {
      await repoContext.issueTracker.moveToStatus(config.base.issueNumber, BoardStatus.Review);
    }
  }

  AgentStateManager.writeState(orchestratorStatePath, {
    execution: AgentStateManager.completeExecution(AgentStateManager.createExecutionState('running'), true),
    ...(modelUsage && Object.keys(modelUsage).length > 0
      ? { metadata: { totalCostUsd: Object.values(modelUsage).reduce((sum, u) => sum + u.costUSD, 0), modelUsage } }
      : {}),
  });
  AgentStateManager.appendLog(orchestratorStatePath, 'PR Review workflow completed successfully');

  log('ADW PR Review workflow completed!', 'success');
  log(`PR: ${prDetails.url}`, 'info');
  log(`Comments addressed: ${unaddressedComments.length}`, 'info');
}

/**
 * Handles PR review workflow errors: posts error comment, writes failed state, and exits.
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export function handlePRReviewWorkflowError(config: PRReviewWorkflowConfig, error: unknown, costUsd?: number, modelUsage?: ModelUsageMap): never {
  const { prNumber, ctx } = config;
  const { orchestratorStatePath, repoContext } = config.base;

  if (costUsd !== undefined && modelUsage) {
    persistTokenCounts(orchestratorStatePath, costUsd, modelUsage);
  }

  ctx.errorMessage = String(error);
  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_error', ctx);
  }

  AgentStateManager.writeState(orchestratorStatePath, {
    execution: AgentStateManager.completeExecution(AgentStateManager.createExecutionState('running'), false, String(error)),
  });
  AgentStateManager.appendLog(orchestratorStatePath, `PR Review workflow failed: ${error}`);
  log(`PR Review workflow failed: ${error}`, 'error');
  process.exit(1);
}
