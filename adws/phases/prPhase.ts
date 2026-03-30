/**
 * PR creation phase for workflows.
 * Generates PR title/body via the /pull_request skill, then programmatically
 * pushes the branch and creates the PR via CodeHost.createMergeRequest().
 */

import {
  log,
  shouldExecuteStage,
  hasUncommittedChanges,
  type ModelUsageMap,
  emptyModelUsageMap,
} from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { postIssueStageComment } from './phaseCommentHelpers';
import {
  getPlanFilePath,
  runCommitAgent,
  runPullRequestAgent,
} from '../agents';
import { pushBranch } from '../vcs';
import { getDefaultBranch } from '../vcs/branchOperations';
import { BoardStatus } from '../providers/types';
import type { WorkflowConfig } from './workflowInit';

/**
 * Executes the PR phase: generate PR title/body via agent, push branch, create PR via CodeHost.
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function executePRPhase(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const { recoveryState, issueNumber, issue, issueType, ctx, worktreePath, logsDir, adwId, branchName, repoContext } = config;
  const phaseStartTime = Date.now();

  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  // Safety net: commit any uncommitted changes before PR creation
  if (hasUncommittedChanges(worktreePath)) {
    log('Uncommitted changes detected, committing before PR creation...', 'info');
    await runCommitAgent('pre-pr-commit', issueType, JSON.stringify(issue), logsDir, undefined, worktreePath, issue.body);
    log('Pre-PR commit completed', 'success');
  }

  if (shouldExecuteStage('pr_created', recoveryState)) {
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'pr_creating', ctx);
    }
    log('Creating Pull Request...', 'info');

    const planFile = getPlanFilePath(issueNumber, worktreePath);
    const currentBranch = ctx.branchName || branchName || '';

    const repoOwner = repoContext?.repoId.owner ?? '';
    const repoName = repoContext?.repoId.repo ?? '';

    const result = await runPullRequestAgent(
      currentBranch,
      JSON.stringify(issue),
      planFile,
      adwId,
      logsDir,
      undefined,
      worktreePath,
      issue.body,
      repoOwner,
      repoName,
    );

    costUsd = result.totalCostUsd || 0;
    if (result.modelUsage) modelUsage = result.modelUsage;

    if (repoContext) {
      // Push branch and create PR programmatically via the provider
      const { prContent } = result;
      pushBranch(currentBranch, worktreePath);
      const defaultBranch = getDefaultBranch(worktreePath);
      const prResult = repoContext.codeHost.createPullRequest({
        title: prContent.title,
        body: prContent.body,
        sourceBranch: currentBranch,
        targetBranch: defaultBranch,
        linkedIssueNumber: issueNumber,
      });
      ctx.prUrl = prResult.url;
      ctx.prNumber = prResult.number;
      if (config.phaseState) {
        config.phaseState.pr.prUrl = prResult.url;
        config.phaseState.pr.prNumber = prResult.number;
      }

      postIssueStageComment(repoContext, issueNumber, 'pr_created', ctx);
      log(`Pull Request created: ${prResult.url}`, 'success');

      // Transition issue to Review status now that the PR is open
      try {
        await repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.Review);
        log(`Issue #${issueNumber} moved to Review`, 'success');
      } catch (error) {
        log(`Failed to move issue #${issueNumber} to Review: ${error}`, 'error');
      }
    } else {
      // No repoContext — log agent output for diagnostics
      log(`PR content generated (no repoContext to create PR): ${result.prContent.title}`, 'info');
    }
  } else {
    log('Skipping PR creation (already completed)', 'info');
  }

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'pr',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return { costUsd, modelUsage, phaseCostRecords };
}
