/**
 * PR creation phase for workflows.
 * Uses the /pull_request skill via a Claude agent.
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
import type { WorkflowConfig } from './workflowInit';

/**
 * Executes the PR phase: create pull request via the /pull_request skill.
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

    ctx.prUrl = result.prUrl;
    costUsd = result.totalCostUsd || 0;
    if (result.modelUsage) modelUsage = result.modelUsage;

    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'pr_created', ctx);
    }
    log(`Pull Request created: ${result.prUrl}`, 'success');
  } else {
    log('Skipping PR creation (already completed)', 'info');
  }

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'pr',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    continuationCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return { costUsd, modelUsage, phaseCostRecords };
}
