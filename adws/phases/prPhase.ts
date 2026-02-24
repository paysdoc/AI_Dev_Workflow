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
import {
  postWorkflowComment,
} from '../github';
import {
  getPlanFilePath,
  runCommitAgent,
  runPullRequestAgent,
} from '../agents';
import type { WorkflowConfig } from './workflowLifecycle';

/**
 * Executes the PR phase: create pull request via the /pull_request skill.
 */
export async function executePRPhase(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap }> {
  const { recoveryState, issueNumber, issue, issueType, ctx, worktreePath, logsDir, adwId, branchName } = config;

  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  // Safety net: commit any uncommitted changes before PR creation
  if (hasUncommittedChanges(worktreePath)) {
    log('Uncommitted changes detected, committing before PR creation...', 'info');
    await runCommitAgent('pre-pr-commit', issueType, JSON.stringify(issue), logsDir, undefined, worktreePath);
    log('Pre-PR commit completed', 'success');
  }

  if (shouldExecuteStage('pr_created', recoveryState)) {
    postWorkflowComment(issueNumber, 'pr_creating', ctx);
    log('Creating Pull Request...', 'info');

    const planFile = getPlanFilePath(issueNumber, worktreePath);
    const currentBranch = ctx.branchName || branchName || '';

    const result = await runPullRequestAgent(
      currentBranch,
      JSON.stringify(issue),
      planFile,
      adwId,
      logsDir,
      undefined,
      worktreePath,
    );

    ctx.prUrl = result.prUrl;
    costUsd = result.totalCostUsd || 0;
    if (result.modelUsage) modelUsage = result.modelUsage;

    postWorkflowComment(issueNumber, 'pr_created', ctx);
    log(`Pull Request created: ${result.prUrl}`, 'success');
  } else {
    log('Skipping PR creation (already completed)', 'info');
  }

  return { costUsd, modelUsage };
}
