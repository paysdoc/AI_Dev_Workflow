/**
 * Step Definition phase execution for workflows.
 * Uses the /generate_step_definitions skill via a Claude agent.
 * Non-fatal: errors are caught and logged without blocking workflow completion.
 */

import {
  log,
  AgentStateManager,
  type ModelUsageMap,
  emptyModelUsageMap,
} from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { runStepDefAgent } from '../agents';
import type { WorkflowConfig } from './workflowInit';

/**
 * Executes the Step Definition phase: generate step definitions for BDD scenarios,
 * remove ungeneratable scenarios, and post a warning comment listing removed scenarios.
 * This phase is non-fatal — errors are caught and logged, never thrown.
 *
 * @param config - Workflow configuration
 */
export async function executeStepDefPhase(
  config: WorkflowConfig,
): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const { orchestratorStatePath, adwId, issueNumber, issue, worktreePath, logsDir, repoContext } = config;
  const phaseStartTime = Date.now();

  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  log('Phase: Step Definition Generation', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting step definition generation phase');

  try {
    const stepDefAgentStatePath = AgentStateManager.initializeState(adwId, 'step-def-agent', orchestratorStatePath);
    AgentStateManager.writeState(stepDefAgentStatePath, {
      adwId,
      issueNumber,
      agentName: 'step-def-agent',
      execution: AgentStateManager.createExecutionState('running'),
    });

    const result = await runStepDefAgent(issueNumber, adwId, logsDir, stepDefAgentStatePath, worktreePath, issue.body, config.installContext);

    costUsd = result.totalCostUsd || 0;
    if (result.modelUsage) modelUsage = result.modelUsage;

    if (!result.success) {
      AgentStateManager.writeState(stepDefAgentStatePath, {
        execution: AgentStateManager.completeExecution(
          AgentStateManager.createExecutionState('running'),
          false,
          result.output,
        ),
      });
      log(`Step Def Agent failed: ${result.output}`, 'warn');
      AgentStateManager.appendLog(orchestratorStatePath, `Step definition generation failed: ${result.output}`);
      return { costUsd, modelUsage, phaseCostRecords: [] };
    }

    AgentStateManager.writeState(stepDefAgentStatePath, {
      output: result.output.substring(0, 1000),
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        true,
      ),
    });

    if (result.removedScenarios.length > 0 && repoContext) {
      const scenarioList = result.removedScenarios
        .map(s => `- **${s.scenarioName}** (\`${s.featureFile}\`): ${s.reason}`)
        .join('\n');
      const warningComment = [
        '⚠️ **Step Definition Generation: Scenarios Removed**',
        '',
        'The following scenarios could not have step definitions generated (runtime infrastructure required) and were removed from the feature files:',
        '',
        scenarioList,
        '',
        'These scenarios can be re-added once dynamic BDD testing infrastructure is in place.',
      ].join('\n');
      repoContext.issueTracker.commentOnIssue(issueNumber, warningComment);
    }

    AgentStateManager.appendLog(orchestratorStatePath, 'Step definition generation completed');
    log('Step definition phase completed', 'success');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Step definition phase error (non-fatal): ${errorMsg}`, 'warn');
    AgentStateManager.appendLog(orchestratorStatePath, `Step definition generation error: ${errorMsg}`);
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'step-def-gen',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    continuationCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return { costUsd, modelUsage, phaseCostRecords };
}
