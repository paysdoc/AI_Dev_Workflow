/**
 * Test phase execution for workflows.
 *
 * New order: [Unit Tests (opt-in)] → BDD Scenarios → PR
 *
 * - Unit tests run only when `.adw/project.md` has `## Unit Tests: enabled`.
 * - BDD scenarios tagged `@adw-{issueNumber}` always run (skipped gracefully
 *   when the command is `N/A`).
 */

import {
  log,
  AgentStateManager,
  MAX_TEST_RETRY_ATTEMPTS,
  type ModelUsageMap,
  emptyModelUsageMap,
  mergeModelUsageMaps,
  parseUnitTestsEnabled,
} from '../core';
import { postIssueStageComment } from './phaseCommentHelpers';
import {
  runUnitTestsWithRetry,
  runBddScenariosWithRetry,
} from '../agents';
import type { WorkflowConfig } from './workflowLifecycle';

/**
 * Executes the Test phase: optionally run unit tests, then run BDD scenarios.
 *
 * Unit tests are skipped when `.adw/project.md` has `## Unit Tests: disabled`
 * (or the indicator is absent — disabled is the default).
 *
 * BDD scenarios are run using the command from `config.projectConfig.commands.runScenariosByTag`.
 * When the command is `N/A`, scenarios are skipped gracefully and the phase passes.
 *
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function executeTestPhase(config: WorkflowConfig): Promise<{
  costUsd: number;
  modelUsage: ModelUsageMap;
  unitTestsPassed: boolean;
  bddScenariosPassed: boolean;
  totalRetries: number;
}> {
  const { orchestratorStatePath, issueNumber, issue, ctx, logsDir, worktreePath, repoContext, projectConfig } = config;
  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();
  let totalRetries = 0;

  // --- Unit tests gate (opt-in) ---
  const unitTestsEnabled = parseUnitTestsEnabled(projectConfig.projectMd);

  if (unitTestsEnabled) {
    log('Phase: Unit Tests', 'info');
    AgentStateManager.appendLog(orchestratorStatePath, 'Starting test phase: Unit Tests');

    const unitTestsResult = await runUnitTestsWithRetry({
      logsDir,
      orchestratorStatePath,
      maxRetries: MAX_TEST_RETRY_ATTEMPTS,
      cwd: worktreePath,
      issueBody: issue.body,
    });
    costUsd += unitTestsResult.costUsd;
    modelUsage = mergeModelUsageMaps(modelUsage, unitTestsResult.modelUsage);
    totalRetries += unitTestsResult.totalRetries;

    if (!unitTestsResult.passed) {
      const errorMsg = 'Unit tests failed after maximum retry attempts. No PR was created.';
      log(errorMsg, 'error');
      AgentStateManager.appendLog(orchestratorStatePath, errorMsg);
      ctx.errorMessage = errorMsg;
      if (repoContext) {
        postIssueStageComment(repoContext, issueNumber, 'error', ctx);
      }

      AgentStateManager.writeState(orchestratorStatePath, {
        execution: AgentStateManager.completeExecution(
          AgentStateManager.createExecutionState('running'),
          false,
          errorMsg
        ),
        metadata: { totalCostUsd: costUsd, unitTestsPassed: false },
      });
      process.exit(1);
    }
  } else {
    log('Unit tests disabled — skipping', 'info');
    AgentStateManager.appendLog(orchestratorStatePath, 'Unit tests disabled — skipping');
  }

  // --- BDD scenarios gate (always runs) ---
  log('Phase: BDD Scenarios', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, `Starting test phase: BDD Scenarios @adw-${issueNumber}`);

  const scenarioCommand = projectConfig.commands.runScenariosByTag;
  const bddResult = await runBddScenariosWithRetry({
    logsDir,
    orchestratorStatePath,
    maxRetries: MAX_TEST_RETRY_ATTEMPTS,
    cwd: worktreePath,
    issueBody: issue.body,
    tagCommand: scenarioCommand,
    issueNumber,
  });
  costUsd += bddResult.costUsd;
  modelUsage = mergeModelUsageMaps(modelUsage, bddResult.modelUsage);
  totalRetries += bddResult.totalRetries;

  if (!bddResult.passed) {
    const errorMsg = 'BDD scenarios failed after maximum retry attempts. No PR was created.';
    log(errorMsg, 'error');
    AgentStateManager.appendLog(orchestratorStatePath, errorMsg);
    ctx.errorMessage = errorMsg;
    if (repoContext) {
      postIssueStageComment(repoContext, issueNumber, 'error', ctx);
    }

    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        false,
        errorMsg
      ),
      metadata: { totalCostUsd: costUsd, unitTestsPassed: true, bddScenariosPassed: false },
    });
    process.exit(1);
  }

  log('All tests passed!', 'success');
  AgentStateManager.appendLog(orchestratorStatePath, 'All tests passed');

  return {
    costUsd,
    modelUsage,
    unitTestsPassed: true,
    bddScenariosPassed: true,
    totalRetries,
  };
}
