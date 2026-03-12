/**
 * Build phase execution for workflows.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  log,
  AgentStateManager,
  shouldExecuteStage,
  MAX_TOKEN_CONTINUATIONS,
  RUNNING_TOKENS,
  type ModelUsageMap,
  emptyModelUsageMap,
  mergeModelUsageMaps,
} from '../core';
import { computeDisplayTokens } from '../core/tokenManager';
import { postIssueStageComment } from './phaseCommentHelpers';
import {
  getPlanFilePath,
  runBuildAgent,
  runCommitAgent,
  type ProgressCallback,
  type ProgressInfo,
} from '../agents';
import type { WorkflowConfig } from './workflowLifecycle';
import { buildContinuationPrompt } from './planPhase';

/**
 * Executes the Build phase: read plan, run build agent, commit implementation.
 * Includes token limit recovery: when the agent approaches the token limit,
 * it is gracefully terminated, progress is saved, and a new agent is spawned
 * with context from the previous run. Repeats up to MAX_TOKEN_CONTINUATIONS times.
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function executeBuildPhase(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap }> {
  const { recoveryState, orchestratorStatePath, orchestratorName, adwId, issueNumber, issue, issueType, ctx, worktreePath, logsDir, repoContext } = config;

  // Read plan content
  const planPath = path.join(worktreePath, getPlanFilePath(issueNumber, worktreePath));
  let planContent: string;
  try {
    planContent = fs.readFileSync(planPath, 'utf-8');
    log(`Plan loaded from: ${planPath}`, 'success');
  } catch (error) {
    throw new Error(`Cannot read plan file at ${planPath}: ${error}`);
  }

  // Build agent step
  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();
  const currentBranch = ctx.branchName || '';

  if (shouldExecuteStage('implemented', recoveryState)) {
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'implementing', ctx);
    }
    log('Running Build Agent...', 'info');

    let currentPlanContent = planContent;
    let continuationNumber = 0;
    let buildCompleted = false;

    while (continuationNumber <= MAX_TOKEN_CONTINUATIONS && !buildCompleted) {
      const buildAgentStatePath = AgentStateManager.initializeState(adwId, 'build-agent', orchestratorStatePath);
      AgentStateManager.writeState(buildAgentStatePath, {
        adwId,
        issueNumber,
        branchName: currentBranch,
        planFile: planPath,
        issueClass: issueType,
        agentName: 'build-agent',
        parentAgent: orchestratorName,
        execution: AgentStateManager.createExecutionState('running'),
      });

      let lastProgressUpdate = Date.now();
      const PROGRESS_UPDATE_INTERVAL_MS = 60000;

      const buildProgressCallback: ProgressCallback = (info: ProgressInfo) => {
        ctx.buildProgress = {
          turnCount: info.turnCount || 0,
          toolCount: info.toolCount || 0,
          lastToolName: info.toolName,
          lastText: info.text,
        };

        if (info.type === 'tool_use') {
          log(`  [Turn ${info.turnCount}] Tool: ${info.toolName}`, 'info');
        }

        const now = Date.now();
        if (now - lastProgressUpdate >= PROGRESS_UPDATE_INTERVAL_MS) {
          if (repoContext) {
            postIssueStageComment(repoContext, issueNumber, 'build_progress', ctx);
          }
          lastProgressUpdate = now;
        }
      };

      const buildResult = await runBuildAgent(issue, logsDir, currentPlanContent, buildProgressCallback, buildAgentStatePath, worktreePath);

      // Accumulate cost and model usage across continuations
      costUsd += buildResult.totalCostUsd || 0;
      if (buildResult.modelUsage) {
        modelUsage = mergeModelUsageMaps(modelUsage, buildResult.modelUsage);
      }

      // Update running token total so next build_progress comment reflects current usage
      if (RUNNING_TOKENS && config.totalModelUsage) {
        const combinedUsage = mergeModelUsageMaps(config.totalModelUsage, modelUsage);
        ctx.runningTokenTotal = computeDisplayTokens(combinedUsage);
      }

      if (buildResult.tokenLimitExceeded) {
        continuationNumber++;
        log(`Build agent hit token limit (continuation ${continuationNumber}/${MAX_TOKEN_CONTINUATIONS})`, 'info');

        // Save partial state
        AgentStateManager.writeState(buildAgentStatePath, {
          output: buildResult.output.substring(0, 1000),
          metadata: { tokenUsage: buildResult.tokenUsage },
          execution: AgentStateManager.completeExecution(
            AgentStateManager.createExecutionState('running'),
            true
          ),
        });
        AgentStateManager.appendLog(orchestratorStatePath, `Build agent hit token limit (continuation ${continuationNumber})`);

        if (continuationNumber > MAX_TOKEN_CONTINUATIONS) {
          throw new Error(`Build agent exceeded maximum token continuations (${MAX_TOKEN_CONTINUATIONS}). Last partial output: ${buildResult.output.substring(0, 500)}`);
        }

        // Post recovery comment
        ctx.tokenContinuationNumber = continuationNumber;
        ctx.tokenUsage = buildResult.tokenUsage;
        if (repoContext) {
          postIssueStageComment(repoContext, issueNumber, 'token_limit_recovery', ctx);
        }

        // Build continuation prompt with previous output
        currentPlanContent = buildContinuationPrompt(planContent, buildResult.output);
        continue;
      }

      if (!buildResult.success) {
        AgentStateManager.writeState(buildAgentStatePath, {
          execution: AgentStateManager.completeExecution(
            AgentStateManager.createExecutionState('running'),
            false,
            buildResult.output
          ),
        });
        throw new Error(`Build Agent failed: ${buildResult.output}`);
      }

      // Agent completed successfully
      AgentStateManager.writeState(buildAgentStatePath, {
        output: buildResult.output.substring(0, 1000),
        execution: AgentStateManager.completeExecution(
          AgentStateManager.createExecutionState('running'),
          true
        ),
      });

      ctx.buildOutput = buildResult.output;
      buildCompleted = true;
    }

    AgentStateManager.appendLog(orchestratorStatePath, 'Build completed');
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'implemented', ctx);
    }
  } else {
    log('Skipping Build Agent (already completed)', 'info');
  }

  // Commit implementation step
  if (shouldExecuteStage('implementation_committing', recoveryState)) {
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'implementation_committing', ctx);
    }
    await runCommitAgent('build-agent', issueType, JSON.stringify(issue), logsDir, undefined, worktreePath, issue.body);
  } else {
    log('Skipping implementation commit (already completed)', 'info');
  }

  return { costUsd, modelUsage };
}
