/**
 * KPI phase execution for workflows.
 * Uses the /track_agentic_kpis skill via a Claude agent.
 * Non-fatal: errors are caught and logged without blocking workflow completion.
 */

import {
  log,
  AgentStateManager,
  type ModelUsageMap,
  emptyModelUsageMap,
} from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import {
  getPlanFilePath,
  runKpiAgent,
} from '../agents';
import { commitAndPushKpiFile } from '../vcs';
import type { WorkflowConfig } from './workflowInit';

/**
 * Executes the KPI phase: track agentic KPIs for the current workflow run.
 * This phase is non-fatal — errors are caught and logged, never thrown.
 *
 * @param config - Workflow configuration
 * @param reviewRetries - Number of review-patch retry iterations
 */
export async function executeKpiPhase(
  config: WorkflowConfig,
  reviewRetries?: number,
): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const { orchestratorStatePath, adwId, issueNumber, issueType, issue, worktreePath, logsDir } = config;
  const phaseStartTime = Date.now();

  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  log('Phase: KPI Tracking', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting KPI tracking phase');

  try {
    const kpiAgentStatePath = AgentStateManager.initializeState(adwId, 'kpi-agent', orchestratorStatePath);
    AgentStateManager.writeState(kpiAgentStatePath, {
      adwId,
      issueNumber,
      agentName: 'kpi-agent',
      execution: AgentStateManager.createExecutionState('running'),
    });

    const allAdws: string[] = ['adw_plan_iso'];
    for (let i = 0; i < (reviewRetries ?? 0); i++) {
      allAdws.push('adw_patch_iso');
    }

    const planFile = getPlanFilePath(issueNumber, worktreePath);

    const result = await runKpiAgent(
      adwId,
      logsDir,
      issueNumber,
      issueType,
      planFile,
      allAdws,
      kpiAgentStatePath,
      worktreePath,
      issue.body,
    );

    costUsd = result.totalCostUsd || 0;
    if (result.modelUsage) modelUsage = result.modelUsage;

    if (!result.success) {
      AgentStateManager.writeState(kpiAgentStatePath, {
        execution: AgentStateManager.completeExecution(
          AgentStateManager.createExecutionState('running'),
          false,
          result.output,
        ),
      });
      log(`KPI Agent failed: ${result.output}`, 'warn');
      AgentStateManager.appendLog(orchestratorStatePath, `KPI tracking failed: ${result.output}`);
      return { costUsd, modelUsage, phaseCostRecords: [] };
    }

    AgentStateManager.writeState(kpiAgentStatePath, {
      output: result.output.substring(0, 1000),
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        true,
      ),
    });

    commitAndPushKpiFile();

    AgentStateManager.appendLog(orchestratorStatePath, 'KPI tracking completed');
    log('KPI phase completed', 'success');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`KPI phase error (non-fatal): ${errorMsg}`, 'warn');
    AgentStateManager.appendLog(orchestratorStatePath, `KPI tracking error: ${errorMsg}`);
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'kpi',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    continuationCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return { costUsd, modelUsage, phaseCostRecords };
}
