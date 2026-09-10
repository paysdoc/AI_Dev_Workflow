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
import { BoardStatus, Platform } from '../providers/types';
import { appendToPauseQueue } from '../core/pauseQueue';
import { deriveOrchestratorScript } from '../core/orchestratorLib';
import { notifyBlockedTransition, buildNotifierDeps, type NotifierDeps } from '../forge/hitlBoardNotifier';

/**
 * Completes the workflow: writes final state, posts completion comment, prints banner.
 *
 * @param deniedToolCallCount - Optional aggregate per-run permission-denied tool-call
 *   count (issue #762), surfaced in the completion comment when greater than 0.
 */
export async function completeWorkflow(
  config: WorkflowConfig,
  totalCostUsd: number,
  additionalMetadata?: Record<string, unknown>,
  modelUsage?: ModelUsageMap,
  phaseCostRecords?: PhaseCostRecord[],
  deniedToolCallCount?: number,
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
    postIssueStageComment(repoContext, issueNumber, 'completed', ctx, deniedToolCallCount);
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
  const { orchestratorStatePath, orchestratorName, issueNumber, adwId, ctx, repoContext, worktreePath, branchName, targetRepo } = config;

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

  // Enqueue for probe + resume. Persist --target-repo so the respawned
  // orchestrator targets the correct repo — without this, resume defaults
  // to the cron host's repo and dies silently in detached/stdio:ignore.
  const extraArgs = targetRepo
    ? ['--target-repo', `${targetRepo.owner}/${targetRepo.repo}`]
    : undefined;
  appendToPauseQueue({
    adwId,
    issueNumber,
    orchestratorScript: deriveOrchestratorScript(orchestratorName),
    pausedAtPhase,
    pauseReason,
    pausedAt: new Date().toISOString(),
    worktreePath,
    branchName,
    ...(extraArgs ? { extraArgs } : {}),
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
    repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.Blocked).catch(() => {});
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

/**
 * Handles an agent watchdog timeout: writes phase_timeout stage, posts the Phase Timeout
 * comment on the issue, and exits 0. The next cron tick recovers the run via
 * reset-from-remote takeover (resume-in-place is a later slice).
 */
export function handlePhaseTimeout(
  config: WorkflowConfig,
  phaseName: string,
  timeoutMs: number,
): never {
  const { orchestratorStatePath, orchestratorName, issueNumber, ctx, repoContext, adwId } = config;

  ctx.timeoutPhaseName = phaseName;
  ctx.timeoutMs = timeoutMs;

  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, 'phase_timeout', ctx);
  }

  AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'phase_timeout' });
  AgentStateManager.appendLog(
    orchestratorStatePath,
    `${orchestratorName} workflow timed out at phase '${phaseName}' after ${timeoutMs} ms`,
  );
  log(`${orchestratorName} workflow timed out at '${phaseName}' after ${timeoutMs} ms`, 'warn');
  process.exit(0);
}

/**
 * Handles deliberate terminal workflow exits (e.g. PR closed by operator, merge failed after
 * all retries). Writes 'discarded' stage, posts a terminal comment, and exits 0.
 * Unlike handleWorkflowError (which writes 'abandoned' and exits 1), a discard is a clean,
 * intentional terminal decision — not a crash — so the exit code is 0.
 *
 * NOTE: this handler is currently uninvoked — the live discard notification is wired in
 * adwMerge.tsx. This hook is forward-compatible for any future caller and must be awaited
 * by such a caller before exiting.
 */
export async function handleWorkflowDiscarded(
  config: WorkflowConfig,
  reason: string,
  costUsd?: number,
  modelUsage?: ModelUsageMap,
  notifierDeps?: NotifierDeps,
): Promise<never> {
  const { orchestratorStatePath, orchestratorName, issueNumber, ctx, repoContext } = config;

  if (costUsd !== undefined && modelUsage) {
    persistTokenCounts(orchestratorStatePath, costUsd, modelUsage);
  }

  ctx.errorMessage = reason;
  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, 'discarded', ctx);
    repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.Blocked).catch(() => {});
    if (repoContext.repoId.platform === Platform.GitHub) {
      const deps = notifierDeps ?? buildNotifierDeps(() => repoContext, repoContext.repoId);
      await notifyBlockedTransition({ issueNumber, repoInfo: repoContext.repoId, source: 'discarded' }, deps);
    }
  }

  AgentStateManager.writeState(orchestratorStatePath, {
    execution: AgentStateManager.completeExecution(
      AgentStateManager.createExecutionState('running'),
      true,
    ),
  });
  AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'discarded' });
  AgentStateManager.appendLog(orchestratorStatePath, `${orchestratorName} workflow discarded: ${reason}`);

  log(`${orchestratorName} workflow discarded: ${reason}`, 'warn');
  process.exit(0);
}
