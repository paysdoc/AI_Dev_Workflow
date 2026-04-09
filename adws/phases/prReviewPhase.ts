/**
 * PR review workflow phases.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log, setLogAdwId, ensureLogsDirectory, generateAdwId, type PRDetails, type PRReviewComment, AgentStateManager, type AgentState, type ModelUsageMap, allocateRandomPort, emptyModelUsageMap, OrchestratorId, type TargetRepoInfo, ensureTargetRepoWorkspace, loadProjectConfig, type GitHubIssue, type IssueClassSlashCommand, type RecoveryState } from '../core';
import { fetchPRDetails, getUnaddressedComments, type PRReviewWorkflowContext, getRepoInfo, type RepoInfo, activateGitHubAppAuth } from '../github';
import type { WorkflowConfig } from './workflowInit';
import { ensureWorktree, pushBranch, inferIssueTypeFromBranch } from '../vcs';
import { BoardStatus, type RepoContext, type RepoIdentifier } from '../providers/types';
import { Platform } from '../providers/types';
import { createRepoContext } from '../providers/repoContext';
import { getPlanFilePath, runPrReviewPlanAgent, runPrReviewBuildAgent, runCommitAgent, type ProgressCallback, type ProgressInfo } from '../agents';
import { postPRStageComment } from './phaseCommentHelpers';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';

// ============================================================================
// PR Review Workflow Phases
// ============================================================================

/**
 * Configuration shared across all PR review workflow phase functions.
 * Created by initializePRReviewWorkflow() and passed to every phase.
 */
export interface PRReviewWorkflowConfig {
  base: WorkflowConfig;
  prNumber: number;
  prDetails: PRDetails;
  unaddressedComments: PRReviewComment[];
  ctx: PRReviewWorkflowContext;
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
  const prDetails = fetchPRDetails(prNumber, resolvedRepoInfo);
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

  // Allocate a random port for the dedicated dev server instance
  const port = await allocateRandomPort();
  const applicationUrl = `http://localhost:${port}`;
  log(`Allocated port ${port} for dev server (${applicationUrl})`, 'info');
  AgentStateManager.appendLog(orchestratorStatePath, `Allocated port ${port} for dev server`);

  // Create RepoContext for provider-agnostic operations
  let repoContext: RepoContext | undefined;
  try {
    const repoIdForContext = repoId ?? (() => {
      const resolvedRepoInfo = repoInfo ?? getRepoInfo();
      return { owner: resolvedRepoInfo.owner, repo: resolvedRepoInfo.repo, platform: Platform.GitHub };
    })();
    repoContext = createRepoContext({
      repoId: repoIdForContext,
      cwd: worktreePath,
    });
  } catch (error) {
    log(`Failed to create RepoContext (falling back to direct API calls): ${error}`, 'info');
  }

  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_starting', ctx);
  }

  const issueStub: GitHubIssue = {
    number: prNumber,
    title: prDetails.title,
    body: prDetails.body,
    state: 'open',
    author: { login: '', isBot: false },
    assignees: [],
    labels: [],
    comments: [],
    createdAt: '',
    updatedAt: '',
    url: prDetails.url,
  };
  const defaultRecoveryState: RecoveryState = {
    lastCompletedStage: null,
    adwId: null,
    branchName: null,
    planPath: null,
    prUrl: null,
    canResume: false,
  };
  const projectConfig = loadProjectConfig(worktreePath);
  const topLevelStatePath = AgentStateManager.getTopLevelStatePath(resolvedAdwId);
  const base: WorkflowConfig = {
    issueNumber: issueNumber ?? 0,
    adwId: resolvedAdwId,
    issue: issueStub,
    issueType: '/pr_review' as IssueClassSlashCommand,
    worktreePath,
    defaultBranch: prDetails.baseBranch,
    logsDir,
    orchestratorStatePath,
    orchestratorName: OrchestratorId.PrReview,
    recoveryState: defaultRecoveryState,
    ctx,
    branchName: prDetails.headBranch,
    applicationUrl,
    repoContext,
    projectConfig,
    topLevelStatePath,
  };
  return {
    base,
    prNumber,
    prDetails,
    unaddressedComments,
    ctx,
  };
}

/**
 * Executes the PR review Plan phase: reads existing plan, runs PR review plan agent.
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function executePRReviewPlanPhase(config: PRReviewWorkflowConfig): Promise<{ planOutput: string; costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const { prNumber, prDetails, unaddressedComments, ctx } = config;
  const { issueNumber, adwId, worktreePath, logsDir, orchestratorStatePath, repoContext } = config.base;
  const phaseStartTime = Date.now();
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

  const planResult = await runPrReviewPlanAgent(prDetails, unaddressedComments, existingPlanContent, logsDir, planAgentStatePath, worktreePath, prDetails.body, config.base.installContext);

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

  const modelUsage = planResult.modelUsage ?? emptyModelUsageMap();
  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'pr_review_plan',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return {
    planOutput: planResult.output,
    costUsd: planResult.totalCostUsd ?? 0,
    modelUsage,
    phaseCostRecords,
  };
}

/**
 * Executes the PR review Build phase: runs PR review build agent.
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function executePRReviewBuildPhase(config: PRReviewWorkflowConfig, planOutput: string): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const { prNumber, prDetails, unaddressedComments, ctx } = config;
  const { issueNumber, adwId, worktreePath, logsDir, orchestratorStatePath, repoContext } = config.base;
  const phaseStartTime = Date.now();
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

  const modelUsage = buildResult.modelUsage ?? emptyModelUsageMap();
  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'pr_review_build',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return {
    costUsd: buildResult.totalCostUsd ?? 0,
    modelUsage,
    phaseCostRecords,
  };
}

/**
 * Executes the PR review commit+push phase: commits changes, pushes the branch.
 * Extracted from completePRReviewWorkflow to be a discrete, visible phase.
 */
export async function executePRReviewCommitPushPhase(config: PRReviewWorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const { prNumber, prDetails, ctx } = config;
  const { issueNumber, adwId, worktreePath, logsDir, repoContext } = config.base;
  const phaseStartTime = Date.now();

  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_committing', ctx);
  }
  const issueType = inferIssueTypeFromBranch(prDetails.headBranch);
  const commitResult = await runCommitAgent(OrchestratorId.PrReview, issueType, JSON.stringify(prDetails), logsDir, undefined, worktreePath, prDetails.body);

  pushBranch(prDetails.headBranch, worktreePath);
  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_pushed', ctx);
  }

  // Transition issue to Review status now that the PR changes are pushed
  if (repoContext && config.base.issueNumber) {
    try {
      await repoContext.issueTracker.moveToStatus(config.base.issueNumber, BoardStatus.Review);
      log(`Issue #${config.base.issueNumber} moved to Review`, 'success');
    } catch (error) {
      log(`Failed to move issue #${config.base.issueNumber} to Review: ${error}`, 'error');
    }
  }

  const modelUsage = commitResult.modelUsage ?? emptyModelUsageMap();
  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'pr_review_commit_push',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return { costUsd: commitResult.totalCostUsd ?? 0, modelUsage, phaseCostRecords };
}

// Backward-compatible re-exports from prReviewCompletion
export {
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
} from './prReviewCompletion';
