/**
 * Workflow completion, review phase execution, and error handling.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  log,
  AgentStateManager,
  MAX_REVIEW_RETRY_ATTEMPTS,
  COST_REPORT_CURRENCIES,
} from '../core';
import { type ModelUsageMap, buildCostBreakdown, persistTokenCounts } from '../cost';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { formatCostCommentSection } from '../cost/reporting/commentFormatter';
import { getPlanFilePath, runReviewWithRetry } from '../agents';
import type { WorkflowConfig } from './workflowInit';
import { postIssueStageComment } from './phaseCommentHelpers';
import { BoardStatus } from '../providers/types';
import { uploadToR2 } from '../r2';

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
 * Executes the Review phase: run review agent with retry and patching.
 */
export async function executeReviewPhase(config: WorkflowConfig): Promise<{
  costUsd: number;
  modelUsage: ModelUsageMap;
  reviewPassed: boolean;
  totalRetries: number;
  phaseCostRecords: PhaseCostRecord[];
}> {
  const { orchestratorStatePath, issueNumber, issue, issueType, ctx, logsDir, worktreePath, branchName, adwId, applicationUrl, repoContext } = config;
  const phaseStartTime = Date.now();

  log('Phase: Review', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting review phase');

  const specFile = getPlanFilePath(issueNumber, worktreePath);

  ctx.reviewAttempt = 1;
  ctx.maxReviewAttempts = MAX_REVIEW_RETRY_ATTEMPTS;
  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, 'review_running', ctx);
  }

  let reviewContinuationCount = 0;
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
    onCompactionDetected: (continuationNumber) => {
      reviewContinuationCount = continuationNumber;
      ctx.tokenContinuationNumber = continuationNumber;
      log(`Review phase: context compacted, spawning continuation #${continuationNumber}`, 'info');
      AgentStateManager.appendLog(orchestratorStatePath, `Review phase context compacted (continuation ${continuationNumber})`);
      if (repoContext) {
        postIssueStageComment(repoContext, issueNumber, 'review_compaction_recovery', ctx);
      }
    },
    cwd: worktreePath,
    applicationUrl,
    issueBody: issue.body,
    issueNumber,
    scenariosMd: config.projectConfig.scenariosMd,
    reviewProofConfig: config.projectConfig.reviewProofConfig,
    runByTagCommand: config.projectConfig.commands.runScenariosByTag,
  });
  reviewContinuationCount = reviewResult.continuationCount;

  // Upload screenshots to R2 for web apps (non-fatal — errors are logged and skipped)
  if (config.projectConfig.applicationType === 'web' && reviewResult.allScreenshots.length > 0 && repoContext) {
    const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
    const contentTypeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const imageFiles = reviewResult.allScreenshots.filter(p =>
      imageExtensions.has(path.extname(p).toLowerCase())
    );
    const uploadedUrls: string[] = [];
    for (const filePath of imageFiles) {
      try {
        if (!fs.existsSync(filePath)) {
          log(`Screenshot file not found, skipping: ${filePath}`, 'warn');
          continue;
        }
        const buffer = fs.readFileSync(filePath);
        const filename = path.basename(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const result = await uploadToR2({
          owner: repoContext.repoId.owner,
          repo: repoContext.repoId.repo,
          key: `review/${adwId}/${filename}`,
          body: buffer,
          contentType: contentTypeMap[ext] ?? 'image/png',
        });
        uploadedUrls.push(result.url);
      } catch (uploadError) {
        log(`Screenshot upload failed for ${filePath}: ${uploadError}`, 'warn');
      }
    }
    if (uploadedUrls.length > 0) {
      ctx.screenshotUrls = uploadedUrls;
      log(`Uploaded ${uploadedUrls.length} screenshot(s) to R2`, 'info');
    }
  }

  if (reviewResult.passed) {
    log('Review passed!', 'success');
    AgentStateManager.appendLog(orchestratorStatePath, 'Review passed');
    ctx.reviewSummary = reviewResult.reviewSummary;
    ctx.reviewIssues = reviewResult.blockerIssues;
    ctx.scenarioProof = reviewResult.scenarioProof;
    ctx.allSummaries = reviewResult.allSummaries;
    ctx.allScreenshots = reviewResult.allScreenshots;
    ctx.nonBlockerIssues = reviewResult.nonBlockerIssues;
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'review_passed', ctx);
    }
  } else {
    const errorMsg = `Review failed after ${MAX_REVIEW_RETRY_ATTEMPTS} attempts with ${reviewResult.blockerIssues.length} remaining blocker(s)`;
    log(errorMsg, 'error');
    AgentStateManager.appendLog(orchestratorStatePath, errorMsg);
    ctx.errorMessage = errorMsg;
    ctx.reviewIssues = reviewResult.blockerIssues;
    ctx.scenarioProof = reviewResult.scenarioProof;
    ctx.allSummaries = reviewResult.allSummaries;
    ctx.allScreenshots = reviewResult.allScreenshots;
    ctx.nonBlockerIssues = reviewResult.nonBlockerIssues;
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
    process.exit(1);
  }

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'review',
    status: reviewResult.passed ? PhaseCostStatus.Success : PhaseCostStatus.Failed,
    retryCount: reviewResult.totalRetries,
    continuationCount: reviewContinuationCount,
    durationMs: Date.now() - phaseStartTime,
    modelUsage: reviewResult.modelUsage,
  });

  return {
    costUsd: reviewResult.costUsd,
    modelUsage: reviewResult.modelUsage,
    reviewPassed: reviewResult.passed,
    totalRetries: reviewResult.totalRetries,
    phaseCostRecords,
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
