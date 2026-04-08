/**
 * Workflow completion and error handling — terminal-state handlers only.
 *
 * executeReviewPhase has been relocated to phases/reviewPhase.ts.
 */

import {
  log,
  AgentStateManager,
  COST_REPORT_CURRENCIES,
} from '../core';
import { type ModelUsageMap, buildCostBreakdown, persistTokenCounts } from '../cost';
import { type PhaseCostRecord } from '../cost';
import { formatCostCommentSection } from '../cost/reporting/commentFormatter';
import type { WorkflowConfig } from './workflowInit';
import { postIssueStageComment } from './phaseCommentHelpers';
import { BoardStatus } from '../providers/types';
import { appendToPauseQueue } from '../core/pauseQueue';
import { deriveOrchestratorScript } from '../core/orchestratorLib';

/**
 * Completes the workflow: writes final state, posts completion comment, prints banner.
 */
export async function completeWorkflow(
  config: WorkflowConfig,
  totalCostUsd: number,
  additionalMetadata?: Record<string, unknown>,
  modelUsage?: ModelUsageMap,
  phaseCostRecords?: PhaseCostRecord[],
): Promise<void> {
  const { orchestratorStatePath, orchestratorName, issueNumber, ctx, repoContext } = config;

  // Build cost section for GitHub comment (CSV is written per-phase by the orchestrator)
  if (phaseCostRecords && phaseCostRecords.length > 0) {
    ctx.phaseCostRecords = phaseCostRecords;
    ctx.costSection = await formatCostCommentSection(phaseCostRecords);
  } else if (modelUsage && Object.keys(modelUsage).length > 0) {
    // Legacy path: build CostBreakdown from ModelUsageMap
    const costBreakdown = await buildCostBreakdown(modelUsage, [...COST_REPORT_CURRENCIES]);
    ctx.costBreakdown = costBreakdown;
  }

  AgentStateManager.writeState(orchestratorStatePath, {
    execution: AgentStateManager.completeExecution(
      AgentStateManager.createExecutionState('running'),
      true
    ),
    metadata: { totalCostUsd, ...additionalMetadata },
  });
  AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'completed' });
  AgentStateManager.appendLog(orchestratorStatePath, 'Workflow completed successfully');

  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, 'completed', ctx);
  }

  log('===================================', 'info');
  log(`${orchestratorName} workflow completed!`, 'success');
  if (ctx.prUrl) {
    log(`PR: ${ctx.prUrl}`, 'info');
  }
  log('===================================', 'info');
}

/**
 * Pauses the workflow: records completed phases, enqueues for probe/resume, posts comment, exits 0.
 * Called by runPhase() when a RateLimitError is caught.
 */
export function handleRateLimitPause(
  config: WorkflowConfig,
  pausedAtPhase: string,
  pauseReason: 'rate_limited' | 'unknown_error',
  costUsd?: number,
  modelUsage?: ModelUsageMap,
): never {
  const { orchestratorStatePath, orchestratorName, issueNumber, adwId, ctx, repoContext, worktreePath, branchName } = config;

  if (costUsd !== undefined && modelUsage) {
    persistTokenCounts(orchestratorStatePath, costUsd, modelUsage);
  }

  // Write completedPhases + pausedAtPhase to state metadata
  const existingState = AgentStateManager.readState(orchestratorStatePath);
  const existingMeta = (existingState?.metadata ?? {}) as Record<string, unknown>;
  AgentStateManager.writeState(orchestratorStatePath, {
    execution: {
      status: 'paused',
      startedAt: existingState?.execution?.startedAt ?? new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
    metadata: {
      ...existingMeta,
      totalCostUsd: costUsd,
      pausedAtPhase,
      pauseReason,
    },
  });
  AgentStateManager.appendLog(orchestratorStatePath, `Workflow paused at phase '${pausedAtPhase}': ${pauseReason}`);

  AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'paused' });

  // Enqueue for probe + resume
  appendToPauseQueue({
    adwId,
    issueNumber,
    orchestratorScript: deriveOrchestratorScript(orchestratorName),
    pausedAtPhase,
    pauseReason,
    pausedAt: new Date().toISOString(),
    worktreePath,
    branchName,
  });

  // Post paused comment
  ctx.pausedAtPhase = pausedAtPhase;
  ctx.pauseReason = pauseReason === 'rate_limited'
    ? 'Rate limit or API outage detected'
    : 'Unknown API error';
  ctx.completedPhases = (existingMeta.completedPhases as string[] | undefined) ?? [];

  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, 'paused', ctx);
    repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.InProgress).catch(() => {});
  }

  log(`${orchestratorName} workflow paused at '${pausedAtPhase}': ${pauseReason}`, 'warn');
  process.exit(0);
}

/**
 * Handles workflow errors: posts error comment, writes failed state, and exits.
 * Optionally persists accumulated token counts so cost data survives the crash.
 */
export function handleWorkflowError(
  config: WorkflowConfig,
  error: unknown,
  costUsd?: number,
  modelUsage?: ModelUsageMap,
): never {
  const { orchestratorStatePath, orchestratorName, issueNumber, ctx, repoContext } = config;

  if (costUsd !== undefined && modelUsage) {
    persistTokenCounts(orchestratorStatePath, costUsd, modelUsage);
  }

  ctx.errorMessage = String(error);
  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, 'error', ctx);
    repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.InProgress).catch(() => {});
  }

  AgentStateManager.writeState(orchestratorStatePath, {
    execution: AgentStateManager.completeExecution(
      AgentStateManager.createExecutionState('running'),
      false,
      String(error)
    ),
  });
  AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'abandoned' });
  AgentStateManager.appendLog(orchestratorStatePath, `${orchestratorName} workflow failed: ${error}`);

  log(`${orchestratorName} workflow failed: ${error}`, 'error');
  process.exit(1);
}
