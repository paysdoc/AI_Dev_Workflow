/**
 * PR review workflow phases.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log, setLogAdwId, ensureLogsDirectory, generateAdwId, type PRDetails, type PRReviewComment, AgentStateManager, type AgentState, MAX_TEST_RETRY_ATTEMPTS, COST_REPORT_CURRENCIES, type ModelUsageMap, buildCostBreakdown, allocateRandomPort, mergeModelUsageMaps, emptyModelUsageMap, persistTokenCounts, writeIssueCostCsv, rebuildProjectCostCsv } from '../core';
import { fetchPRDetails, getUnaddressedComments, pushBranch, postPRWorkflowComment, type PRReviewWorkflowContext, ensureWorktree, inferIssueTypeFromBranch, moveIssueToStatus, type RepoInfo } from '../github';
import { setTargetRepo, getTargetRepo } from '../core/targetRepoRegistry';
import { getPlanFilePath, runPrReviewPlanAgent, runPrReviewBuildAgent, runCommitAgent, type ProgressCallback, type ProgressInfo, runUnitTestsWithRetry, runE2ETestsWithRetry } from '../agents';

// ============================================================================
// PR Review Workflow Phases
// ============================================================================

/**
 * Configuration shared across all PR review workflow phase functions.
 * Created by initializePRReviewWorkflow() and passed to every phase.
 */
export interface PRReviewWorkflowConfig {
  prNumber: number;
  issueNumber: number;
  adwId: string;
  prDetails: PRDetails;
  unaddressedComments: PRReviewComment[];
  worktreePath: string;
  logsDir: string;
  orchestratorStatePath: string;
  ctx: PRReviewWorkflowContext;
  applicationUrl: string;
  repoInfo?: RepoInfo;
}

/**
 * Initializes a PR review workflow: fetches PR details, checks for unaddressed
 * comments, sets up worktree, and initializes state.
 * @param prNumber - The PR number to review
 * @param adwId - Optional ADW workflow ID (generated if not provided)
 */
export async function initializePRReviewWorkflow(prNumber: number, adwId: string | null, repoInfo?: RepoInfo): Promise<PRReviewWorkflowConfig> {
  // Initialize central target repo registry
  if (repoInfo) {
    setTargetRepo(repoInfo);
  }

  const prDetails = fetchPRDetails(prNumber, repoInfo);
  log(`Fetched PR: ${prDetails.title}`, 'success');
  // Resolve ADW ID: use provided or generate from PR title
  const resolvedAdwId = adwId ?? generateAdwId(prDetails.title);
  setLogAdwId(resolvedAdwId);
  log('===================================', 'info');
  log('PR Review Orchestrator', 'info');
  log(`PR: #${prNumber}`, 'info');
  log(`ADW ID: ${resolvedAdwId}`, 'info');
  log('===================================', 'info');
  if (prDetails.state === 'CLOSED' || prDetails.state === 'MERGED') {
    log(`PR #${prNumber} is ${prDetails.state}, skipping`, 'info');
    process.exit(0);
  }
  const unaddressedComments = getUnaddressedComments(prNumber, repoInfo);
  if (unaddressedComments.length === 0) {
    log(`No unaddressed review comments on PR #${prNumber}, exiting`, 'info');
    process.exit(0);
  }
  log(`Found ${unaddressedComments.length} unaddressed review comment(s)`, 'info');
  const logsDir = ensureLogsDirectory(resolvedAdwId);
  const issueNumber = prDetails.issueNumber || 0;
  const orchestratorStatePath = AgentStateManager.initializeState(resolvedAdwId, 'pr-review-orchestrator');
  log(`State: ${orchestratorStatePath}`, 'info');
  const initialState: Partial<AgentState> = {
    adwId: resolvedAdwId,
    issueNumber,
    branchName: prDetails.headBranch,
    agentName: 'pr-review-orchestrator',
    pid: process.pid,
    execution: AgentStateManager.createExecutionState('running'),
    metadata: { prNumber, reviewComments: unaddressedComments.length },
  };
  AgentStateManager.writeState(orchestratorStatePath, initialState);
  AgentStateManager.appendLog(orchestratorStatePath, `Starting PR Review workflow for PR #${prNumber}`);
  const ctx: PRReviewWorkflowContext = {
    issueNumber,
    adwId: resolvedAdwId,
    prNumber,
    reviewComments: unaddressedComments.length,
    branchName: prDetails.headBranch,
  };
  const worktreePath = ensureWorktree(prDetails.headBranch);
  log(`Worktree path: ${worktreePath}`, 'info');

  // Allocate a random port for the dedicated dev server instance
  const port = await allocateRandomPort();
  const applicationUrl = `http://localhost:${port}`;
  log(`Allocated port ${port} for dev server (${applicationUrl})`, 'info');
  AgentStateManager.appendLog(orchestratorStatePath, `Allocated port ${port} for dev server`);

  postPRWorkflowComment(prNumber, 'pr_review_starting', ctx, repoInfo);
  return {
    prNumber,
    issueNumber,
    adwId: resolvedAdwId,
    prDetails,
    unaddressedComments,
    worktreePath,
    logsDir,
    orchestratorStatePath,
    ctx,
    applicationUrl,
    repoInfo,
  };
}

/**
 * Executes the PR review Plan phase: reads existing plan, runs PR review plan agent.
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function executePRReviewPlanPhase(config: PRReviewWorkflowConfig): Promise<{ planOutput: string; costUsd: number; modelUsage: ModelUsageMap }> {
  const { prNumber, issueNumber, adwId, prDetails, unaddressedComments, worktreePath, logsDir, orchestratorStatePath, ctx, repoInfo } = config;
  let existingPlanContent = '';
  if (issueNumber) {
    const planPath = path.join(worktreePath, getPlanFilePath(issueNumber, worktreePath));
    try {
      existingPlanContent = fs.readFileSync(planPath, 'utf-8');
      log(`Read existing plan from ${planPath}`, 'success');
    } catch {
      log(`No existing plan file found at ${planPath}, using PR body as context`, 'info');
      existingPlanContent = prDetails.body;
    }
  } else {
    log('No issue number found in PR body, using PR body as context', 'info');
    existingPlanContent = prDetails.body;
  }

  postPRWorkflowComment(prNumber, 'pr_review_planning', ctx, repoInfo);
  log('Running PR Review Plan Agent...', 'info');

  const planAgentStatePath = AgentStateManager.initializeState(adwId, 'pr-review-plan-agent', orchestratorStatePath);
  AgentStateManager.writeState(planAgentStatePath, {
    adwId,
    issueNumber,
    branchName: prDetails.headBranch,
    agentName: 'pr-review-plan-agent',
    parentAgent: 'pr-review-orchestrator',
    execution: AgentStateManager.createExecutionState('running'),
    metadata: { prNumber, reviewComments: unaddressedComments.length },
  });

  const planResult = await runPrReviewPlanAgent(prDetails, unaddressedComments, existingPlanContent, logsDir, planAgentStatePath, worktreePath, prDetails.body);

  if (!planResult.success) {
    AgentStateManager.writeState(planAgentStatePath, {
      execution: AgentStateManager.completeExecution(AgentStateManager.createExecutionState('running'), false, planResult.output),
    });
    throw new Error(`PR Review Plan Agent failed: ${planResult.output}`);
  }

  AgentStateManager.writeState(planAgentStatePath, {
    output: planResult.output.substring(0, 1000),
    execution: AgentStateManager.completeExecution(AgentStateManager.createExecutionState('running'), true),
  });
  AgentStateManager.appendLog(orchestratorStatePath, 'PR Review Plan completed');

  ctx.revisionPlanOutput = planResult.output;
  postPRWorkflowComment(prNumber, 'pr_review_planned', ctx, repoInfo);

  return {
    planOutput: planResult.output,
    costUsd: planResult.totalCostUsd ?? 0,
    modelUsage: planResult.modelUsage ?? emptyModelUsageMap(),
  };
}

/**
 * Executes the PR review Build phase: runs PR review build agent.
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function executePRReviewBuildPhase(config: PRReviewWorkflowConfig, planOutput: string): Promise<{ costUsd: number; modelUsage: ModelUsageMap }> {
  const { prNumber, issueNumber, adwId, prDetails, unaddressedComments, worktreePath, logsDir, orchestratorStatePath, ctx, repoInfo } = config;
  postPRWorkflowComment(prNumber, 'pr_review_implementing', ctx, repoInfo);
  log('Running PR Review Build Agent...', 'info');

  const buildAgentStatePath = AgentStateManager.initializeState(adwId, 'pr-review-build-agent', orchestratorStatePath);
  AgentStateManager.writeState(buildAgentStatePath, {
    adwId,
    issueNumber,
    branchName: prDetails.headBranch,
    agentName: 'pr-review-build-agent',
    parentAgent: 'pr-review-orchestrator',
    execution: AgentStateManager.createExecutionState('running'),
    metadata: { prNumber, reviewComments: unaddressedComments.length },
  });

  const buildProgressCallback: ProgressCallback = (info: ProgressInfo) => {
    if (info.type === 'tool_use') {
      log(`  [Turn ${info.turnCount}] Tool: ${info.toolName}`, 'info');
    }
  };

  const buildResult = await runPrReviewBuildAgent(prDetails, planOutput, logsDir, buildProgressCallback, buildAgentStatePath, worktreePath, prDetails.body);

  if (!buildResult.success) {
    AgentStateManager.writeState(buildAgentStatePath, {
      execution: AgentStateManager.completeExecution(AgentStateManager.createExecutionState('running'), false, buildResult.output),
    });
    throw new Error(`PR Review Build Agent failed: ${buildResult.output}`);
  }

  AgentStateManager.writeState(buildAgentStatePath, {
    output: buildResult.output.substring(0, 1000),
    execution: AgentStateManager.completeExecution(AgentStateManager.createExecutionState('running'), true),
  });
  AgentStateManager.appendLog(orchestratorStatePath, 'PR Review Build completed');

  ctx.revisionBuildOutput = buildResult.output;
  postPRWorkflowComment(prNumber, 'pr_review_implemented', ctx, repoInfo);

  return {
    costUsd: buildResult.totalCostUsd ?? 0,
    modelUsage: buildResult.modelUsage ?? emptyModelUsageMap(),
  };
}

/**
 * Executes the PR review Test phase: runs unit and E2E tests with retry.
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function executePRReviewTestPhase(config: PRReviewWorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap }> {
  const { prNumber, prDetails, unaddressedComments, worktreePath, logsDir, orchestratorStatePath, ctx, applicationUrl, repoInfo } = config;

  postPRWorkflowComment(prNumber, 'pr_review_testing', ctx, repoInfo);
  log('Running validation tests...', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting validation tests');

  const onTestFailed = (attempt: number, maxAttempts: number) => {
    ctx.testAttempt = attempt;
    ctx.maxTestAttempts = maxAttempts;
    postPRWorkflowComment(prNumber, 'pr_review_test_failed', ctx, repoInfo);
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
    postPRWorkflowComment(prNumber, 'pr_review_test_max_attempts', ctx, repoInfo);
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
    postPRWorkflowComment(prNumber, 'pr_review_test_max_attempts', ctx, repoInfo);
    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(AgentStateManager.createExecutionState('running'), false, `E2E tests failed after ${MAX_TEST_RETRY_ATTEMPTS} attempts`),
      metadata: { prNumber, reviewComments: unaddressedComments.length, testFailure: true, failedTests: e2eTestsResult.failedTests },
    });
    AgentStateManager.appendLog(orchestratorStatePath, 'PR Review workflow failed: E2E tests exceeded max retry attempts');
    log(`E2E tests failed after ${MAX_TEST_RETRY_ATTEMPTS} attempts. Changes not pushed.`, 'error');
    process.exit(1);
  }

  postPRWorkflowComment(prNumber, 'pr_review_test_passed', ctx, repoInfo);
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
  const { prNumber, prDetails, unaddressedComments, worktreePath, logsDir, orchestratorStatePath, ctx, repoInfo } = config;

  // Build cost breakdown if model usage data is available
  if (modelUsage && Object.keys(modelUsage).length > 0) {
    const costBreakdown = await buildCostBreakdown(modelUsage, [...COST_REPORT_CURRENCIES]);
    ctx.costBreakdown = costBreakdown;

    // Write cost data to CSV files
    try {
      const repoName = config.repoInfo?.repo ?? getTargetRepo().repo;
      const adwRepoRoot = process.cwd();
      const eurEntry = costBreakdown.currencies.find(c => c.currency === 'EUR');
      const eurRate = eurEntry ? eurEntry.amount / costBreakdown.totalCostUsd : 0;

      writeIssueCostCsv(adwRepoRoot, repoName, config.issueNumber, config.prDetails.title, costBreakdown);
      rebuildProjectCostCsv(adwRepoRoot, repoName, eurRate);
    } catch (csvError) {
      log(`Failed to write cost CSV files: ${csvError}`, 'error');
    }
  }

  postPRWorkflowComment(prNumber, 'pr_review_committing', ctx, repoInfo);
  const issueType = inferIssueTypeFromBranch(prDetails.headBranch);
  await runCommitAgent('pr-review-orchestrator', issueType, JSON.stringify(prDetails), logsDir, undefined, worktreePath, prDetails.body);

  pushBranch(prDetails.headBranch, worktreePath);
  postPRWorkflowComment(prNumber, 'pr_review_pushed', ctx, repoInfo);
  postPRWorkflowComment(prNumber, 'pr_review_completed', ctx, repoInfo);

  await moveIssueToStatus(config.issueNumber, 'Review', config.repoInfo);

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
  const { prNumber, orchestratorStatePath, ctx, repoInfo } = config;

  if (costUsd !== undefined && modelUsage) {
    persistTokenCounts(orchestratorStatePath, costUsd, modelUsage);
  }

  ctx.errorMessage = String(error);
  postPRWorkflowComment(prNumber, 'pr_review_error', ctx, repoInfo);

  AgentStateManager.writeState(orchestratorStatePath, {
    execution: AgentStateManager.completeExecution(AgentStateManager.createExecutionState('running'), false, String(error)),
  });
  AgentStateManager.appendLog(orchestratorStatePath, `PR Review workflow failed: ${error}`);
  log(`PR Review workflow failed: ${error}`, 'error');
  process.exit(1);
}
