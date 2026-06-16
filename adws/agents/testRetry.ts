/**
 * Shared test retry logic for unit and E2E tests.
 * Used by both adwTest.tsx and adwPrReview.tsx workflows.
 */

import * as fs from 'fs';
import * as path from 'path';
import { log, AgentStateManager, type ModelUsageMap, mergeModelUsageMaps, emptyModelUsageMap, persistTokenCounts } from '../core';
import { retryWithResolution, initAgentState } from '../core/retryOrchestrator';
import { readJUnitReport, type TestReport } from '../core/testReportParser';
import {
  runTestAgent,
  runResolveTestAgent,
  testResultFromCase,
  type TestAgentResult,
} from './testAgent';

export interface TestRetryResult {
  passed: boolean;
  costUsd: number;
  totalRetries: number;
  failedTests: string[];
  modelUsage: ModelUsageMap;
  contextResetCount: number;
  testcaseCount: number;
  reportPresent: boolean;
  hasFailures: boolean;
}

export interface TestRetryOptions {
  logsDir: string;
  orchestratorStatePath: string;
  maxRetries: number;
  unitReportPath: string;
  runTestsCommand: string;
  onTestFailed?: (attempt: number, maxAttempts: number) => void;
  /** Called when a test resolution agent's context is compacted; continuation number is 1-based */
  onCompactionDetected?: (continuationNumber: number) => void;
  /** Optional working directory for agent operations (defaults to process.cwd()) */
  cwd?: string;
  /** Optional application URL for the dev server (e.g. http://localhost:12345) */
  applicationUrl?: string;
  /** Optional issue body for fast/cheap model selection */
  issueBody?: string;
}

/**
 * Runs unit tests with automatic retry and resolution attempts on failure.
 * Derives pass/fail from the JUnit report emitted to `unitReportPath`.
 */
export async function runUnitTestsWithRetry(opts: TestRetryOptions): Promise<TestRetryResult> {
  const {
    logsDir,
    orchestratorStatePath: statePath,
    maxRetries,
    unitReportPath,
    runTestsCommand,
    onTestFailed,
    onCompactionDetected,
    cwd,
    issueBody,
  } = opts;

  // Ensure the report directory exists and clear any stale report.
  fs.mkdirSync(path.dirname(unitReportPath), { recursive: true });
  fs.rmSync(unitReportPath, { force: true });

  // Object reference avoids TypeScript's let-variable narrowing loss through closures.
  const reportRef: { value: TestReport | null } = { value: null };

  const result = await retryWithResolution<TestAgentResult, ReturnType<typeof testResultFromCase>>({
    maxRetries,
    statePath,
    label: 'unit tests',
    run: async () => {
      // Clear stale report before each attempt.
      fs.rmSync(unitReportPath, { force: true });
      const r = await runTestAgent(logsDir, initAgentState(statePath, 'test-agent'), cwd, issueBody);
      reportRef.value = readJUnitReport(unitReportPath);
      return r;
    },
    // Only "report present with failures" is retryable; zero-testcase and absent exit
    // the loop so the phase can classify them accurately.
    isPassed: () => !(reportRef.value !== null && reportRef.value.failed > 0),
    extractFailures: () => {
      const report = reportRef.value;
      if (report === null) return [];
      return report.cases
        .filter(c => c.status === 'failed')
        .map(c => testResultFromCase(c, runTestsCommand));
    },
    onRetryFailed: onTestFailed,
    onCompactionDetected,
    resolveFailures: async (failures) => {
      let costUsd = 0;
      let modelUsage = emptyModelUsageMap();

      for (const failedTest of failures) {
        log(`Resolving: ${failedTest.test_name}`, 'info');
        AgentStateManager.appendLog(statePath, `Resolving failed test: ${failedTest.test_name}`);
        const resolveResult = await runResolveTestAgent(failedTest, logsDir, initAgentState(statePath, 'test-resolver-agent'), cwd, issueBody);
        costUsd += resolveResult.totalCostUsd || 0;
        if (resolveResult.modelUsage) modelUsage = mergeModelUsageMaps(modelUsage, resolveResult.modelUsage);
        persistTokenCounts(statePath, costUsd, modelUsage);

        if (onCompactionDetected && resolveResult.compactionDetected) {
          return { success: false, totalCostUsd: costUsd, modelUsage, compactionDetected: true };
        }

        const msg = resolveResult.success ? 'Resolution attempted for' : 'Failed to resolve';
        log(`${msg}: ${failedTest.test_name}`, resolveResult.success ? 'success' : 'error');
        AgentStateManager.appendLog(statePath, `${msg}: ${failedTest.test_name}`);
      }

      return { success: true, totalCostUsd: costUsd, modelUsage };
    },
  });

  const finalReport = reportRef.value;
  const reportPresent = finalReport !== null;
  const hasFailures = finalReport !== null && finalReport.failed > 0;
  const testcaseCount = finalReport?.total ?? 0;

  return {
    passed: result.passed,
    costUsd: result.costUsd,
    totalRetries: result.totalRetries,
    failedTests: result.failures.map(t => t.test_name),
    modelUsage: result.modelUsage,
    contextResetCount: result.contextResetCount,
    testcaseCount,
    reportPresent,
    hasFailures,
  };
}
