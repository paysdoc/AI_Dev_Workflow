/**
 * Shared test retry logic for unit tests.
 * Used by the adwTest.tsx workflow.
 */

import { log, AgentStateManager, type ModelUsageMap, mergeModelUsageMaps, emptyModelUsageMap, persistTokenCounts } from '../core';
import { retryWithResolution, initAgentState } from '../core/retryOrchestrator';
import {
  runTestAgent,
  runResolveTestAgent,
  TestResult,
  type TestAgentResult,
} from './testAgent';

export interface TestRetryResult {
  passed: boolean;
  costUsd: number;
  totalRetries: number;
  failedTests: string[];
  modelUsage: ModelUsageMap;
  contextResetCount: number;
}

export interface TestRetryOptions {
  logsDir: string;
  orchestratorStatePath: string;
  maxRetries: number;
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
 * @param opts - Test retry options including logsDir, retry limits, and optional cwd for external repos.
 * @returns The test result including pass/fail status, cost, retry count, and failed test names.
 */
export async function runUnitTestsWithRetry(opts: TestRetryOptions): Promise<TestRetryResult> {
  const { logsDir, orchestratorStatePath: statePath, maxRetries, onTestFailed, onCompactionDetected, cwd, issueBody } = opts;

  const result = await retryWithResolution<TestAgentResult, TestResult>({
    maxRetries,
    statePath,
    label: 'unit tests',
    run: () => runTestAgent(logsDir, initAgentState(statePath, 'test-agent'), cwd, issueBody),
    isPassed: (r) => r.allPassed,
    extractFailures: (r) => r.failedTests,
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

        // Propagate compaction so retryWithResolution can handle it (only when opted in)
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

  return {
    passed: result.passed,
    costUsd: result.costUsd,
    totalRetries: result.totalRetries,
    failedTests: result.failures.map(t => t.test_name),
    modelUsage: result.modelUsage,
    contextResetCount: result.contextResetCount,
  };
}
