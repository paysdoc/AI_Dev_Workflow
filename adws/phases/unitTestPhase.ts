/**
 * Test phase execution for workflows.
 *
 * Runs unit tests only (opt-out). BDD scenario execution has moved to the
 * Review phase where step definitions are guaranteed to exist.
 *
 * - Unit tests run unless `.github/adw.yml` sets `unitTests: false` (opt-out).
 * - When unit tests are disabled, the phase passes immediately.
 * - Default (absent file, absent key, or malformed value): unit tests run.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  log,
  AgentStateManager,
  MAX_TEST_RETRY_ATTEMPTS,
  type ModelUsageMap,
  emptyModelUsageMap,
  mergeModelUsageMaps,
  computeTestVerdict,
} from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { postIssueStageComment } from './phaseCommentHelpers';
import {
  runUnitTestsWithRetry,
} from '../agents';
import type { WorkflowConfig } from './workflowInit';
import { BoardStatus } from '../providers/types';
import { applyLabel, ADW_UNVERIFIED_LABEL } from '../github/labelManager';
import { getRepoInfo } from '../github/githubApi';
import { reportStackCoherence } from './stackCoherenceReporter';

/**
 * Executes the Test phase: optionally run unit tests (unit tests only).
 *
 * Unit tests are skipped when `.github/adw.yml` has `unitTests: false` (opt-out).
 * Default when absent or key omitted: unit tests run (enabled).
 *
 * BDD scenarios are now run in the Review phase after step definitions are generated.
 *
 * Uses `config.repoInfo` for external repository API calls when targeting a different repo.
 */
export async function executeUnitTestPhase(config: WorkflowConfig): Promise<{
  costUsd: number;
  modelUsage: ModelUsageMap;
  unitTestsPassed: boolean;
  totalRetries: number;
  phaseCostRecords: PhaseCostRecord[];
}> {
  const { orchestratorStatePath, issueNumber, issue, ctx, logsDir, worktreePath, repoContext, adwYmlConfig, adwId } = config;
  const phaseStartTime = Date.now();
  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();
  let totalRetries = 0;
  let phaseContextResetCount = 0;

  if (repoContext) {
    await repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.InProgress);
  }

  reportStackCoherence(config);

  // --- Unit tests gate (opt-out; reads .github/adw.yml unitTests, default: enabled) ---
  const unitTestsEnabled = adwYmlConfig.unitTests;

  if (unitTestsEnabled) {
    log('Phase: Unit Tests', 'info');
    AgentStateManager.appendLog(orchestratorStatePath, 'Starting test phase: Unit Tests');

    const unitReportPath = path.join(logsDir, 'junit-unit.xml');
    process.env.ADW_UNIT_TEST_REPORT_PATH = unitReportPath;
    fs.rmSync(unitReportPath, { force: true });

    const unitTestsResult = await runUnitTestsWithRetry({
      logsDir,
      orchestratorStatePath,
      maxRetries: MAX_TEST_RETRY_ATTEMPTS,
      unitReportPath,
      runTestsCommand: config.projectConfig.commands.runTests ?? 'bun run test:unit',
      cwd: worktreePath,
      issueBody: issue.body,
      launchContext: { selfHost: !repoContext, adwId },
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

    const { reportPresent, hasFailures, testcaseCount } = unitTestsResult;
    const verdictResult = computeTestVerdict({
      enabled: true,
      reportPresent,
      hasFailures,
      testcaseCount,
    });

    if (verdictResult.verdict === 'hard-fail') {
      const errorMsg = `Unit tests hard-failed: ${verdictResult.reason}. No PR was created.`;
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

    if (verdictResult.verdict === 'warn') {
      const warnMsg = `Unit tests unverified: ${verdictResult.reason}`;
      log(warnMsg, 'warn');
      AgentStateManager.appendLog(orchestratorStatePath, warnMsg);
      // Marking unverified is advisory metadata — it must never crash the
      // workflow. App-token auth lacks label-write permission ("Resource not
      // accessible by integration"), so applyLabel can throw; swallow it,
      // mirroring stackCoherenceReporter.
      try {
        const repoInfo = config.targetRepo
          ? { owner: config.targetRepo.owner, repo: config.targetRepo.repo }
          : getRepoInfo();
        applyLabel(issueNumber, ADW_UNVERIFIED_LABEL, repoInfo);
        if (repoContext) {
          postIssueStageComment(repoContext, issueNumber, 'unverified', ctx);
        }
      } catch (e) {
        log(`Failed to mark unit tests unverified (non-fatal): ${e}`, 'error');
      }
    } else {
      log('Unit tests passed!', 'success');
      AgentStateManager.appendLog(orchestratorStatePath, 'Unit tests passed');
    }
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

  return {
    costUsd,
    modelUsage,
    unitTestsPassed: true,
    totalRetries,
    phaseCostRecords,
  };
}
