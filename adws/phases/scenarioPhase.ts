/**
 * Scenario phase execution for workflows.
 * Uses the /scenario_writer skill via a Claude agent.
 * Non-fatal: errors are caught and logged without blocking workflow completion.
 */

import {
  log,
  AgentStateManager,
  shouldExecuteStage,
  type ModelUsageMap,
  emptyModelUsageMap,
} from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { runScenarioAgent } from '../agents';
import type { WorkflowConfig } from './workflowInit';

/**
 * Executes the Scenario phase: generate and maintain BDD scenarios for the current issue.
 * This phase is non-fatal — errors are caught and logged, never thrown.
 *
 * @param config - Workflow configuration
 */
export async function executeScenarioPhase(
  config: WorkflowConfig,
): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const { recoveryState, orchestratorStatePath, adwId, issueNumber, issue, worktreePath, logsDir } = config;

  if (!shouldExecuteStage('plan_validating', recoveryState)) {
    log('Skipping scenario phase (already completed in previous run)', 'info');
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  const phaseStartTime = Date.now();

  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  log('Phase: Scenario Planning', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting scenario planning phase');

  try {
    const scenarioAgentStatePath = AgentStateManager.initializeState(adwId, 'scenario-agent', orchestratorStatePath);
    AgentStateManager.writeState(scenarioAgentStatePath, {
      adwId,
      issueNumber,
      agentName: 'scenario-agent',
      execution: AgentStateManager.createExecutionState('running'),
    });

    const result = await runScenarioAgent(issue, logsDir, scenarioAgentStatePath, worktreePath, adwId, config.installContext);

    costUsd = result.totalCostUsd || 0;
    if (result.modelUsage) modelUsage = result.modelUsage;

    if (!result.success) {
      AgentStateManager.writeState(scenarioAgentStatePath, {
        execution: AgentStateManager.completeExecution(
          AgentStateManager.createExecutionState('running'),
          false,
          result.output,
        ),
      });
      log(`Scenario Agent failed: ${result.output}`, 'warn');
      AgentStateManager.appendLog(orchestratorStatePath, `Scenario planning failed: ${result.output}`);
      return { costUsd, modelUsage, phaseCostRecords: [] };
    }

    AgentStateManager.writeState(scenarioAgentStatePath, {
      output: result.output.substring(0, 1000),
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        true,
      ),
    });

    AgentStateManager.appendLog(orchestratorStatePath, 'Scenario planning completed');
    log('Scenario phase completed', 'success');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Scenario phase error (non-fatal): ${errorMsg}`, 'warn');
    AgentStateManager.appendLog(orchestratorStatePath, `Scenario planning error: ${errorMsg}`);
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'scenario',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return { costUsd, modelUsage, phaseCostRecords };
}
