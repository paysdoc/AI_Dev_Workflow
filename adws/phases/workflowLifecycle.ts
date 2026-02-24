/**
 * Workflow initialization, completion, error handling, and review phase.
 */

import { log, setLogAdwId, ensureLogsDirectory, generateAdwId, type IssueClassSlashCommand, type GitHubIssue, AgentStateManager, type AgentState, type AgentIdentifier, type RecoveryState, shouldExecuteStage, hasUncommittedChanges, getNextStage, MAX_REVIEW_RETRY_ATTEMPTS, COST_REPORT_CURRENCIES, type ModelUsageMap, buildCostBreakdown, persistTokenCounts, allocateRandomPort } from '../core';
import { fetchGitHubIssue, postWorkflowComment, type WorkflowContext, detectRecoveryState, getDefaultBranch, checkoutDefaultBranch, ensureWorktree, getWorktreeForBranch, mergeLatestFromDefaultBranch, copyEnvToWorktree, findWorktreeForIssue } from '../github';
import { runGenerateBranchNameAgent, getPlanFilePath, runReviewWithRetry } from '../agents';
import { classifyGitHubIssue } from '../core/issueClassifier';

/**
 * Configuration shared across all workflow phase functions.
 * Created by initializeWorkflow() and passed to every phase.
 */
export interface WorkflowConfig {
  issueNumber: number;
  adwId: string;
  issue: GitHubIssue;
  issueType: IssueClassSlashCommand;
  worktreePath: string;
  defaultBranch: string;
  logsDir: string;
  orchestratorStatePath: string;
  orchestratorName: AgentIdentifier;
  recoveryState: RecoveryState;
  ctx: WorkflowContext;
  branchName: string;
  applicationUrl: string;
}

/**
 * Initializes a workflow: fetches issue, classifies type, sets up worktree,
 * initializes state, and detects recovery mode.
 */
export async function initializeWorkflow(
  issueNumber: number,
  adwId: string | null,
  orchestratorName: AgentIdentifier,
  options?: { cwd?: string; issueType?: IssueClassSlashCommand }
): Promise<WorkflowConfig> {
  // Fetch issue
  log('Fetching GitHub issue...', 'info');
  const issue = await fetchGitHubIssue(issueNumber);
  log(`Fetched issue: ${issue.title}`, 'success');

  // Detect recovery state early to reuse existing ADW ID and branch name
  const recoveryState = detectRecoveryState(issue.comments);

  // Resolve ADW ID: use provided, recovered from prior workflow, or generate new
  const resolvedAdwId = adwId ?? recoveryState.adwId ?? generateAdwId(issue.title);
  setLogAdwId(resolvedAdwId);

  log('===================================', 'info');
  log(`${orchestratorName}`, 'info');
  log(`Issue: #${issueNumber}`, 'info');
  log(`ADW ID: ${resolvedAdwId}`, 'info');
  log('===================================', 'info');

  // Classify issue type
  let issueType: IssueClassSlashCommand;
  if (options?.issueType) {
    log(`Using pre-classified issue type: ${options.issueType}`, 'info');
    issueType = options.issueType;
  } else {
    log('Classifying issue type...', 'info');
    const classificationResult = await classifyGitHubIssue(issue);
    issueType = classificationResult.issueType;
    log(`Issue classified as: ${issueType}`, classificationResult.success ? 'success' : 'info');
  }

  // Initialize logs early so agents can use the directory
  const logsDir = ensureLogsDirectory(resolvedAdwId);

  // Setup worktree with branch sync
  const defaultBranch = getDefaultBranch();
  let worktreePath: string;
  let branchName = '';
  if (options?.cwd) {
    mergeLatestFromDefaultBranch(defaultBranch, options.cwd);
    worktreePath = options.cwd;
    log('Using provided worktree (merged latest code)', 'info');
  } else {
    // Try to find an existing worktree by issue type and number first
    const issueWorktree = findWorktreeForIssue(issueType, issueNumber);
    if (issueWorktree) {
      branchName = issueWorktree.branchName;
      worktreePath = issueWorktree.worktreePath;
      mergeLatestFromDefaultBranch(defaultBranch, worktreePath);
      copyEnvToWorktree(worktreePath);
      log(`Reusing existing worktree found by issue pattern at ${worktreePath}`, 'info');
    } else {
      // Reuse recovered branch name or generate a new one
      if (recoveryState.branchName) {
        branchName = recoveryState.branchName;
        log(`Reusing branch from previous workflow: ${branchName}`, 'info');
      } else {
        const branchResult = await runGenerateBranchNameAgent(
          issueType, issue, logsDir
        );
        branchName = branchResult.branchName;
        log(`Branch name generated: ${branchName}`, 'success');
      }

      // Check if a worktree already exists for this branch
      const existingWorktree = getWorktreeForBranch(branchName);
      if (existingWorktree) {
        log(`Reusing existing worktree at ${existingWorktree}`, 'info');
        mergeLatestFromDefaultBranch(defaultBranch, existingWorktree);
        copyEnvToWorktree(existingWorktree);
        worktreePath = existingWorktree;
      } else {
        // Ensure main repo is on default branch with latest code
        checkoutDefaultBranch();
        // Create worktree with new branch atomically via git worktree add -b
        worktreePath = ensureWorktree(branchName, defaultBranch);
      }
    }
    log(`Worktree path: ${worktreePath}`, 'info');
  }
  const orchestratorStatePath = AgentStateManager.initializeState(resolvedAdwId, orchestratorName);
  log(`State: ${orchestratorStatePath}`, 'info');
  log(`Logs: ${logsDir}`, 'info');

  const initialState: Partial<AgentState> = {
    adwId: resolvedAdwId,
    issueNumber,
    agentName: orchestratorName,
    pid: process.pid,
    execution: AgentStateManager.createExecutionState('running'),
  };
  AgentStateManager.writeState(orchestratorStatePath, initialState);
  AgentStateManager.appendLog(orchestratorStatePath, `Starting ${orchestratorName} workflow for issue #${issueNumber}`);

  // Initialize workflow context
  const ctx: WorkflowContext = {
    issueNumber,
    adwId: resolvedAdwId,
    issueType,
  };

  // Handle recovery mode
  if (recoveryState.canResume && recoveryState.lastCompletedStage) {
    log(`Recovery mode active: last completed stage was '${recoveryState.lastCompletedStage}'`, 'info');

    if (hasUncommittedChanges(worktreePath)) {
      log('Warning: There are uncommitted changes in the working directory', 'info');
    }

    if (recoveryState.branchName) ctx.branchName = recoveryState.branchName;
    if (recoveryState.planPath) ctx.planPath = recoveryState.planPath;
    if (recoveryState.prUrl) ctx.prUrl = recoveryState.prUrl;

    const nextStage = getNextStage(recoveryState.lastCompletedStage);
    ctx.resumeFrom = nextStage;
    postWorkflowComment(issueNumber, 'resuming', ctx);
  } else {
    postWorkflowComment(issueNumber, 'starting', ctx);
  }

  // Allocate a random port for the dedicated dev server instance
  const port = await allocateRandomPort();
  const applicationUrl = `http://localhost:${port}`;
  log(`Allocated port ${port} for dev server (${applicationUrl})`, 'info');
  AgentStateManager.appendLog(orchestratorStatePath, `Allocated port ${port} for dev server`);

  return {
    issueNumber,
    adwId: resolvedAdwId,
    issue,
    issueType,
    worktreePath,
    defaultBranch,
    logsDir,
    orchestratorStatePath,
    orchestratorName,
    recoveryState,
    ctx,
    branchName,
    applicationUrl,
  };
}

/**
 * Completes the workflow: writes final state, posts completion comment, prints banner.
 */
export async function completeWorkflow(
  config: WorkflowConfig,
  totalCostUsd: number,
  additionalMetadata?: Record<string, unknown>,
  modelUsage?: ModelUsageMap,
): Promise<void> {
  const { orchestratorStatePath, orchestratorName, issueNumber, ctx } = config;

  // Build cost breakdown if model usage data is available
  if (modelUsage && Object.keys(modelUsage).length > 0) {
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

  postWorkflowComment(issueNumber, 'completed', ctx);

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
  const { orchestratorStatePath, issueNumber, issue, issueType, ctx, logsDir, worktreePath, branchName, adwId, applicationUrl } = config;

  log('Phase: Review', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting review phase');

  const specFile = getPlanFilePath(issueNumber, worktreePath);

  postWorkflowComment(issueNumber, 'review_running', ctx);

  const reviewResult = await runReviewWithRetry({
    adwId,
    specFile,
    logsDir,
    orchestratorStatePath,
    maxRetries: MAX_REVIEW_RETRY_ATTEMPTS,
    branchName,
    issueType,
    issueContext: JSON.stringify(issue),
    onReviewFailed: (attempt, maxAttempts) => {
      log(`Review failed (attempt ${attempt}/${maxAttempts}), patching...`, 'info');
      postWorkflowComment(issueNumber, 'review_patching', ctx);
    },
    cwd: worktreePath,
    applicationUrl,
  });

  if (reviewResult.passed) {
    log('Review passed!', 'success');
    AgentStateManager.appendLog(orchestratorStatePath, 'Review passed');
    postWorkflowComment(issueNumber, 'review_passed', ctx);
  } else {
    const errorMsg = `Review failed after ${MAX_REVIEW_RETRY_ATTEMPTS} attempts with ${reviewResult.blockerIssues.length} remaining blocker(s)`;
    log(errorMsg, 'error');
    AgentStateManager.appendLog(orchestratorStatePath, errorMsg);
    ctx.errorMessage = errorMsg;
    postWorkflowComment(issueNumber, 'review_failed', ctx);

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
  const { orchestratorStatePath, orchestratorName, issueNumber, ctx } = config;

  if (costUsd !== undefined && modelUsage) {
    persistTokenCounts(orchestratorStatePath, costUsd, modelUsage);
  }

  ctx.errorMessage = String(error);
  postWorkflowComment(issueNumber, 'error', ctx);

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
