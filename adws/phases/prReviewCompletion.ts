/**
 * PR review workflow completion and error handling.
 *
 * Handles the final stages of the PR review workflow: committing changes,
 * pushing branches, posting completion comments, and error handling.
 */

import { log, AgentStateManager, COST_REPORT_CURRENCIES, type ModelUsageMap, buildCostBreakdown, mergeModelUsageMaps, emptyModelUsageMap, persistTokenCounts, OrchestratorId } from '../core';
import { createPhaseCostRecords, PhaseCostStatus } from '../cost';
import { appendIssueCostCsv, rebuildProjectTotalCsv } from '../cost/reporting';
import { fetchExchangeRates } from '../cost/exchangeRates';
import { formatCostCommentSection } from '../cost/reporting/commentFormatter';
import { BoardStatus } from '../providers/types';
import { pushBranch, inferIssueTypeFromBranch } from '../vcs';
import { postPRStageComment } from './phaseCommentHelpers';
import { runCommitAgent, runUnitTestsWithRetry, runE2ETestsWithRetry } from '../agents';
import { MAX_TEST_RETRY_ATTEMPTS } from '../core';
import type { PRReviewWorkflowConfig } from './prReviewPhase';

/**
 * Executes the PR review Test phase: runs unit and E2E tests with retry.
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function executePRReviewTestPhase(config: PRReviewWorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap }> {
  const { prNumber, prDetails, unaddressedComments, worktreePath, logsDir, orchestratorStatePath, ctx, applicationUrl, repoContext } = config;

  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_testing', ctx);
  }
  log('Running validation tests...', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting validation tests');

  const onTestFailed = (attempt: number, maxAttempts: number) => {
    ctx.testAttempt = attempt;
    ctx.maxTestAttempts = maxAttempts;
    if (repoContext) {
      postPRStageComment(repoContext, prNumber, 'pr_review_test_failed', ctx);
    }
  };

  const unitTestsResult = await runUnitTestsWithRetry({
    logsDir,
    orchestratorStatePath,
    maxRetries: MAX_TEST_RETRY_ATTEMPTS,
    onTestFailed,
    cwd: worktreePath,
    issueBody: prDetails.body,
  });

  if (!unitTestsResult.passed) {
    ctx.failedTests = unitTestsResult.failedTests;
    ctx.maxTestAttempts = MAX_TEST_RETRY_ATTEMPTS;
    if (repoContext) {
      postPRStageComment(repoContext, prNumber, 'pr_review_test_max_attempts', ctx);
    }
    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(AgentStateManager.createExecutionState('running'), false, `Unit tests failed after ${MAX_TEST_RETRY_ATTEMPTS} attempts`),
      metadata: { prNumber, reviewComments: unaddressedComments.length, testFailure: true, failedTests: unitTestsResult.failedTests },
    });
    AgentStateManager.appendLog(orchestratorStatePath, 'PR Review workflow failed: unit tests exceeded max retry attempts');
    log(`Unit tests failed after ${MAX_TEST_RETRY_ATTEMPTS} attempts. Changes not pushed.`, 'error');
    process.exit(1);
  }

  const e2eTestsResult = await runE2ETestsWithRetry({
    logsDir,
    orchestratorStatePath,
    maxRetries: MAX_TEST_RETRY_ATTEMPTS,
    onTestFailed,
    cwd: worktreePath,
    applicationUrl,
    issueBody: prDetails.body,
  });

  if (!e2eTestsResult.passed) {
    ctx.failedTests = e2eTestsResult.failedTests;
    ctx.maxTestAttempts = MAX_TEST_RETRY_ATTEMPTS;
    if (repoContext) {
      postPRStageComment(repoContext, prNumber, 'pr_review_test_max_attempts', ctx);
    }
    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(AgentStateManager.createExecutionState('running'), false, `E2E tests failed after ${MAX_TEST_RETRY_ATTEMPTS} attempts`),
      metadata: { prNumber, reviewComments: unaddressedComments.length, testFailure: true, failedTests: e2eTestsResult.failedTests },
    });
    AgentStateManager.appendLog(orchestratorStatePath, 'PR Review workflow failed: E2E tests exceeded max retry attempts');
    log(`E2E tests failed after ${MAX_TEST_RETRY_ATTEMPTS} attempts. Changes not pushed.`, 'error');
    process.exit(1);
  }

  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_test_passed', ctx);
  }
  log('All validation tests passed!', 'success');
  AgentStateManager.appendLog(orchestratorStatePath, 'All validation tests passed');

  const combinedCostUsd = (unitTestsResult.costUsd ?? 0) + (e2eTestsResult.costUsd ?? 0);
  const combinedModelUsage = mergeModelUsageMaps(
    unitTestsResult.modelUsage ?? emptyModelUsageMap(),
    e2eTestsResult.modelUsage ?? emptyModelUsageMap(),
  );

  return { costUsd: combinedCostUsd, modelUsage: combinedModelUsage };
}

/**
 * Completes the PR review workflow: commits, pushes, and posts completion comments.
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function completePRReviewWorkflow(config: PRReviewWorkflowConfig, modelUsage?: ModelUsageMap): Promise<void> {
  const { prNumber, prDetails, unaddressedComments, worktreePath, logsDir, orchestratorStatePath, ctx, repoContext } = config;

  // Build cost section for GitHub comment and write new-format CSV
  if (modelUsage && Object.keys(modelUsage).length > 0) {
    // Keep legacy costBreakdown for backward compatibility
    const costBreakdown = await buildCostBreakdown(modelUsage, [...COST_REPORT_CURRENCIES]);
    ctx.costBreakdown = costBreakdown;

    if (config.issueNumber && config.repoContext) {
      try {
        const repoName = config.repoContext.repoId.repo;
        const adwRepoRoot = process.cwd();

        const phaseCostRecords = createPhaseCostRecords({
          workflowId: config.adwId,
          issueNumber: config.issueNumber,
          phase: 'pr_review',
          status: PhaseCostStatus.Success,
          retryCount: 0,
          continuationCount: 0,
          durationMs: 0,
          modelUsage,
        });

        appendIssueCostCsv(adwRepoRoot, repoName, config.issueNumber, config.prDetails.title, phaseCostRecords);

        const rates = await fetchExchangeRates(['EUR']);
        rebuildProjectTotalCsv(adwRepoRoot, repoName, rates['EUR'] ?? 0);

        // Pre-compute cost section using the new formatter
        ctx.phaseCostRecords = phaseCostRecords;
        ctx.costSection = await formatCostCommentSection(phaseCostRecords);
      } catch (csvError) {
        log(`Failed to write cost CSV files: ${csvError}`, 'error');
      }
    } else {
      // No issue number/repoContext — still pre-compute cost section from modelUsage
      const phaseCostRecords = createPhaseCostRecords({
        workflowId: config.adwId,
        issueNumber: config.issueNumber ?? 0,
        phase: 'pr_review',
        status: PhaseCostStatus.Success,
        retryCount: 0,
        continuationCount: 0,
        durationMs: 0,
        modelUsage,
      });
      ctx.phaseCostRecords = phaseCostRecords;
      ctx.costSection = await formatCostCommentSection(phaseCostRecords);
    }
  }

  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_committing', ctx);
  }
  const issueType = inferIssueTypeFromBranch(prDetails.headBranch);
  await runCommitAgent(OrchestratorId.PrReview, issueType, JSON.stringify(prDetails), logsDir, undefined, worktreePath, prDetails.body);

  pushBranch(prDetails.headBranch, worktreePath);
  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_pushed', ctx);
    postPRStageComment(repoContext, prNumber, 'pr_review_completed', ctx);
    if (config.issueNumber) {
      await repoContext.issueTracker.moveToStatus(config.issueNumber, BoardStatus.Review);
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
  const { prNumber, orchestratorStatePath, ctx, repoContext } = config;

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
