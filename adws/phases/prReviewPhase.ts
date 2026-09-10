/**
 * PR review workflow phases.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log, setLogAdwId, ensureLogsDirectory, AgentStateManager, type AgentState, type ModelUsageMap, allocateRandomPort, emptyModelUsageMap, OrchestratorId, type TargetRepoInfo, ensureTargetRepoWorkspace, loadProjectConfig, readAdwYmlConfig, type IssueClassSlashCommand, type RecoveryState, bindWorkspaceContext, type LaunchBoundary, readUnaddressedComments } from '../core';
import type { Issue, PullRequest, ReviewComment, RepoContext } from '../providers/types';
import type { PRReviewWorkflowContext } from '../forge/workflowCommentsPR';
import { buildUnaddressedCommentReads } from '../forge/prCommentDetector';
import type { WorkflowConfig } from './workflowInit';
import { requireWorkflowGitContext } from './workflowRepoIdentity';
import { inferIssueTypeFromBranch } from '../vcs';
import { BoardStatus } from '../providers/types';
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
  prDetails: PullRequest;
  unaddressedComments: ReviewComment[];
  ctx: PRReviewWorkflowContext;
}

/**
 * Initializes a PR review workflow: fetches PR details, checks for unaddressed
 * comments, sets up worktree, and initializes state.
 * @param prNumber - The PR number to review
 * @param adwId - The ADW workflow ID
 * @param boundary - The launch boundary this process was built for
 */
export async function initializePRReviewWorkflow(prNumber: number, adwId: string, boundary: LaunchBoundary, targetRepo?: TargetRepoInfo): Promise<PRReviewWorkflowConfig> {
  const codeHost = boundary.providers.codeHost;
  const pr = codeHost.fetchPullRequest(prNumber);
  log(`Fetched PR: ${pr.title}`, 'success');
  const resolvedAdwId = adwId;
  setLogAdwId(resolvedAdwId);
  log('===================================', 'info');
  log('PR Review Orchestrator', 'info');
  log(`PR: #${prNumber}`, 'info');
  log(`ADW ID: ${resolvedAdwId}`, 'info');
  log('===================================', 'info');
  if (pr.state === 'CLOSED' || pr.state === 'MERGED') {
    log(`PR #${prNumber} is ${pr.state}, skipping`, 'info');
    process.exit(0);
  }
  const unaddressedComments = readUnaddressedComments(prNumber, buildUnaddressedCommentReads(boundary));
  // A genuine resume means a prior PR-review run recorded phases for this adwId.
  // A fresh trigger-seed (from resolvePrReviewSpawn) writes branchName but no phases,
  // so it must NOT bypass the empty-comments early-exit.
  const existingState = AgentStateManager.readTopLevelState(resolvedAdwId);
  const isResumeMode = existingState?.phases !== undefined && Object.keys(existingState.phases).length > 0;
  if (unaddressedComments.length === 0 && !isResumeMode) {
    log(`No unaddressed review comments on PR #${prNumber}, exiting`, 'info');
    process.exit(0);
  }
  log(`Found ${unaddressedComments.length} unaddressed review comment(s)`, 'info');
  const logsDir = ensureLogsDirectory(resolvedAdwId);
  const issueNumber = pr.linkedIssueNumber ?? null;
  const orchestratorStatePath = AgentStateManager.initializeState(resolvedAdwId, OrchestratorId.PrReview);
  log(`State: ${orchestratorStatePath}`, 'info');
  const initialState: Partial<AgentState> = {
    adwId: resolvedAdwId,
    issueNumber,
    branchName: pr.sourceBranch,
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
    branchName: pr.sourceBranch,
  };
  if (targetRepo) {
    log(`Setting up target repo workspace for ${targetRepo.owner}/${targetRepo.repo}...`, 'info');
    ensureTargetRepoWorkspace(targetRepo, () => boundary.providers.codeHost.getDefaultBranch());
    log(`Target repo workspace ready`, 'success');
  }
  const gitCtx = boundary.gitContext;
  const worktreePath = gitCtx.ensureWorktree(pr.sourceBranch);
  log(`Worktree path: ${worktreePath}`, 'info');

  // Allocate a random port for the dedicated dev server instance
  const port = await allocateRandomPort();
  const applicationUrl = `http://localhost:${port}`;
  log(`Allocated port ${port} for dev server (${applicationUrl})`, 'info');
  AgentStateManager.appendLog(orchestratorStatePath, `Allocated port ${port} for dev server`);

  // Create RepoContext for provider-agnostic operations
  let repoContext: RepoContext | undefined;
  try {
    repoContext = bindWorkspaceContext(boundary, worktreePath);
  } catch (error) {
    log(`Failed to create RepoContext (falling back to direct API calls): ${error}`, 'info');
  }

  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_starting', ctx);
  }

  const issueStub: Issue = {
    id: String(prNumber),
    number: prNumber,
    title: pr.title,
    body: pr.body,
    state: 'open',
    author: '',
    labels: [],
    comments: [],
    createdAt: '',
    url: pr.url ?? '',
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
  const adwYmlConfig = readAdwYmlConfig(worktreePath);
  const topLevelStatePath = AgentStateManager.getTopLevelStatePath(resolvedAdwId);
  const base: WorkflowConfig = {
    issueNumber: issueNumber ?? 0,
    adwId: resolvedAdwId,
    issue: issueStub,
    issueType: '/pr_review' as IssueClassSlashCommand,
    worktreePath,
    defaultBranch: pr.targetBranch,
    logsDir,
    orchestratorStatePath,
    orchestratorName: OrchestratorId.PrReview,
    recoveryState: defaultRecoveryState,
    ctx,
    branchName: pr.sourceBranch,
    applicationUrl,
    repoContext,
    projectConfig,
    adwYmlConfig,
    topLevelStatePath,
    gitContext: boundary.gitContext,
  };
  return {
    base,
    prNumber,
    prDetails: pr,
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
  const launchContext = { selfHost: !repoContext, adwId, gitContext: config.base.gitContext };
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
    branchName: prDetails.sourceBranch,
    agentName: 'pr-review-plan-agent',
    parentAgent: OrchestratorId.PrReview,
    execution: AgentStateManager.createExecutionState('running'),
    metadata: { prNumber, reviewComments: unaddressedComments.length },
  });

  const planResult = await runPrReviewPlanAgent(prDetails, unaddressedComments, existingPlanContent, logsDir, planAgentStatePath, worktreePath, prDetails.body, config.base.installContext, launchContext);

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
  const launchContext = { selfHost: !repoContext, adwId, gitContext: config.base.gitContext };
  const phaseStartTime = Date.now();
  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_implementing', ctx);
  }
  log('Running PR Review Build Agent...', 'info');

  const buildAgentStatePath = AgentStateManager.initializeState(adwId, 'pr-review-build-agent', orchestratorStatePath);
  AgentStateManager.writeState(buildAgentStatePath, {
    adwId,
    issueNumber,
    branchName: prDetails.sourceBranch,
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

  const buildResult = await runPrReviewBuildAgent(prDetails, planOutput, logsDir, buildProgressCallback, buildAgentStatePath, worktreePath, prDetails.body, config.base.gitContext?.commandEnv(), launchContext);

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
  const gitCtx = requireWorkflowGitContext(config.base);
  const phaseStartTime = Date.now();

  if (repoContext) {
    postPRStageComment(repoContext, prNumber, 'pr_review_committing', ctx);
  }
  const issueType = inferIssueTypeFromBranch(prDetails.sourceBranch);
  const commitResult = await runCommitAgent(OrchestratorId.PrReview, issueType, JSON.stringify(prDetails), logsDir, undefined, worktreePath, prDetails.body, gitCtx.commandEnv(), { selfHost: !repoContext, adwId, gitContext: gitCtx });

  gitCtx.pushBranch(prDetails.sourceBranch, worktreePath);
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
