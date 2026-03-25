/**
 * Single-pass alignment phase execution for workflows.
 *
 * Replaces the multi-round plan validation loop with a single agent invocation
 * that reads both the plan and BDD scenarios, resolves conflicts using the GitHub
 * issue as the sole source of truth, and flags unresolvable conflicts as inline
 * warnings in the plan rather than halting the workflow.
 */

import {
  log,
  AgentStateManager,
  shouldExecuteStage,
  type ModelUsageMap,
  emptyModelUsageMap,
  mergeModelUsageMaps,
} from "../core";
import { postIssueStageComment } from "./phaseCommentHelpers";
import {
  readPlanFile,
  getPlanFilePath,
  runCommitAgent,
  findScenarioFiles,
  runAlignmentAgent,
} from "../agents";
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from "../cost";
import type { WorkflowConfig } from "./workflowInit";

/**
 * Executes the single-pass Alignment phase: reads both plan and BDD scenarios,
 * resolves conflicts using the GitHub issue as truth, and flags unresolvable
 * conflicts as inline warnings in the plan. Never throws — unresolvable conflicts
 * are warnings, not errors.
 */
export async function executeAlignmentPhase(
  config: WorkflowConfig
): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const {
    recoveryState,
    orchestratorStatePath,
    adwId,
    issueNumber,
    issue,
    issueType,
    worktreePath,
    logsDir,
    repoContext,
    ctx,
  } = config;

  const phaseStartTime = Date.now();

  if (!shouldExecuteStage('plan_aligning', recoveryState)) {
    log('Skipping alignment phase (already completed in previous run)', 'info');
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  log("Phase: Single-Pass Alignment", "info");
  AgentStateManager.appendLog(orchestratorStatePath, "Starting single-pass alignment phase");

  // Step 1: Verify plan file exists
  const planContent = readPlanFile(issueNumber, worktreePath);
  if (!planContent) {
    const planPath = getPlanFilePath(issueNumber, worktreePath);
    log(`No plan file found at ${planPath}; skipping alignment phase.`, "info");
    AgentStateManager.appendLog(orchestratorStatePath, "Alignment phase skipped: no plan file found");
    const phaseCostRecords = createPhaseCostRecords({
      workflowId: adwId,
      issueNumber,
      phase: 'alignment',
      status: PhaseCostStatus.Success,
      retryCount: 0,
      continuationCount: 0,
      durationMs: Date.now() - phaseStartTime,
      modelUsage,
    });
    return { costUsd, modelUsage, phaseCostRecords };
  }

  const planFilePath = getPlanFilePath(issueNumber, worktreePath);

  // Step 2: Discover scenario files
  const scenarioPaths = findScenarioFiles(issueNumber, worktreePath);
  if (scenarioPaths.length === 0) {
    log(`No BDD scenario files tagged @adw-${issueNumber} found. Skipping alignment.`, "info");
    AgentStateManager.appendLog(orchestratorStatePath, "Alignment phase skipped: no scenario files found");
    const phaseCostRecords = createPhaseCostRecords({
      workflowId: adwId,
      issueNumber,
      phase: 'alignment',
      status: PhaseCostStatus.Success,
      retryCount: 0,
      continuationCount: 0,
      durationMs: Date.now() - phaseStartTime,
      modelUsage,
    });
    return { costUsd, modelUsage, phaseCostRecords };
  }
  log(`Found ${scenarioPaths.length} scenario file(s) for alignment`, "info");

  // Step 3: Post plan_aligning stage comment
  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, "plan_aligning", ctx);
  }

  // Step 4: Run alignment agent (single pass)
  const alignmentAgentStatePath = AgentStateManager.initializeState(adwId, "alignment-agent", orchestratorStatePath);
  AgentStateManager.writeState(alignmentAgentStatePath, {
    adwId,
    issueNumber,
    agentName: "alignment-agent",
    execution: AgentStateManager.createExecutionState("running"),
  });

  const alignmentResult = await runAlignmentAgent(
    adwId,
    issueNumber,
    planFilePath,
    worktreePath,
    JSON.stringify(issue),
    logsDir,
    alignmentAgentStatePath,
    worktreePath
  );
  costUsd += alignmentResult.totalCostUsd || 0;
  if (alignmentResult.modelUsage) {
    modelUsage = mergeModelUsageMaps(modelUsage, alignmentResult.modelUsage);
  }

  AgentStateManager.writeState(alignmentAgentStatePath, {
    output: alignmentResult.output.substring(0, 1000),
    metadata: {
      aligned: alignmentResult.alignmentResult.aligned,
      warningsCount: alignmentResult.alignmentResult.warnings.length,
      changesCount: alignmentResult.alignmentResult.changes.length,
    },
    execution: AgentStateManager.completeExecution(
      AgentStateManager.createExecutionState("running"),
      alignmentResult.success
    ),
  });

  // Step 5: Log results
  const { aligned, warnings, changes, summary } = alignmentResult.alignmentResult;

  if (changes.length > 0) {
    log(`Alignment made ${changes.length} change(s): ${changes.join('; ')}`, "info");
    AgentStateManager.appendLog(orchestratorStatePath, `Alignment changes: ${changes.join('; ')}`);
  }

  if (warnings.length > 0) {
    log(`Alignment flagged ${warnings.length} unresolvable conflict(s) as warnings: ${warnings.join('; ')}`, "warn");
    AgentStateManager.appendLog(orchestratorStatePath, `Alignment warnings: ${warnings.join('; ')}`);
  }

  AgentStateManager.appendLog(orchestratorStatePath, `Alignment summary: ${summary}`);
  log(`Alignment complete: aligned=${aligned}, changes=${changes.length}, warnings=${warnings.length}`, "success");

  // Step 6: Post plan_aligned stage comment
  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, "plan_aligned", ctx);
  }

  // Step 7: Commit updated artifacts if changes were made
  if (changes.length > 0) {
    log("Committing updated plan/scenario artifacts...", "info");
    await runCommitAgent("alignment-agent", issueType, JSON.stringify(issue), logsDir, undefined, worktreePath, issue.body);
  }

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'alignment',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    continuationCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return { costUsd, modelUsage, phaseCostRecords };
}
