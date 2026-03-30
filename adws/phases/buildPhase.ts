/**
 * Build phase execution for workflows.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  log,
  AgentStateManager,
  shouldExecuteStage,
  RUNNING_TOKENS,
  emptyModelUsageMap,
  mergeModelUsageMaps,
} from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord, computeDisplayTokens } from '../cost';
import { postIssueStageComment } from './phaseCommentHelpers';
import {
  getPlanFilePath,
  runBuildAgent,
  runCommitAgent,
  type ProgressCallback,
  type ProgressInfo,
} from '../agents';
import type { WorkflowConfig } from './workflowInit';
import { buildContinuationPrompt } from './planPhase';
import { BoardStatus } from '../providers/types';
import type { PhaseResult } from '../core/phaseRunner';

/**
 * Executes the Build phase: read plan, run build agent, commit implementation.
 *
 * Token-limit continuation is handled externally by runPhaseWithContinuation().
 * When config.continuationPrompt is set, it is used as the plan content for this
 * invocation instead of reading the plan file. On tokenLimitExceeded or
 * compactionDetected, returns early with token-limit signal fields so the runner
 * can invoke buildPhaseOnTokenLimit() and re-run this phase.
 */
export async function executeBuildPhase(config: WorkflowConfig): Promise<PhaseResult & { phaseCostRecords: PhaseCostRecord[] }> {
  const { recoveryState, orchestratorStatePath, orchestratorName, adwId, issueNumber, issue, issueType, ctx, worktreePath, logsDir, repoContext } = config;
  const phaseStartTime = Date.now();

  if (repoContext) {
    await repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.InProgress);
  }

  // Read plan content: use continuation prompt if set, otherwise read from file
  let currentPlanContent: string;
  if (config.continuationPrompt) {
    currentPlanContent = config.continuationPrompt;
    log('Using continuation prompt as plan content', 'info');
  } else {
    const planPath = path.join(worktreePath, getPlanFilePath(issueNumber, worktreePath));
    try {
      currentPlanContent = fs.readFileSync(planPath, 'utf-8');
      log(`Plan loaded from: ${planPath}`, 'success');
    } catch (error) {
      throw new Error(`Cannot read plan file at ${planPath}: ${error}`);
    }
  }

  // Build agent step
  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();
  const currentBranch = ctx.branchName || '';

  if (shouldExecuteStage('build_completed', recoveryState)) {
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'build_running', ctx);
    }
    log('Running Build Agent (scenario detection delegated to build agent)...', 'info');

    const buildAgentStatePath = AgentStateManager.initializeState(adwId, 'build-agent', orchestratorStatePath);
    AgentStateManager.writeState(buildAgentStatePath, {
      adwId,
      issueNumber,
      branchName: currentBranch,
      planFile: path.join(worktreePath, getPlanFilePath(issueNumber, worktreePath)),
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

      // Update running token total with real-time extractor estimates during streaming
      if (RUNNING_TOKENS && info.tokenEstimate && Object.keys(info.tokenEstimate).length > 0) {
        let totalInput = 0;
        let totalOutput = 0;
        const modelBreakdown: Array<{ model: string; total: number }> = [];

        for (const [model, usage] of Object.entries(info.tokenEstimate)) {
          const input = usage['input'] ?? 0;
          const output = usage['output'] ?? 0;
          totalInput += input;
          totalOutput += output;
          if (input + output > 0) {
            modelBreakdown.push({ model, total: input + output });
          }
        }

        // Add previous phases' accumulated usage if available
        if (config.totalModelUsage) {
          for (const usage of Object.values(config.totalModelUsage)) {
            totalInput += usage.inputTokens;
            totalOutput += usage.outputTokens;
          }
        }

        ctx.runningTokenTotal = {
          inputTokens: totalInput,
          outputTokens: totalOutput,
          cacheCreationTokens: 0,
          total: totalInput + totalOutput,
          isEstimated: true,
          modelBreakdown: modelBreakdown.sort((a, b) => b.total - a.total),
        };
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

    // Accumulate cost and model usage for this invocation
    costUsd += buildResult.totalCostUsd || 0;
    if (buildResult.modelUsage) {
      modelUsage = mergeModelUsageMaps(modelUsage, buildResult.modelUsage);
    }

    // Log estimate-vs-actual comparison at phase completion
    if (buildResult.costSource === 'extractor_finalized' && buildResult.estimatedUsage && buildResult.actualUsage) {
      const estimated = buildResult.estimatedUsage;
      const actual = buildResult.actualUsage;
      const allModels = new Set([...Object.keys(estimated), ...Object.keys(actual)]);

      for (const model of allModels) {
        const est = estimated[model] ?? {};
        const act = actual[model] ?? {};
        const tokenTypes: Array<[string, string]> = [['input', 'input'], ['output', 'output'], ['cache_read', 'cache_read'], ['cache_write', 'cache_write']];

        const parts: string[] = [];
        for (const [key, label] of tokenTypes) {
          const estVal = est[key] ?? 0;
          const actVal = act[key] ?? 0;
          if (estVal === 0 && actVal === 0) continue;
          const diff = actVal - estVal;
          const pct = estVal > 0 ? ((diff / estVal) * 100).toFixed(1) : 'N/A';
          const sign = diff >= 0 ? '+' : '';
          parts.push(`${label}: ${estVal.toLocaleString()} estimated → ${actVal.toLocaleString()} actual (${sign}${pct}%)`);
        }

        if (parts.length > 0) {
          log(`Estimate vs actual [${model}]: ${parts.join(', ')}`, 'info');
        }
      }
    } else if (buildResult.costSource === 'extractor_estimated') {
      log('Build agent cost is from streaming estimates only (no result message received).', 'info');
    }

    // Update running token total so next build_progress comment reflects current usage (now actual)
    if (RUNNING_TOKENS && config.totalModelUsage) {
      const combinedUsage = mergeModelUsageMaps(config.totalModelUsage, modelUsage);
      ctx.runningTokenTotal = computeDisplayTokens(combinedUsage);
    }

    if (buildResult.tokenLimitExceeded) {
      log('Build agent hit token limit — returning token-limit signal to runner', 'info');
      AgentStateManager.writeState(buildAgentStatePath, {
        output: buildResult.output.substring(0, 1000),
        metadata: { tokenUsage: buildResult.tokenUsage },
        execution: AgentStateManager.completeExecution(
          AgentStateManager.createExecutionState('running'),
          true
        ),
      });
      AgentStateManager.appendLog(orchestratorStatePath, 'Build agent hit token limit');

      const phaseCostRecords = createPhaseCostRecords({
        workflowId: adwId,
        issueNumber,
        phase: 'build',
        status: PhaseCostStatus.Success,
        retryCount: 0,
        contextResetCount: 0,
        durationMs: Date.now() - phaseStartTime,
        modelUsage,
      });

      return {
        costUsd,
        modelUsage,
        phaseCostRecords,
        tokenLimitExceeded: true,
        tokenLimitReason: 'token_limit',
        previousOutput: buildResult.output,
        tokenUsage: buildResult.tokenUsage,
      };
    }

    if (buildResult.compactionDetected) {
      log('Build agent context compacted — returning compaction signal to runner', 'info');
      AgentStateManager.writeState(buildAgentStatePath, {
        output: buildResult.output.substring(0, 1000),
        metadata: { compactionDetected: true },
        execution: AgentStateManager.completeExecution(
          AgentStateManager.createExecutionState('running'),
          true
        ),
      });
      AgentStateManager.appendLog(orchestratorStatePath, 'Build agent context compacted');

      const phaseCostRecords = createPhaseCostRecords({
        workflowId: adwId,
        issueNumber,
        phase: 'build',
        status: PhaseCostStatus.Success,
        retryCount: 0,
        contextResetCount: 0,
        durationMs: Date.now() - phaseStartTime,
        modelUsage,
      });

      return {
        costUsd,
        modelUsage,
        phaseCostRecords,
        tokenLimitExceeded: true,
        tokenLimitReason: 'compaction',
        previousOutput: buildResult.output,
      };
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

    AgentStateManager.appendLog(orchestratorStatePath, 'Build completed');
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'build_completed', ctx);
    }
  } else {
    log('Skipping Build Agent (already completed)', 'info');
  }

  // Commit implementation step
  if (shouldExecuteStage('build_committing', recoveryState)) {
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'build_committing', ctx);
    }
    await runCommitAgent('build-agent', issueType, JSON.stringify(issue), logsDir, undefined, worktreePath, issue.body);
  } else {
    log('Skipping implementation commit (already completed)', 'info');
  }

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'build',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return { costUsd, modelUsage, phaseCostRecords };
}

/**
 * onTokenLimit callback for executeBuildPhase.
 *
 * Reads the original plan from the spec file and builds a continuation prompt
 * that includes the previous agent's output so the next invocation can resume
 * from where the previous agent left off.
 *
 * Wire this into orchestrators via:
 *   runPhaseWithContinuation(config, tracker, executeBuildPhase, buildPhaseOnTokenLimit)
 */
export function buildPhaseOnTokenLimit(config: WorkflowConfig, result: PhaseResult): string {
  const planPath = path.join(config.worktreePath, getPlanFilePath(config.issueNumber, config.worktreePath));
  const planContent = fs.readFileSync(planPath, 'utf-8');
  const reason = result.tokenLimitReason ?? 'token_limit';
  return buildContinuationPrompt(planContent, result.previousOutput ?? '', reason);
}
