import * as fs from 'fs';
import * as path from 'path';
import {
  log,
  AgentStateManager,
  MAX_TEST_RETRY_ATTEMPTS,
  type LogLevel,
  type ModelUsageMap,
  emptyModelUsageMap,
  mergeModelUsageMaps,
  computeTestVerdict,
  ADW_UNVERIFIED_LABEL,
} from '../core';
import { runStaticChecks, runShellCommand, CheckStatus, type CheckVerdict, type ProcessRunner } from '../core/checkRunner';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { postIssueStageComment } from './phaseCommentHelpers';
import {
  runUnitTestsWithRetry,
} from '../agents';
import type { WorkflowConfig } from './workflowInit';
import { workflowLaunchContext } from './workflowRepoIdentity';
import { BoardStatus } from '@paysdoc/devplatform';
import { reportStackCoherence } from './stackCoherenceReporter';

export interface UnitTestPhaseDeps {
  readonly runProcess: ProcessRunner;
  readonly runUnitTestsWithRetry: typeof runUnitTestsWithRetry;
}

interface TestRunOutcome {
  readonly costUsd: number;
  readonly modelUsage: ModelUsageMap;
  readonly totalRetries: number;
  readonly contextResetCount: number;
}

function recordLine(statePath: string, message: string, level: LogLevel): void {
  log(message, level);
  AgentStateManager.appendLog(statePath, message);
}

function describeFailedCheck(verdict: CheckVerdict): string {
  return `${verdict.check} (exit ${verdict.exitCode ?? 'none'})`;
}

function logCheckVerdict(statePath: string, verdict: CheckVerdict): void {
  if (verdict.status === CheckStatus.Skipped) {
    recordLine(statePath, `Static check skipped (N/A): ${verdict.check}`, 'info');
    return;
  }
  if (verdict.status === CheckStatus.Passed) {
    recordLine(statePath, `Static check passed: ${verdict.check} — ${verdict.command}`, 'success');
    return;
  }
  recordLine(statePath, `Static check failed: ${describeFailedCheck(verdict)} — ${verdict.command}`, 'error');
  recordLine(statePath, verdict.output.trim() === '' ? '(no output)' : verdict.output.trimEnd(), 'error');
}

function endRunOnFailedGate(config: WorkflowConfig, errorMsg: string, costUsd: number): never {
  const { orchestratorStatePath, issueNumber, ctx, repoContext } = config;
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

/** The error names the failed checks and their exit codes; their output stays in the run log. */
async function runStaticCheckGate(config: WorkflowConfig, runProcess: ProcessRunner): Promise<void> {
  const statePath = config.orchestratorStatePath;
  log('Phase: Static Checks', 'info');
  AgentStateManager.appendLog(statePath, 'Starting test phase: Static Checks');

  const verdicts = await runStaticChecks(config.projectConfig.commands, config.worktreePath, runProcess);
  verdicts.forEach(verdict => logCheckVerdict(statePath, verdict));

  const failed = verdicts.filter(verdict => verdict.status === CheckStatus.Failed);
  if (failed.length === 0) return;
  endRunOnFailedGate(config, `Static checks failed: ${failed.map(describeFailedCheck).join(', ')}. No PR was created.`, 0);
}

function recordTestCompaction(config: WorkflowConfig, continuationNumber: number): void {
  const { orchestratorStatePath, issueNumber, ctx, repoContext } = config;
  ctx.tokenContinuationNumber = continuationNumber;
  log(`Test phase: context compacted, spawning continuation #${continuationNumber}`, 'info');
  AgentStateManager.appendLog(orchestratorStatePath, `Test phase context compacted (continuation ${continuationNumber})`);
  if (repoContext) {
    postIssueStageComment(repoContext, issueNumber, 'test_compaction_recovery', ctx);
  }
}

function markUnitTestsUnverified(config: WorkflowConfig, reason: string): void {
  const { orchestratorStatePath, issueNumber, ctx, repoContext } = config;
  const warnMsg = `Unit tests unverified: ${reason}`;
  log(warnMsg, 'warn');
  AgentStateManager.appendLog(orchestratorStatePath, warnMsg);
  // Marking unverified is advisory metadata — it must never crash the
  // workflow. App-token auth lacks label-write permission ("Resource not
  // accessible by integration"), so applyLabel can throw; swallow it,
  // mirroring stackCoherenceReporter.
  try {
    if (repoContext) {
      repoContext.issueTracker.applyLabel(issueNumber, ADW_UNVERIFIED_LABEL);
      postIssueStageComment(repoContext, issueNumber, 'unverified', ctx);
    } else {
      log('Unit test phase: no repo context — adw:unverified not applied', 'warn');
    }
  } catch (e) {
    log(`Failed to mark unit tests unverified (non-fatal): ${e}`, 'error');
  }
}

async function runUnitTestSuite(
  config: WorkflowConfig,
  runTests: UnitTestPhaseDeps['runUnitTestsWithRetry'] = runUnitTestsWithRetry,
): Promise<TestRunOutcome> {
  const { orchestratorStatePath, issue, logsDir, worktreePath } = config;
  log('Phase: Unit Tests', 'info');
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting test phase: Unit Tests');

  const unitReportPath = path.join(logsDir, 'junit-unit.xml');
  process.env.ADW_UNIT_TEST_REPORT_PATH = unitReportPath;
  fs.rmSync(unitReportPath, { force: true });

  const unitTestsResult = await runTests({
    logsDir,
    orchestratorStatePath,
    maxRetries: MAX_TEST_RETRY_ATTEMPTS,
    unitReportPath,
    runTestsCommand: config.projectConfig.commands.runTests ?? 'bun run test:unit',
    cwd: worktreePath,
    issueBody: issue.body,
    launchContext: workflowLaunchContext(config),
    onCompactionDetected: (continuationNumber) => recordTestCompaction(config, continuationNumber),
  });

  const { reportPresent, hasFailures, testcaseCount } = unitTestsResult;
  const verdictResult = computeTestVerdict({
    enabled: true,
    reportPresent,
    hasFailures,
    testcaseCount,
  });

  if (verdictResult.verdict === 'hard-fail') {
    endRunOnFailedGate(config, `Unit tests hard-failed: ${verdictResult.reason}. No PR was created.`, unitTestsResult.costUsd);
  }

  if (verdictResult.verdict === 'warn') {
    markUnitTestsUnverified(config, verdictResult.reason);
  } else {
    log('Unit tests passed!', 'success');
    AgentStateManager.appendLog(orchestratorStatePath, 'Unit tests passed');
  }

  return {
    costUsd: unitTestsResult.costUsd,
    modelUsage: mergeModelUsageMaps(emptyModelUsageMap(), unitTestsResult.modelUsage),
    totalRetries: unitTestsResult.totalRetries,
    contextResetCount: unitTestsResult.contextResetCount,
  };
}

function skipUnitTestRun(config: WorkflowConfig): TestRunOutcome {
  recordLine(config.orchestratorStatePath, 'Unit tests disabled — skipping the test run', 'info');
  return { costUsd: 0, modelUsage: emptyModelUsageMap(), totalRetries: 0, contextResetCount: 0 };
}

/**
 * The static checks always run first, and a red check ends the run. `unitTests: false` in
 * `.github/adw.yml` (opt-out, default enabled) skips only the unit-test run that follows them.
 */
export async function executeUnitTestPhase(config: WorkflowConfig, deps: Partial<UnitTestPhaseDeps> = {}): Promise<{
  costUsd: number;
  modelUsage: ModelUsageMap;
  unitTestsPassed: boolean;
  totalRetries: number;
  phaseCostRecords: PhaseCostRecord[];
}> {
  const { issueNumber, repoContext, adwYmlConfig, adwId } = config;
  const phaseStartTime = Date.now();

  if (repoContext) {
    await repoContext.issueTracker.moveToStatus(issueNumber, BoardStatus.InProgress);
  }

  reportStackCoherence(config);

  await runStaticCheckGate(config, deps.runProcess ?? runShellCommand);

  const testRun = adwYmlConfig.unitTests
    ? await runUnitTestSuite(config, deps.runUnitTestsWithRetry)
    : skipUnitTestRun(config);

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'test',
    status: PhaseCostStatus.Success,
    retryCount: testRun.totalRetries,
    contextResetCount: testRun.contextResetCount,
    durationMs: Date.now() - phaseStartTime,
    modelUsage: testRun.modelUsage,
  });

  return {
    costUsd: testRun.costUsd,
    modelUsage: testRun.modelUsage,
    unitTestsPassed: true,
    totalRetries: testRun.totalRetries,
    phaseCostRecords,
  };
}
