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
import { BoardStatus, Platform } from '@paysdoc/devplatform';
import { appendToPauseQueue, resetsAtIsoFromEpochSeconds, type PausedWorkflow } from '../core/pauseQueue';
import { deriveOrchestratorScript } from '../core/orchestratorLib';
import { notifyBlockedTransition, buildNotifierDeps, type NotifierDeps } from '../forge/hitlBoardNotifier';
import type { RateLimitFacts } from '../types/agentTypes';

/**
 * @param deniedToolCallCount - Optional aggregate per-run permission-denied tool-call
 *   count, surfaced in the completion comment when greater than 0.
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
 * Pure: builds the queue entry handleRateLimitPause appends. Absent facts are
 * absent keys (never `undefined` values), the same spread idiom as `extraArgs`,
 * so entries with no reset facts stay byte-for-byte identical to entries with no
 * knowledge of the reset-time fields at all.
 */
export function buildPausedWorkflowEntry(
  config: Pick<WorkflowConfig, 'adwId' | 'issueNumber' | 'orchestratorName' | 'worktreePath' | 'branchName' | 'targetRepo'>,
  pausedAtPhase: string,
  pauseReason: PausedWorkflow['pauseReason'],
  facts: RateLimitFacts,
  now: Date,
): PausedWorkflow {
  const { adwId, issueNumber, orchestratorName, worktreePath, branchName, targetRepo } = config;

  const extraArgs = targetRepo
    ? ['--target-repo', `${targetRepo.owner}/${targetRepo.repo}`]
    : undefined;

  return {
    adwId,
    issueNumber,
    orchestratorScript: deriveOrchestratorScript(orchestratorName),
    pausedAtPhase,
    pauseReason,
    pausedAt: now.toISOString(),
    worktreePath,
    branchName,
    ...(extraArgs ? { extraArgs } : {}),
    ...(typeof facts.resetsAt === 'number' && Number.isFinite(facts.resetsAt)
      ? { resetsAt: resetsAtIsoFromEpochSeconds(facts.resetsAt) }
      : {}),
    ...(typeof facts.rateLimitType === 'string' ? { rateLimitType: facts.rateLimitType } : {}),
  };
}

/** Called by runPhase() when a RateLimitError is caught. */
export function handleRateLimitPause(
  config: WorkflowConfig,
  pausedAtPhase: string,
  pauseReason: 'rate_limited' | 'unknown_error',
  costUsd?: number,
  modelUsage?: ModelUsageMap,
  facts: RateLimitFacts = {},
): never {
  const { orchestratorStatePath, orchestratorName, issueNumber, adwId, ctx, repoContext } = config;

  if (costUsd !== undefined && modelUsage) {
    persistTokenCounts(orchestratorStatePath, costUsd, modelUsage);
  }

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

  appendToPauseQueue(buildPausedWorkflowEntry(config, pausedAtPhase, pauseReason, facts, new Date()));

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

/** Optionally persists accumulated token counts so cost data survives the crash. */
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

/** The next cron tick recovers the run via reset-from-remote takeover. */
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
