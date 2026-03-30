/**
 * Test phase execution for workflows.
 *
 * Runs unit tests only (opt-in). BDD scenario execution has moved to the
 * Review phase where step definitions are guaranteed to exist.
 *
 * - Unit tests run only when `.adw/project.md` has `## Unit Tests: enabled`.
 * - When unit tests are disabled, the phase passes immediately.
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
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { postIssueStageComment } from './phaseCommentHelpers';
import {
  runUnitTestsWithRetry,
} from '../agents';
import type { WorkflowConfig } from './workflowInit';
import { BoardStatus } from '../providers/types';

/**
 * Executes the Test phase: optionally run unit tests (unit tests only).
 *
 * Unit tests are skipped when `.adw/project.md` has `## Unit Tests: disabled`
 * (or the indicator is absent — disabled is the default).
 *
 * BDD scenarios are now run in the Review phase after step definitions are generated.
 *
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function executeTestPhase(config: WorkflowConfig): Promise<{
  costUsd: number;
  modelUsage: ModelUsageMap;
  unitTestsPassed: boolean;
  totalRetries: number;
  phaseCostRecords: PhaseCostRecord[];
}> {
  const { orchestratorStatePath, issueNumber, issue, ctx, logsDir, worktreePath, repoContext, projectConfig, adwId } = config;
  const phaseStartTime = Date.now();
  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();
  let totalRetries = 0;
  let phaseContextResetCount = 0;

  if (repoContext) {
    await repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.InProgress);
  }

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
      onCompactionDetected: (continuationNumber) => {
        ctx.tokenContinuationNumber = continuationNumber;
        log(`Test phase: context compacted, spawning continuation #${continuationNumber}`, 'info');
        AgentStateManager.appendLog(orchestratorStatePath, `Test phase context compacted (continuation ${continuationNumber})`);
        if (repoContext) {
          postIssueStageComment(repoContext, issueNumber, 'test_compaction_recovery', ctx);
        }
      },
    });
    costUsd += unitTestsResult.costUsd;
    modelUsage = mergeModelUsageMaps(modelUsage, unitTestsResult.modelUsage);
    totalRetries += unitTestsResult.totalRetries;
    phaseContextResetCount = unitTestsResult.contextResetCount;

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

    log('Unit tests passed!', 'success');
    AgentStateManager.appendLog(orchestratorStatePath, 'Unit tests passed');
  } else {
    log('Unit tests disabled — skipping', 'info');
    AgentStateManager.appendLog(orchestratorStatePath, 'Unit tests disabled — skipping');
  }

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'test',
    status: PhaseCostStatus.Success,
    retryCount: totalRetries,
    contextResetCount: phaseContextResetCount,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  if (config.phaseState) {
    config.phaseState.test.unitTestsPassed = true;
    config.phaseState.test.totalRetries = totalRetries;
  }

  return {
    costUsd,
    modelUsage,
    unitTestsPassed: true,
    totalRetries,
    phaseCostRecords,
  };
}
