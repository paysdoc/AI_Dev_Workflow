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
} from '../core';
import {
  postWorkflowComment,
  moveIssueToStatus,
} from '../github';
import { getPlanFilePath, runReviewWithRetry } from '../agents';
import type { WorkflowConfig } from './workflowInit';

/**
 * Completes the workflow: writes final state, posts completion comment, prints banner.
 */
export async function completeWorkflow(
  config: WorkflowConfig,
  totalCostUsd: number,
  additionalMetadata?: Record<string, unknown>,
  modelUsage?: ModelUsageMap,
): Promise<void> {
  const { orchestratorStatePath, orchestratorName, issueNumber, ctx, repoInfo } = config;

  // Build cost breakdown if model usage data is available
  if (modelUsage && Object.keys(modelUsage).length > 0) {
    const costBreakdown = await buildCostBreakdown(modelUsage, [...COST_REPORT_CURRENCIES]);
    ctx.costBreakdown = costBreakdown;

    // Write cost data to CSV files
    try {
      const repoName = config.targetRepo?.repo ?? config.repoInfo?.repo ?? 'unknown';
      const adwRepoRoot = config.targetRepo ? process.cwd() : config.worktreePath;
      const eurEntry = costBreakdown.currencies.find(c => c.currency === 'EUR');
      const eurRate = eurEntry ? eurEntry.amount / costBreakdown.totalCostUsd : 0;

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

  postWorkflowComment(issueNumber, 'completed', ctx, repoInfo);

  await moveIssueToStatus(issueNumber, 'Review', repoInfo);

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
  const { orchestratorStatePath, issueNumber, issue, issueType, ctx, logsDir, worktreePath, branchName, adwId, applicationUrl, repoInfo } = config;

  log('Phase: Review', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting review phase');

  const specFile = getPlanFilePath(issueNumber, worktreePath);

  ctx.reviewAttempt = 1;
  ctx.maxReviewAttempts = MAX_REVIEW_RETRY_ATTEMPTS;
  postWorkflowComment(issueNumber, 'review_running', ctx, repoInfo);

  const reviewResult = await runReviewWithRetry({
    adwId,
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
      postWorkflowComment(issueNumber, 'review_patching', ctx, repoInfo);
    },
    cwd: worktreePath,
    applicationUrl,
    issueBody: issue.body,
  });

  if (reviewResult.passed) {
    log('Review passed!', 'success');
    AgentStateManager.appendLog(orchestratorStatePath, 'Review passed');
    ctx.reviewSummary = reviewResult.reviewSummary;
    ctx.reviewIssues = reviewResult.blockerIssues;
    postWorkflowComment(issueNumber, 'review_passed', ctx, repoInfo);
  } else {
    const errorMsg = `Review failed after ${MAX_REVIEW_RETRY_ATTEMPTS} attempts with ${reviewResult.blockerIssues.length} remaining blocker(s)`;
    log(errorMsg, 'error');
    AgentStateManager.appendLog(orchestratorStatePath, errorMsg);
    ctx.errorMessage = errorMsg;
    ctx.reviewIssues = reviewResult.blockerIssues;
    postWorkflowComment(issueNumber, 'review_failed', ctx, repoInfo);

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
  const { orchestratorStatePath, orchestratorName, issueNumber, ctx, repoInfo } = config;

  if (costUsd !== undefined && modelUsage) {
    persistTokenCounts(orchestratorStatePath, costUsd, modelUsage);
  }

  ctx.errorMessage = String(error);
  postWorkflowComment(issueNumber, 'error', ctx, repoInfo);

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
