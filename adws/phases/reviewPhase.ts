/**
 * Review phase execution — passive judge.
 *
 * Receives the scenarioProofPath from the calling orchestrator (produced by
 * scenarioTestPhase), calls a single review agent to judge the proof against
 * issue requirements, and returns. Does not run tests, start a dev server,
 * navigate the application, or invoke prepare_app.
 *
 * The patch+retest retry loop is orchestrator-level (see executeReviewPatchCycle).
 */

import * as path from 'path';
import {
  log,
  AgentStateManager,
  emptyModelUsageMap,
  mergeModelUsageMaps,
  type ModelUsageMap,
} from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { runReviewAgent, type ReviewIssue } from '../agents/reviewAgent';
import { runPatchAgent } from '../agents/patchAgent';
import { runBuildAgent } from '../agents/buildAgent';
import { runCommitAgent } from '../agents/gitAgent';
import { pushBranch } from '../vcs';
import { getPlanFilePath } from '../agents/planAgent';
import type { WorkflowConfig } from './workflowInit';
import { postIssueStageComment } from './phaseCommentHelpers';

export type { ReviewIssue };

/**
 * Executes the Review phase as a passive judge.
 *
 * Calls a single review agent that reads the scenario proof file and judges
 * the implementation against the issue spec. Returns immediately — retries
 * are handled by the calling orchestrator via executeReviewPatchCycle.
 *
 * @param config - Workflow configuration
 * @param scenarioProofPath - Path to the scenario_proof.md file from scenarioTestPhase.
 *   When empty, the review agent falls through to Strategy B or code-diff review.
 */
export async function executeReviewPhase(
  config: WorkflowConfig,
  scenarioProofPath: string,
): Promise<{
  costUsd: number;
  modelUsage: ModelUsageMap;
  reviewPassed: boolean;
  reviewIssues: ReviewIssue[];
  totalRetries: number;
  phaseCostRecords: PhaseCostRecord[];
}> {
  const {
    orchestratorStatePath,
    issueNumber,
    issue,
    ctx,
    logsDir,
    worktreePath,
    adwId,
    repoContext,
  } = config;

  const phaseStartTime = Date.now();

  log('Phase: Review', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting review phase');

  const specFile = getPlanFilePath(issueNumber, worktreePath);

  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, 'review_running', ctx);
  }

  const agentStatePath = path.join('agents', adwId, 'review-agent');
  const reviewAgentResult = await runReviewAgent(
    adwId,
    specFile,
    logsDir,
    agentStatePath,
    worktreePath,
    issue.body,
    scenarioProofPath || undefined,
  );

  const costUsd = reviewAgentResult.totalCostUsd || 0;
  const modelUsage = reviewAgentResult.modelUsage ?? emptyModelUsageMap();
  const reviewPassed = reviewAgentResult.passed;
  const reviewIssues = reviewAgentResult.reviewResult?.reviewIssues ?? [];

  if (reviewPassed) {
    log('Review passed!', 'success');
    AgentStateManager.appendLog(orchestratorStatePath, 'Review passed');
    ctx.reviewSummary = reviewAgentResult.reviewResult?.reviewSummary;
    ctx.reviewIssues = reviewAgentResult.blockerIssues;
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'review_passed', ctx);
    }
  } else {
    const blockerCount = reviewAgentResult.blockerIssues.length;
    const errorMsg = `Review failed with ${blockerCount} blocker issue(s)`;
    log(errorMsg, 'error');
    AgentStateManager.appendLog(orchestratorStatePath, errorMsg);
    ctx.errorMessage = errorMsg;
    ctx.reviewIssues = reviewAgentResult.blockerIssues;
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'review_failed', ctx);
    }
  }

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'review',
    status: reviewPassed ? PhaseCostStatus.Success : PhaseCostStatus.Failed,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return {
    costUsd,
    modelUsage,
    reviewPassed,
    reviewIssues,
    totalRetries: 0,
    phaseCostRecords,
  };
}

/**
 * Executes one review patch cycle: patch each blocker → build → commit → push.
 *
 * Called by the orchestrator-level review retry loop when a review returns
 * blockers. After this returns, the orchestrator re-runs scenarioTestPhase
 * then re-runs executeReviewPhase.
 *
 * Follows the same compositional pattern as scenarioFixPhase.ts.
 */
export async function executeReviewPatchCycle(
  config: WorkflowConfig,
  blockerIssues: ReviewIssue[],
): Promise<{
  costUsd: number;
  modelUsage: ModelUsageMap;
  phaseCostRecords: PhaseCostRecord[];
}> {
  const {
    orchestratorStatePath,
    issueNumber,
    adwId,
    issue,
    issueType,
    logsDir,
    worktreePath,
    branchName,
  } = config;

  const phaseStartTime = Date.now();
  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  const specFile = getPlanFilePath(issueNumber, worktreePath);

  log(`Review patch cycle: resolving ${blockerIssues.length} blocker issue(s)`, 'info');
  AgentStateManager.appendLog(
    orchestratorStatePath,
    `Review patch cycle: ${blockerIssues.length} blocker(s) to resolve`,
  );

  for (const blockerIssue of blockerIssues) {
    log(`Patching blocker #${blockerIssue.reviewIssueNumber}: ${blockerIssue.issueDescription}`, 'info');
    AgentStateManager.appendLog(
      orchestratorStatePath,
      `Patching blocker #${blockerIssue.reviewIssueNumber}`,
    );

    const patchStatePath = path.join('agents', adwId, 'patch-agent');
    const patchResult = await runPatchAgent(
      adwId,
      blockerIssue,
      logsDir,
      specFile,
      undefined,
      patchStatePath,
      worktreePath,
      issue.body,
    );

    costUsd += patchResult.totalCostUsd || 0;
    if (patchResult.modelUsage) {
      modelUsage = mergeModelUsageMaps(modelUsage, patchResult.modelUsage);
    }

    const patchMsg = patchResult.success
      ? `Patched blocker #${blockerIssue.reviewIssueNumber}`
      : `Patch failed for blocker #${blockerIssue.reviewIssueNumber}`;
    log(patchMsg, patchResult.success ? 'success' : 'error');
    AgentStateManager.appendLog(orchestratorStatePath, patchMsg);

    if (patchResult.success) {
      const buildStatePath = path.join('agents', adwId, 'build-agent');
      const buildResult = await runBuildAgent(
        issue,
        logsDir,
        patchResult.output,
        undefined,
        buildStatePath,
        worktreePath,
      );

      costUsd += buildResult.totalCostUsd || 0;
      if (buildResult.modelUsage) {
        modelUsage = mergeModelUsageMaps(modelUsage, buildResult.modelUsage);
      }

      const buildMsg = buildResult.success
        ? `Built patch for blocker #${blockerIssue.reviewIssueNumber}`
        : `Build failed for blocker #${blockerIssue.reviewIssueNumber}`;
      log(buildMsg, buildResult.success ? 'success' : 'error');
      AgentStateManager.appendLog(orchestratorStatePath, buildMsg);
    }
  }

  // Commit and push all patch changes
  await runCommitAgent(
    'review-patch-agent',
    issueType,
    issue.body,
    logsDir,
    path.join('agents', adwId, 'review-patch'),
    worktreePath,
    issue.body,
  );
  pushBranch(branchName, worktreePath);
  log('Review patch: changes committed and pushed', 'success');
  AgentStateManager.appendLog(orchestratorStatePath, 'Review patch: changes committed and pushed');

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'reviewPatch',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return { costUsd, modelUsage, phaseCostRecords };
}
