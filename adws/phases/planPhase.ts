/**
 * Plan phase execution for workflows.
 */

import {
  log,
  AgentStateManager,
  shouldExecuteStage,
  type ModelUsageMap,
  emptyModelUsageMap,
  OrchestratorId,
} from '../core';
import { postIssueStageComment } from './phaseCommentHelpers';
import {
  runPlanAgent,
  getPlanFilePath,
  planFileExists,
  readPlanFile,
  correctPlanFileNaming,
  runCommitAgent,
} from '../agents';
import type { WorkflowConfig } from './workflowLifecycle';
import { BoardStatus } from '../providers/types';

/**
 * Executes the Plan phase: classify issue, create branch, run plan agent, commit plan.
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function executePlanPhase(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap }> {
  const { recoveryState, orchestratorStatePath, orchestratorName, adwId, issueNumber, issue, issueType, ctx, worktreePath, logsDir, repoContext } = config;

  if (repoContext) {
    await repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.InProgress);
  }

  // Classify step
  if (shouldExecuteStage('classified', recoveryState)) {
    AgentStateManager.writeState(orchestratorStatePath, { issueClass: issueType });
    AgentStateManager.appendLog(orchestratorStatePath, `Issue classified as: ${issueType}`);
    ctx.issueType = issueType;
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'classified', ctx);
    }
  }

  // Branch was already created during initializeWorkflow()
  const currentBranch = ctx.branchName || config.branchName || recoveryState.branchName || '';
  if (shouldExecuteStage('branch_created', recoveryState)) {
    log(`Using branch: ${currentBranch}`, 'success');
    ctx.branchName = currentBranch;

    AgentStateManager.writeState(orchestratorStatePath, { branchName: currentBranch });
    AgentStateManager.appendLog(orchestratorStatePath, `Branch created: ${currentBranch}`);
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'branch_created', ctx);
    }
  } else {
    log('Skipping branch creation (already completed)', 'info');
    if (recoveryState.branchName) {
      ctx.branchName = recoveryState.branchName;
    }
  }

  // Plan agent step
  const planPath = getPlanFilePath(issueNumber, worktreePath);
  ctx.planPath = planPath;
  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  if (shouldExecuteStage('plan_created', recoveryState) && !planFileExists(issueNumber, worktreePath)) {
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'plan_building', ctx);
    }
    log('Running Plan Agent...', 'info');

    const planAgentStatePath = AgentStateManager.initializeState(adwId, 'plan-agent', orchestratorStatePath);
    AgentStateManager.writeState(planAgentStatePath, {
      adwId,
      issueNumber,
      branchName: currentBranch,
      issueClass: issueType,
      agentName: 'plan-agent',
      parentAgent: orchestratorName,
      execution: AgentStateManager.createExecutionState('running'),
    });

    const planResult = await runPlanAgent(issue, logsDir, issueType, planAgentStatePath, worktreePath, adwId);

    if (!planResult.success) {
      AgentStateManager.writeState(planAgentStatePath, {
        execution: AgentStateManager.completeExecution(
          AgentStateManager.createExecutionState('running'),
          false,
          planResult.output
        ),
      });
      throw new Error(`Plan Agent failed: ${planResult.output}`);
    }

    // Correct any swapped plan file naming before resolving the path
    correctPlanFileNaming(issueNumber, worktreePath);

    // Re-resolve the plan file path now that the plan agent has created the file
    const resolvedPlanPath = getPlanFilePath(issueNumber, worktreePath);
    ctx.planPath = resolvedPlanPath;

    AgentStateManager.writeState(planAgentStatePath, {
      planFile: resolvedPlanPath,
      output: planResult.output.substring(0, 1000),
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        true
      ),
    });

    AgentStateManager.writeState(orchestratorStatePath, { planFile: resolvedPlanPath });
    AgentStateManager.appendLog(orchestratorStatePath, `Plan created: ${resolvedPlanPath}`);

    // Read the plan file content for the issue comment summary
    const planFileContent = readPlanFile(issueNumber, worktreePath);
    if (!planFileContent) {
      log('Could not read plan file for summary, using agent output', 'info');
    }
    ctx.planOutput = planFileContent || planResult.output;
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'plan_created', ctx);
    }
    costUsd = planResult.totalCostUsd || 0;
    if (planResult.modelUsage) modelUsage = planResult.modelUsage;
  } else {
    log('Skipping Plan Agent (plan already exists or completed)', 'info');
  }

  // Commit plan step
  if (shouldExecuteStage('plan_committing', recoveryState)) {
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'plan_committing', ctx);
    }
    await runCommitAgent(OrchestratorId.Plan, issueType, JSON.stringify(issue), logsDir, undefined, worktreePath, issue.body);
  } else {
    log('Skipping plan commit (already completed)', 'info');
  }

  return { costUsd, modelUsage };
}

/** Maximum characters of previous output to include in a continuation prompt. */
export const MAX_CONTINUATION_OUTPUT_LENGTH = 5000;

/**
 * Builds a continuation prompt that includes the original plan and previous agent's output.
 */
export function buildContinuationPrompt(originalPlanContent: string, previousOutput: string): string {
  const truncatedOutput = previousOutput.length > MAX_CONTINUATION_OUTPUT_LENGTH
    ? previousOutput.slice(-MAX_CONTINUATION_OUTPUT_LENGTH)
    : previousOutput;

  return `${originalPlanContent}

## Continuation Context

The previous build agent was terminated because it approached the token usage limit.
Below is a summary of what the previous agent accomplished. Continue implementing
the plan from where the previous agent left off. Do NOT re-do work that was already completed.

<previous-agent-output>
${truncatedOutput}
</previous-agent-output>`;
}
