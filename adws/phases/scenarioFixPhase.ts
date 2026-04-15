/**
 * Scenario fix phase execution for workflows.
 *
 * Takes the failure list from a previous scenarioTestPhase run, invokes
 * runResolveScenarioAgent for each failed scenario tag, commits fixes, and returns.
 *
 * Intended to be called inside an orchestrator-level retry loop:
 *   scenarioTest → [scenarioFix → scenarioTest] × MAX_TEST_RETRY_ATTEMPTS
 */

import {
  log,
  AgentStateManager,
  emptyModelUsageMap,
  mergeModelUsageMaps,
  type ModelUsageMap,
} from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { runResolveScenarioAgent } from '../agents/testAgent';
import { runCommitAgent } from '../agents/gitAgent';
import { pushBranch } from '../vcs';
import type { ScenarioProofResult } from './scenarioProof';
import type { WorkflowConfig } from './workflowInit';

/**
 * Executes the Scenario Fix phase: resolves each failed scenario tag from a
 * previous scenarioTestPhase run, then commits and pushes all fixes.
 *
 * @param config - Workflow configuration
 * @param scenarioProof - The result of the previous scenarioTestPhase run
 */
export async function executeScenarioFixPhase(
  config: WorkflowConfig,
  scenarioProof: ScenarioProofResult,
): Promise<{
  costUsd: number;
  modelUsage: ModelUsageMap;
  phaseCostRecords: PhaseCostRecord[];
}> {
  const {
    orchestratorStatePath,
    issueNumber,
    adwId,
    issue,
    issueType,
    logsDir,
    worktreePath,
    branchName,
    applicationUrl,
  } = config;

  const phaseStartTime = Date.now();
  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  const failedTags = scenarioProof.tagResults.filter(r => !r.passed && !r.skipped);

  log(`Scenario fix phase: resolving ${failedTags.length} failed scenario tag(s)`, 'info');
  AgentStateManager.appendLog(
    orchestratorStatePath,
    `Scenario fix phase: ${failedTags.length} failed tag(s) to resolve`,
  );

  for (const tagResult of failedTags) {
    const failedE2ETest = {
      testName: tagResult.resolvedTag,
      status: 'failed' as const,
      error: tagResult.output || `Exit code: ${tagResult.exitCode ?? 'null'}`,
    };

    log(`Resolving failed scenario: ${tagResult.resolvedTag}`, 'info');
    AgentStateManager.appendLog(
      orchestratorStatePath,
      `Resolving failed scenario: ${tagResult.resolvedTag}`,
    );

    const resolveResult = await runResolveScenarioAgent(
      failedE2ETest,
      logsDir,
      AgentStateManager.initializeState(adwId, 'scenario-fix', orchestratorStatePath),
      worktreePath,
      applicationUrl,
      issue.body,
    );

    costUsd += resolveResult.totalCostUsd || 0;
    if (resolveResult.modelUsage) {
      modelUsage = mergeModelUsageMaps(modelUsage, resolveResult.modelUsage);
    }

    const msg = resolveResult.success
      ? `Resolved: ${tagResult.resolvedTag}`
      : `Failed to resolve: ${tagResult.resolvedTag}`;
    log(msg, resolveResult.success ? 'success' : 'error');
    AgentStateManager.appendLog(orchestratorStatePath, msg);
  }

  // Commit and push all fixes
  await runCommitAgent(
    'scenario-fix-agent',
    issueType,
    issue.body,
    logsDir,
    AgentStateManager.initializeState(adwId, 'scenario-fix', orchestratorStatePath),
    worktreePath,
    issue.body,
  );
  pushBranch(branchName, worktreePath);
  log('Scenario fix: changes committed and pushed', 'success');
  AgentStateManager.appendLog(orchestratorStatePath, 'Scenario fix: changes committed and pushed');

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'scenarioFix',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return { costUsd, modelUsage, phaseCostRecords };
}
