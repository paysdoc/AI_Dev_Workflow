/**
 * Workflow completion, review phase execution, and error handling.
 */

import {
  log,
  AgentStateManager,
  type ModelUsageMap,
  MAX_REVIEW_RETRY_ATTEMPTS,
  COST_REPORT_CURRENCIES,
  buildCostBreakdown,
  persistTokenCounts,
  writeIssueCostCsv,
  rebuildProjectCostCsv,
  computeEurRate,
} from '../core';
import { getPlanFilePath, runReviewWithRetry } from '../agents';
import type { WorkflowConfig } from './workflowInit';
import { postIssueStageComment } from './phaseCommentHelpers';
import { BoardStatus } from '../providers/types';

/**
 * Completes the workflow: writes final state, posts completion comment, prints banner.
 */
export async function completeWorkflow(
  config: WorkflowConfig,
  totalCostUsd: number,
  additionalMetadata?: Record<string, unknown>,
  modelUsage?: ModelUsageMap,
): Promise<void> {
  const { orchestratorStatePath, orchestratorName, issueNumber, ctx, repoContext } = config;

  // Build cost breakdown if model usage data is available
  if (modelUsage && Object.keys(modelUsage).length > 0) {
    const costBreakdown = await buildCostBreakdown(modelUsage, [...COST_REPORT_CURRENCIES]);
    ctx.costBreakdown = costBreakdown;

    // Write cost data to CSV files
    try {
      const repoName = config.targetRepo?.repo ?? config.repoContext?.repoId.repo ?? 'unknown';
      const adwRepoRoot = config.targetRepo ? process.cwd() : config.worktreePath;
      const eurRate = computeEurRate(costBreakdown);

      writeIssueCostCsv(adwRepoRoot, repoName, config.issueNumber, config.issue.title, costBreakdown);
      rebuildProjectCostCsv(adwRepoRoot, repoName, eurRate);
    } catch (csvError) {
      log(`Failed to write cost CSV files: ${csvError}`, 'error');
    }
  }

  AgentStateManager.writeState(orchestratorStatePath, {
    execution: AgentStateManager.completeExecution(
      AgentStateManager.createExecutionState('running'),
      true
    ),
    metadata: { totalCostUsd, ...additionalMetadata },
  });
  AgentStateManager.appendLog(orchestratorStatePath, 'Workflow completed successfully');

  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, 'completed', ctx);
    await repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.Review);
  }

  log('===================================', 'info');
  log(`${orchestratorName} workflow completed!`, 'success');
  if (ctx.prUrl) {
    log(`PR: ${ctx.prUrl}`, 'info');
  }
  log('===================================', 'info');
}

/**
 * Executes the Review phase: run review agent with retry and patching.
 */
export async function executeReviewPhase(config: WorkflowConfig): Promise<{
  costUsd: number;
  modelUsage: ModelUsageMap;
  reviewPassed: boolean;
  totalRetries: number;
}> {
  const { orchestratorStatePath, issueNumber, issue, issueType, ctx, logsDir, worktreePath, branchName, adwId, applicationUrl, repoContext } = config;

  log('Phase: Review', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting review phase');

  const specFile = getPlanFilePath(issueNumber, worktreePath);

  ctx.reviewAttempt = 1;
  ctx.maxReviewAttempts = MAX_REVIEW_RETRY_ATTEMPTS;
  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, 'review_running', ctx);
  }

  const reviewResult = await runReviewWithRetry({
    adwId,
    issue,
    specFile,
    logsDir,
    orchestratorStatePath,
    maxRetries: MAX_REVIEW_RETRY_ATTEMPTS,
    branchName,
    issueType,
    issueContext: JSON.stringify(issue),
    onReviewFailed: (attempt, maxAttempts, blockerIssues) => {
      log(`Review failed (attempt ${attempt}/${maxAttempts}), patching...`, 'info');
      ctx.reviewIssues = blockerIssues;
      ctx.reviewAttempt = attempt;
      ctx.maxReviewAttempts = maxAttempts;
    },
    onPatchingIssue: (issue) => {
      ctx.patchingIssue = issue;
      if (repoContext) {
        postIssueStageComment(repoContext, issueNumber, 'review_patching', ctx);
      }
    },
    cwd: worktreePath,
    applicationUrl,
    issueBody: issue.body,
    issueNumber,
    scenariosMd: config.projectConfig.scenariosMd,
    runRegressionCommand: config.projectConfig.commands.runRegressionScenarios,
    runByTagCommand: config.projectConfig.commands.runScenariosByTag,
  });

  if (reviewResult.passed) {
    log('Review passed!', 'success');
    AgentStateManager.appendLog(orchestratorStatePath, 'Review passed');
    ctx.reviewSummary = reviewResult.reviewSummary;
    ctx.reviewIssues = reviewResult.blockerIssues;
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'review_passed', ctx);
    }
  } else {
    const errorMsg = `Review failed after ${MAX_REVIEW_RETRY_ATTEMPTS} attempts with ${reviewResult.blockerIssues.length} remaining blocker(s)`;
    log(errorMsg, 'error');
    AgentStateManager.appendLog(orchestratorStatePath, errorMsg);
    ctx.errorMessage = errorMsg;
    ctx.reviewIssues = reviewResult.blockerIssues;
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'review_failed', ctx);
    }

    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        false,
        errorMsg
      ),
      metadata: { totalCostUsd: reviewResult.costUsd, reviewPassed: false },
    });
  }

  return {
    costUsd: reviewResult.costUsd,
    modelUsage: reviewResult.modelUsage,
    reviewPassed: reviewResult.passed,
    totalRetries: reviewResult.totalRetries,
  };
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
  AgentStateManager.appendLog(orchestratorStatePath, `${orchestratorName} workflow failed: ${error}`);

  log(`${orchestratorName} workflow failed: ${error}`, 'error');
  process.exit(1);
}
