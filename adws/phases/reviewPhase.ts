/**
 * Does not run tests, start a dev server, navigate the application, or invoke prepare_app.
 *
 * The patch+retest retry loop is orchestrator-level (see executeReviewPatchCycle).
 */

import {
  log,
  AgentStateManager,
  emptyModelUsageMap,
  mergeModelUsageMaps,
  type ModelUsageMap,
} from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { runReviewAgent, type ReviewIssue } from '../agents/reviewAgent';
import { runCommitAgent } from '../agents/gitAgent';
import { applyPatchBlocker, applyRefactorBlockers } from './reviewPatchHelpers';
import { getPlanFilePath } from '../agents/planAgent';
import type { CodeHost, IssueTracker, RepoContext } from '@paysdoc/devplatform';
import type { WorkflowConfig } from './workflowInit';
import { requireWorkflowGitContext } from './workflowRepoIdentity';
import { postIssueStageComment } from './phaseCommentHelpers';
import { extractPrNumber } from '../adwBuildHelpers';

export type { ReviewIssue };

// The promotion rot/reuse advisory (executePromotionRotAdvisory) lives in the
// sibling promotionRotAdvisory.ts to keep this file under the 300-line
// guideline; re-exported here since reviewPhase.ts is this feature's home.
export { executePromotionRotAdvisory } from './promotionRotAdvisory';

/** A code host that refuses the capability probe by name is a code host that cannot approve. */
function canApprove(codeHost: CodeHost): boolean {
  try {
    return codeHost.canApprovePullRequests();
  } catch {
    return false;
  }
}

/** The issue label a human applies to hold a merge for review — read live, never from the workflow-start snapshot. */
const HITL_LABEL = 'hitl';

/**
 * A tracker that refuses the
 * label read by name answers `true`: a gate that cannot be consulted is a
 * gate that holds, so the review never approves past a human it cannot see.
 */
function issueHasHitlLabel(issueTracker: IssueTracker, issueNumber: number): boolean {
  try {
    return issueTracker.fetchLabels(issueNumber).includes(HITL_LABEL);
  } catch (error) {
    log(`Could not read labels on issue #${issueNumber} (non-fatal to review); not approving: ${error}`, 'warn');
    return true;
  }
}

/**
 * Mirrors adwChore's pre-approval: the label is read live
 * from the tracker at approval time. Approval failure is non-fatal — the review
 * still counts as passed — and so is a refused capability probe (a forge that
 * cannot express approval cannot approve).
 */
function approvePullRequestAfterReviewPass(repoContext: RepoContext, issueNumber: number, prUrl: string): void {
  if (!canApprove(repoContext.codeHost)) return;
  const prNumber = extractPrNumber(prUrl);
  if (!prNumber) return;
  if (issueHasHitlLabel(repoContext.issueTracker, issueNumber)) {
    log(`Review: skipping approval of PR #${prNumber} — issue #${issueNumber} has hitl label`, 'info');
    return;
  }
  log('Approving PR after review pass...', 'info');
  const approveResult = repoContext.codeHost.approvePullRequest(prNumber);
  if (!approveResult.success) {
    log(`PR approval failed (non-fatal to review): ${approveResult.error}`, 'warn');
    return;
  }
  log(`PR #${prNumber} approved`, 'success');
}

/**
 * Returns immediately — retries are handled by the calling orchestrator via executeReviewPatchCycle.
 *
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

  const agentStatePath = AgentStateManager.initializeState(adwId, 'review-agent', orchestratorStatePath);
  const reviewAgentResult = await runReviewAgent(
    adwId,
    specFile,
    logsDir,
    agentStatePath,
    worktreePath,
    issue.body,
    scenarioProofPath || undefined,
    config.gitContext?.commandEnv(),
    { selfHost: !repoContext, adwId, gitContext: config.gitContext },
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

    if (ctx.prUrl && repoContext) {
      approvePullRequestAfterReviewPass(repoContext, issueNumber, ctx.prUrl);
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
 * Called by the orchestrator-level review retry loop when a review returns
 * blockers. After this returns, the orchestrator re-runs scenarioTestPhase
 * then re-runs executeReviewPhase.
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
    repoContext,
  } = config;

  const gitCtx = requireWorkflowGitContext(config);

  const phaseStartTime = Date.now();
  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  const specFile = getPlanFilePath(issueNumber, worktreePath);

  const patchBlockers = blockerIssues.filter(b => (b.remediationStrategy ?? 'patch') === 'patch');
  const refactorBlockers = blockerIssues.filter(b => b.remediationStrategy === 'refactor');

  log(`Review patch cycle: ${patchBlockers.length} patch blocker(s), ${refactorBlockers.length} refactor blocker(s)`, 'info');
  AgentStateManager.appendLog(
    orchestratorStatePath,
    `Review patch cycle: ${patchBlockers.length} patch, ${refactorBlockers.length} refactor blocker(s)`,
  );

  const subprocessEnv = gitCtx.commandEnv();
  const launchContext = { selfHost: !repoContext, adwId, gitContext: gitCtx };

  for (const blocker of patchBlockers) {
    const result = await applyPatchBlocker(blocker, {
      adwId, logsDir, specFile, worktreePath, issue, orchestratorStatePath, subprocessEnv, launchContext,
    });
    costUsd += result.costUsd;
    modelUsage = mergeModelUsageMaps(modelUsage, result.modelUsage);
  }

  if (refactorBlockers.length > 0) {
    const result = await applyRefactorBlockers(refactorBlockers, {
      adwId, logsDir, worktreePath, issue, orchestratorStatePath, subprocessEnv, launchContext,
    });
    costUsd += result.costUsd;
    modelUsage = mergeModelUsageMaps(modelUsage, result.modelUsage);
  }

  await runCommitAgent(
    'review-patch-agent',
    issueType,
    issue.body,
    logsDir,
    AgentStateManager.initializeState(adwId, 'review-patch', orchestratorStatePath),
    worktreePath,
    issue.body,
    subprocessEnv,
    launchContext,
  );
  gitCtx.pushBranch(branchName, worktreePath);
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
