/**
 * PR review workflow phases.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log, setLogAdwId, ensureLogsDirectory, generateAdwId, type PRDetails, type PRReviewComment, AgentStateManager, type AgentState, type ModelUsageMap, allocateRandomPort, emptyModelUsageMap, OrchestratorId, type TargetRepoInfo, ensureTargetRepoWorkspace } from '../core';
import { fetchPRDetails, getUnaddressedComments, type PRReviewWorkflowContext, getRepoInfo, type RepoInfo, activateGitHubAppAuth } from '../github';
import { ensureWorktree } from '../vcs';
import type { PullRequestDetails, RepoContext, RepoIdentifier } from '../providers/types';
import { Platform } from '../providers/types';
import { createRepoContext } from '../providers/repoContext';
import { getPlanFilePath, runPrReviewPlanAgent, runPrReviewBuildAgent, type ProgressCallback, type ProgressInfo } from '../agents';
import { postPRStageComment } from './phaseCommentHelpers';

// ============================================================================
// PR Review Workflow Phases
// ============================================================================

/**
 * Configuration shared across all PR review workflow phase functions.
 * Created by initializePRReviewWorkflow() and passed to every phase.
 */
export interface PRReviewWorkflowConfig {
  prNumber: number;
  issueNumber: number | null;
  adwId: string;
  prDetails: PRDetails;
  unaddressedComments: PRReviewComment[];
  worktreePath: string;
  logsDir: string;
  orchestratorStatePath: string;
  ctx: PRReviewWorkflowContext;
  applicationUrl: string;
  repoContext?: RepoContext;
  totalModelUsage?: ModelUsageMap;
  installContext?: string;
}

/**
 * Initializes a PR review workflow: fetches PR details, checks for unaddressed
 * comments, sets up worktree, and initializes state.
 * @param prNumber - The PR number to review
 * @param adwId - Optional ADW workflow ID (generated if not provided)
 */
export async function initializePRReviewWorkflow(prNumber: number, adwId: string | null, repoInfo?: RepoInfo, repoId?: RepoIdentifier, targetRepo?: TargetRepoInfo): Promise<PRReviewWorkflowConfig> {
  const resolvedRepoInfo = repoInfo ?? getRepoInfo();
  // Activate GitHub App auth to generate a fresh token for this process.
  // Ensures child processes spawned by triggers don't rely on stale inherited GH_TOKEN.
  activateGitHubAppAuth(resolvedRepoInfo.owner, resolvedRepoInfo.repo);

  // Create RepoContext early so fetchPRDetails can go through the provider.
  let repoContext: RepoContext | undefined;
  try {
    const repoIdForContext = repoId ?? { owner: resolvedRepoInfo.owner, repo: resolvedRepoInfo.repo, platform: Platform.GitHub };
    repoContext = createRepoContext({
      repoId: repoIdForContext,
      cwd: process.cwd(), // temporary cwd; will be updated after worktree setup
    });
  } catch (error) {
    log(`Failed to create RepoContext (falling back to direct API calls): ${error}`, 'info');
  }

  let prDetails: PRDetails;
  if (repoContext) {
    const prd: PullRequestDetails = repoContext.codeHost.fetchPRDetails(prNumber);
    prDetails = {
      number: prd.number,
      title: prd.title,
      body: prd.body,
      state: prd.state,
      headBranch: prd.sourceBranch,
      baseBranch: prd.targetBranch,
      url: prd.url,
      issueNumber: prd.linkedIssueNumber ?? null,
      reviewComments: [],
    };
  } else {
    prDetails = fetchPRDetails(prNumber, resolvedRepoInfo);
  }
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
  const unaddressedComments = getUnaddressedComments(prNumber, resolvedRepoInfo);
  if (unaddressedComments.length === 0) {
    log(`No unaddressed review comments on PR #${prNumber}, exiting`, 'info');
    process.exit(0);
  }
  log(`Found ${unaddressedComments.length} unaddressed review comment(s)`, 'info');
  const logsDir = ensureLogsDirectory(resolvedAdwId);
  const issueNumber = prDetails.issueNumber;
  const orchestratorStatePath = AgentStateManager.initializeState(resolvedAdwId, OrchestratorId.PrReview);
  log(`State: ${orchestratorStatePath}`, 'info');
  const initialState: Partial<AgentState> = {
    adwId: resolvedAdwId,
    issueNumber,
    branchName: prDetails.headBranch,
    agentName: OrchestratorId.PrReview,
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
  let targetRepoWorkspacePath: string | undefined;
  if (targetRepo) {
    log(`Setting up target repo workspace for ${targetRepo.owner}/${targetRepo.repo}...`, 'info');
    targetRepoWorkspacePath = ensureTargetRepoWorkspace(targetRepo);
    log(`Target repo workspace: ${targetRepoWorkspacePath}`, 'success');
  }
  const worktreePath = ensureWorktree(prDetails.headBranch, undefined, targetRepoWorkspacePath);
  log(`Worktree path: ${worktreePath}`, 'info');

  // Recreate repoContext with the worktree cwd now that the worktree is set up.
  if (repoContext) {
    repoContext = createRepoContext({
      repoId: repoContext.repoId,
      cwd: worktreePath,
    });
  }

  // Allocate a random port for the dedicated dev server instance
  const port = await allocateRandomPort();
  const applicationUrl = `http://localhost:${port}`;
  log(`Allocated port ${port} for dev server (${applicationUrl})`, 'info');
  AgentStateManager.appendLog(orchestratorStatePath, `Allocated port ${port} for dev server`);

  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_starting', ctx);
  }
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
    repoContext,
  };
}

/**
 * Executes the PR review Plan phase: reads existing plan, runs PR review plan agent.
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function executePRReviewPlanPhase(config: PRReviewWorkflowConfig): Promise<{ planOutput: string; costUsd: number; modelUsage: ModelUsageMap }> {
  const { prNumber, issueNumber, adwId, prDetails, unaddressedComments, worktreePath, logsDir, orchestratorStatePath, ctx, repoContext } = config;
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

  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_planning', ctx);
  }
  log('Running PR Review Plan Agent...', 'info');

  const planAgentStatePath = AgentStateManager.initializeState(adwId, 'pr-review-plan-agent', orchestratorStatePath);
  AgentStateManager.writeState(planAgentStatePath, {
    adwId,
    issueNumber,
    branchName: prDetails.headBranch,
    agentName: 'pr-review-plan-agent',
    parentAgent: OrchestratorId.PrReview,
    execution: AgentStateManager.createExecutionState('running'),
    metadata: { prNumber, reviewComments: unaddressedComments.length },
  });

  const planResult = await runPrReviewPlanAgent(prDetails, unaddressedComments, existingPlanContent, logsDir, planAgentStatePath, worktreePath, prDetails.body, config.installContext);

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
  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_planned', ctx);
  }

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
  const { prNumber, issueNumber, adwId, prDetails, unaddressedComments, worktreePath, logsDir, orchestratorStatePath, ctx, repoContext } = config;
  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_implementing', ctx);
  }
  log('Running PR Review Build Agent...', 'info');

  const buildAgentStatePath = AgentStateManager.initializeState(adwId, 'pr-review-build-agent', orchestratorStatePath);
  AgentStateManager.writeState(buildAgentStatePath, {
    adwId,
    issueNumber,
    branchName: prDetails.headBranch,
    agentName: 'pr-review-build-agent',
    parentAgent: OrchestratorId.PrReview,
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
  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_implemented', ctx);
  }

  return {
    costUsd: buildResult.totalCostUsd ?? 0,
    modelUsage: buildResult.modelUsage ?? emptyModelUsageMap(),
  };
}

// Backward-compatible re-exports from prReviewCompletion
export {
  executePRReviewTestPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
} from './prReviewCompletion';
