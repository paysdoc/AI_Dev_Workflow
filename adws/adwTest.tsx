#!/usr/bin/env npx tsx
/**
 * ADW Test - AI Developer Workflow Testing Phase
 *
 * Usage: npx tsx adws/adwTest.tsx [adw-id]
 *
 * Workflow:
 * 1. Run unit tests using /test command (sonnet model)
 * 2. If tests fail, run /resolve_failed_test for each failure (opus model)
 * 3. Retry unit tests after resolution
 * 4. Discover and run E2E tests using /test_e2e command (sonnet model)
 * 5. If E2E tests fail, run /resolve_failed_e2e_test for each failure (opus model)
 * 6. Retry E2E tests after resolution
 * 7. Continue until all tests pass or MAX_TEST_RETRY_ATTEMPTS exceeded
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts (default: 5)
 */

import {
  log,
  setLogAdwId,
  generateAdwId,
  ensureLogsDirectory,
  AgentStateManager,
  AgentState,
  MAX_TEST_RETRY_ATTEMPTS,
  mergeModelUsageMaps,
  persistTokenCounts,
  parseTargetRepoArgs,
} from './core';
import { runUnitTestsWithRetry, runE2ETestsWithRetry } from './agents';

/** Prints usage information and exits. */
function printUsageAndExit(): never {
  console.error('Usage: npx tsx adws/adwTest.tsx [adw-id] [--cwd <path>]');
  console.error('');
  console.error('Runs comprehensive validation tests with automatic failure resolution.');
  console.error('');
  console.error('Options:');
  console.error('  --cwd <path>             Working directory for test execution (worktree path)');
  console.error('');
  console.error('Environment Requirements:');
  console.error('  ANTHROPIC_API_KEY        - Anthropic API key');
  console.error('  CLAUDE_CODE_PATH         - Path to Claude CLI (default: /usr/local/bin/claude)');
  console.error('  MAX_TEST_RETRY_ATTEMPTS  - Maximum retry attempts (default: 5)');
  process.exit(1);
}

/** Parses and validates command line arguments. */
function parseArguments(args: string[]): { adwId: string; cwd: string | null } {
  if (args.includes('--help') || args.includes('-h')) {
    printUsageAndExit();
  }

  // Parse --cwd option
  let cwd: string | null = null;
  const cwdIndex = args.indexOf('--cwd');
  if (cwdIndex !== -1 && args[cwdIndex + 1]) {
    cwd = args[cwdIndex + 1];
    args.splice(cwdIndex, 2);
  }

  const adwId = args[0] || generateAdwId();
  setLogAdwId(adwId);
  return { adwId, cwd };
}

/** Prints the test phase summary. */
function printTestSummary(
  adwId: string,
  logsDir: string,
  unitTestsPassed: boolean,
  e2eTestsPassed: boolean,
  totalRetries: number,
  totalCostUsd: number
): void {
  log('===================================', 'info');
  if (unitTestsPassed && e2eTestsPassed) {
    log('ADW Test workflow completed!', 'success');
  } else {
    log('ADW Test workflow failed!', 'error');
  }
  log(`ADW ID: ${adwId}`, 'info');
  log(`Unit tests: ${unitTestsPassed ? 'PASSED' : 'FAILED'}`, unitTestsPassed ? 'success' : 'error');
  log(`E2E tests: ${e2eTestsPassed ? 'PASSED' : 'FAILED'}`, e2eTestsPassed ? 'success' : 'error');
  log(`Total retries: ${totalRetries}`, 'info');
  log(`Logs: ${logsDir}`, 'info');
  if (totalCostUsd > 0) {
    log(`Cost: $${totalCostUsd.toFixed(4)}`, 'info');
  }
  log('===================================', 'info');
}

/** Main test workflow. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  parseTargetRepoArgs(args);
  const { adwId, cwd } = parseArguments(args);

  const logsDir = ensureLogsDirectory(adwId);

  log('===================================', 'info');
  log('ADW Test Workflow', 'info');
  log(`ADW ID: ${adwId}`, 'info');
  log(`Max retry attempts: ${MAX_TEST_RETRY_ATTEMPTS}`, 'info');
  log(`Logs: ${logsDir}`, 'info');
  if (cwd) {
    log(`Working directory: ${cwd}`, 'info');
  }
  log('===================================', 'info');

  const orchestratorStatePath = AgentStateManager.initializeState(adwId, 'test-orchestrator');

  const initialState: Partial<AgentState> = {
    adwId,
    issueNumber: 0,
    agentName: 'test-orchestrator',
    execution: AgentStateManager.createExecutionState('running'),
    metadata: { maxRetryAttempts: MAX_TEST_RETRY_ATTEMPTS },
  };
  AgentStateManager.writeState(orchestratorStatePath, initialState);
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting ADW Test workflow');

  try {
    let totalCostUsd = 0;
    let totalRetries = 0;
    let totalModelUsage = {};

    log('Phase 1: Unit Tests', 'info');
    AgentStateManager.appendLog(orchestratorStatePath, 'Starting Phase 1: Unit Tests');

    const unitTestsResult = await runUnitTestsWithRetry({
      logsDir,
      orchestratorStatePath,
      maxRetries: MAX_TEST_RETRY_ATTEMPTS,
    });
    totalCostUsd += unitTestsResult.costUsd;
    totalRetries += unitTestsResult.totalRetries;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, unitTestsResult.modelUsage);
    persistTokenCounts(orchestratorStatePath, totalCostUsd, totalModelUsage);

    let e2eTestsPassed = true;
    if (unitTestsResult.passed) {
      log('Phase 2: E2E Tests', 'info');
      AgentStateManager.appendLog(orchestratorStatePath, 'Starting Phase 2: E2E Tests');

      const e2eTestsResult = await runE2ETestsWithRetry({
        logsDir,
        orchestratorStatePath,
        maxRetries: MAX_TEST_RETRY_ATTEMPTS,
      });
      totalCostUsd += e2eTestsResult.costUsd;
      totalRetries += e2eTestsResult.totalRetries;
      totalModelUsage = mergeModelUsageMaps(totalModelUsage, e2eTestsResult.modelUsage);
      persistTokenCounts(orchestratorStatePath, totalCostUsd, totalModelUsage);
      e2eTestsPassed = e2eTestsResult.passed;
    } else {
      log('Skipping E2E tests due to unit test failures', 'info');
      AgentStateManager.appendLog(orchestratorStatePath, 'Skipping E2E tests due to unit test failures');
    }

    const allPassed = unitTestsResult.passed && e2eTestsPassed;
    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        allPassed,
        allPassed ? undefined : 'Some tests failed after maximum retry attempts'
      ),
      metadata: {
        maxRetryAttempts: MAX_TEST_RETRY_ATTEMPTS,
        unitTestsPassed: unitTestsResult.passed,
        e2eTestsPassed,
        totalRetries,
        totalCostUsd,
      },
    });

    if (allPassed) {
      AgentStateManager.appendLog(orchestratorStatePath, 'Test workflow completed successfully');
    } else {
      AgentStateManager.appendLog(orchestratorStatePath, 'Test workflow completed with failures');
    }

    printTestSummary(adwId, logsDir, unitTestsResult.passed, e2eTestsPassed, totalRetries, totalCostUsd);

    if (!allPassed) {
      process.exit(1);
    }
  } catch (error) {
    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        false,
        String(error)
      ),
    });
    AgentStateManager.appendLog(orchestratorStatePath, `Test workflow failed: ${error}`);
    log(`Test workflow failed: ${error}`, 'error');
    process.exit(1);
  }
}

main();
