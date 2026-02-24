/**
 * Test phase execution for workflows.
 */

import {
  log,
  AgentStateManager,
  MAX_TEST_RETRY_ATTEMPTS,
  type ModelUsageMap,
  emptyModelUsageMap,
  mergeModelUsageMaps,
} from '../core';
import {
  postWorkflowComment,
} from '../github';
import {
  runUnitTestsWithRetry,
  runE2ETestsWithRetry,
} from '../agents';
import type { WorkflowConfig } from './workflowLifecycle';

/**
 * Executes the Test phase: run unit tests and E2E tests with retry.
 */
export async function executeTestPhase(config: WorkflowConfig): Promise<{
  costUsd: number;
  modelUsage: ModelUsageMap;
  unitTestsPassed: boolean;
  e2eTestsPassed: boolean;
  totalRetries: number;
}> {
  const { orchestratorStatePath, issueNumber, ctx, logsDir, worktreePath, applicationUrl } = config;
  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  // Unit tests
  log('Phase: Unit Tests', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting test phase: Unit Tests');

  const unitTestsResult = await runUnitTestsWithRetry({
    logsDir,
    orchestratorStatePath,
    maxRetries: MAX_TEST_RETRY_ATTEMPTS,
    cwd: worktreePath,
  });
  costUsd += unitTestsResult.costUsd;
  modelUsage = mergeModelUsageMaps(modelUsage, unitTestsResult.modelUsage);

  if (!unitTestsResult.passed) {
    const errorMsg = 'Unit tests failed after maximum retry attempts. No PR was created.';
    log(errorMsg, 'error');
    AgentStateManager.appendLog(orchestratorStatePath, errorMsg);
    ctx.errorMessage = errorMsg;
    postWorkflowComment(issueNumber, 'error', ctx);

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

  // E2E tests
  log('Phase: E2E Tests', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting test phase: E2E Tests');

  const e2eTestsResult = await runE2ETestsWithRetry({
    logsDir,
    orchestratorStatePath,
    maxRetries: MAX_TEST_RETRY_ATTEMPTS,
    cwd: worktreePath,
    applicationUrl,
  });
  costUsd += e2eTestsResult.costUsd;
  modelUsage = mergeModelUsageMaps(modelUsage, e2eTestsResult.modelUsage);

  if (!e2eTestsResult.passed) {
    const errorMsg = 'E2E tests failed after maximum retry attempts. No PR was created.';
    log(errorMsg, 'error');
    AgentStateManager.appendLog(orchestratorStatePath, errorMsg);
    ctx.errorMessage = errorMsg;
    postWorkflowComment(issueNumber, 'error', ctx);

    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        false,
        errorMsg
      ),
      metadata: { totalCostUsd: costUsd, unitTestsPassed: true, e2eTestsPassed: false },
    });
    process.exit(1);
  }

  log('All tests passed!', 'success');
  AgentStateManager.appendLog(orchestratorStatePath, 'All tests passed');

  return {
    costUsd,
    modelUsage,
    unitTestsPassed: true,
    e2eTestsPassed: true,
    totalRetries: unitTestsResult.totalRetries + e2eTestsResult.totalRetries,
  };
}
