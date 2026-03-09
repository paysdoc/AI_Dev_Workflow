/**
 * Shared test retry logic for unit and E2E tests.
 * Used by both adwTest.tsx and adwPrReview.tsx workflows.
 */

import * as path from 'path';
import { log, AgentStateManager, type ModelUsageMap, mergeModelUsageMaps, emptyModelUsageMap, persistTokenCounts } from '../core';
import { retryWithResolution, initAgentState, trackCost, type AgentRunResult } from '../core/retryOrchestrator';
import {
  runTestAgent,
  runResolveTestAgent,
  runResolveE2ETestAgent,
  discoverE2ETestFiles,
  runPlaywrightE2ETests,
  isValidE2ETestResult,
  TestResult,
  E2ETestResult,
  type TestAgentResult,
} from './testAgent';

export interface TestRetryResult {
  passed: boolean;
  costUsd: number;
  totalRetries: number;
  failedTests: string[];
  modelUsage: ModelUsageMap;
}

export interface TestRetryOptions {
  logsDir: string;
  orchestratorStatePath: string;
  maxRetries: number;
  onTestFailed?: (attempt: number, maxAttempts: number) => void;
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
  const { logsDir, orchestratorStatePath: statePath, maxRetries, onTestFailed, cwd, issueBody } = opts;

  const result = await retryWithResolution<TestAgentResult, TestResult>({
    maxRetries,
    statePath,
    label: 'unit tests',
    run: () => runTestAgent(logsDir, initAgentState(statePath, 'test-agent'), cwd, issueBody),
    isPassed: (r) => r.allPassed,
    extractFailures: (r) => r.failedTests,
    onRetryFailed: onTestFailed,
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
  };
}

/**
 * Runs E2E tests with automatic retry and resolution attempts on failure.
 * Discovers Playwright spec files, runs them, and resolves failures with AI agents.
 * @param opts - Test retry options including logsDir, retry limits, optional cwd and applicationUrl for external repos.
 * @returns The test result including pass/fail status, cost, retry count, and failed test names.
 */
export async function runE2ETestsWithRetry(opts: TestRetryOptions): Promise<TestRetryResult> {
  const { logsDir, orchestratorStatePath: statePath, maxRetries, onTestFailed, cwd, applicationUrl, issueBody } = opts;
  const e2eTestFiles = discoverE2ETestFiles(cwd);
  const costState = { costUsd: 0, modelUsage: emptyModelUsageMap() };
  let totalRetries = 0;

  if (e2eTestFiles.length === 0) {
    log('No E2E test files found in e2e-tests/ directory', 'info');
    AgentStateManager.appendLog(statePath, 'No E2E test files found - skipping E2E tests');
    return { passed: true, costUsd: 0, totalRetries, failedTests: [], modelUsage: costState.modelUsage };
  }

  log(`Discovered ${e2eTestFiles.length} E2E test file(s)`, 'info');
  AgentStateManager.appendLog(statePath, `Discovered ${e2eTestFiles.length} E2E test file(s)`);

  // Run all E2E tests via Playwright subprocess
  log('Running Playwright E2E tests...', 'info');
  AgentStateManager.appendLog(statePath, 'Running Playwright E2E tests');
  const playwrightResult = await runPlaywrightE2ETests(cwd, applicationUrl);

  if (playwrightResult.allPassed) {
    log('All E2E tests passed!', 'success');
    AgentStateManager.appendLog(statePath, 'All E2E tests passed');
    return { passed: true, costUsd: 0, totalRetries, failedTests: [], modelUsage: costState.modelUsage };
  }

  // Track failed tests for retry
  const failedE2ETests: Map<string, { result: E2ETestResult; retryCount: number }> = new Map();
  playwrightResult.failedResults.forEach(failedResult => {
    const testFile = failedResult.testPath ?? failedResult.testName;
    failedE2ETests.set(testFile, { result: failedResult, retryCount: 0 });
    log(`E2E test failed: ${failedResult.testName}`, 'error');
    AgentStateManager.appendLog(statePath, `E2E test failed: ${failedResult.testName}`);
  });

  // Retry loop: resolve failures with AI, then re-run Playwright
  while (failedE2ETests.size > 0) {
    const testsToRetry = Array.from(failedE2ETests.entries());
    if (testsToRetry.every(([, { retryCount }]) => retryCount >= maxRetries)) break;

    onTestFailed?.(Math.min(...testsToRetry.map(([, { retryCount }]) => retryCount)) + 1, maxRetries);

    // Resolve each failing spec with AI
    for (const [testFile, { result, retryCount }] of testsToRetry) {
      if (retryCount >= maxRetries) {
        log(`E2E test ${testFile} exceeded max retries`, 'error');
        AgentStateManager.appendLog(statePath, `E2E test ${testFile} exceeded max retries`);
        continue;
      }

      if (!isValidE2ETestResult(result)) {
        const derivedName = path.basename(testFile, '.spec.ts');
        log(`Warning: testName missing, derived from file path: ${derivedName}`, 'info');
        AgentStateManager.appendLog(statePath, `Warning: testName missing, derived from file path: ${derivedName}`);
        (result as E2ETestResult).testName = derivedName;
      }

      log(`Resolving E2E test: ${result.testName} (attempt ${retryCount + 1}/${maxRetries})`, 'info');
      AgentStateManager.appendLog(statePath, `Resolving E2E test: ${result.testName}`);

      const resolveResult = await runResolveE2ETestAgent(result, logsDir, initAgentState(statePath, 'test-resolver-agent'), cwd, applicationUrl, issueBody);
      trackCost(resolveResult as AgentRunResult, costState, statePath);
      totalRetries++;
    }

    // Re-run all Playwright tests after resolution
    log('Re-running Playwright E2E tests after resolution...', 'info');
    AgentStateManager.appendLog(statePath, 'Re-running Playwright E2E tests after resolution');
    const retryPlaywrightResult = await runPlaywrightE2ETests(cwd, applicationUrl);

    if (retryPlaywrightResult.allPassed) {
      failedE2ETests.clear();
      log('All E2E tests now passing!', 'success');
      AgentStateManager.appendLog(statePath, 'All E2E tests now passing after resolution');
      break;
    }

    // Update failed tests map: remove now-passing, update still-failing
    const stillFailingFiles = new Set(
      retryPlaywrightResult.failedResults.map(r => r.testPath ?? r.testName)
    );

    Array.from(failedE2ETests.keys())
      .filter(testFile => !stillFailingFiles.has(testFile))
      .forEach(testFile => {
        failedE2ETests.delete(testFile);
        log(`E2E test now passing: ${testFile}`, 'success');
        AgentStateManager.appendLog(statePath, `E2E test now passing: ${testFile}`);
      });

    retryPlaywrightResult.failedResults.forEach(failedResult => {
      const testFile = failedResult.testPath ?? failedResult.testName;
      const existing = failedE2ETests.get(testFile);
      const newRetryCount = existing ? existing.retryCount + 1 : 0;
      failedE2ETests.set(testFile, { result: failedResult, retryCount: newRetryCount });
      log(`E2E test still failing: ${testFile}`, 'error');
      AgentStateManager.appendLog(statePath, `E2E test still failing: ${testFile}`);
    });
  }

  const allPassed = failedE2ETests.size === 0;
  const failedTestNames = Array.from(failedE2ETests.values()).map(({ result }) => result.testName);
  const msg = allPassed ? 'All E2E tests passed' : `${failedE2ETests.size} E2E test(s) still failing`;
  log(msg + (allPassed ? '!' : ''), allPassed ? 'success' : 'error');
  AgentStateManager.appendLog(statePath, msg);
  return { passed: allPassed, costUsd: costState.costUsd, totalRetries, failedTests: failedTestNames, modelUsage: costState.modelUsage };
}
