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
import { appendToPauseQueue } from '../core/pauseQueue';

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

  let reviewContextResetCount = 0;
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
      reviewContextResetCount = continuationNumber;
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
  reviewContextResetCount = reviewResult.contextResetCount;

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
    contextResetCount: reviewContextResetCount,
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
 * Derives the orchestrator script path from the orchestratorName identifier.
 * Assumes scripts live at adws/{camelCase}.tsx.
 */
function deriveOrchestratorScript(orchestratorName: string): string {
  // e.g. 'sdlc-orchestrator' → 'adwSdlc', 'plan-build-orchestrator' → 'adwPlanBuild'
  const nameMap: Record<string, string> = {
    'sdlc-orchestrator': 'adwSdlc',
    'plan-orchestrator': 'adwPlan',
    'chore-orchestrator': 'adwChore',
    'plan-build-orchestrator': 'adwPlanBuild',
    'plan-build-test-orchestrator': 'adwPlanBuild',
    'plan-build-review-orchestrator': 'adwPlanBuildReview',
    'plan-build-test-review-orchestrator': 'adwPlanBuildTestReview',
    'plan-build-document-orchestrator': 'adwPlanBuildDocument',
    'build-orchestrator': 'adwBuild',
    'patch-orchestrator': 'adwPatch',
    'test-orchestrator': 'adwTest',
    'pr-review-orchestrator': 'adwPrReview',
  };
  return `adws/${nameMap[orchestratorName] ?? 'adwSdlc'}.tsx`;
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
  AgentStateManager.appendLog(orchestratorStatePath, `${orchestratorName} workflow failed: ${error}`);

  log(`${orchestratorName} workflow failed: ${error}`, 'error');
  process.exit(1);
}
