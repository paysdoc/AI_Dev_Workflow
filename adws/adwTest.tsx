#!/usr/bin/env bunx tsx
/**
 * ADW Test - AI Developer Workflow Testing Phase
 *
 * Usage: bunx tsx adws/adwTest.tsx [adw-id] [issueNumber] [--cwd <path>]
 *
 * Workflow:
 * 1. Load project config to determine unit test opt-in status
 * 2. If unit tests enabled: run /test command, resolve failures, retry
 * 3. Run BDD scenarios tagged @adw-{issueNumber} using command from .adw/commands.md
 * 4. If BDD scenarios fail, run /resolve_failed_e2e_test for resolution
 * 5. Retry BDD scenarios after resolution
 * 6. Continue until all pass or MAX_TEST_RETRY_ATTEMPTS exceeded
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
  OrchestratorId,
  loadProjectConfig,
  parseUnitTestsEnabled,
} from './core';
import { extractCwdOption, printUsageAndExit } from './core/orchestratorCli';
import { runUnitTestsWithRetry, runBddScenariosWithRetry } from './agents';

/** Parses and validates command line arguments. */
function parseArguments(args: string[]): { adwId: string; cwd: string | null; issueNumber: number } {
  if (args.includes('--help') || args.includes('-h')) {
    printUsageAndExit('adwTest.tsx', '[adw-id] [issueNumber] [--cwd <path>]', [
      '--cwd <path>             Working directory for test execution (worktree path)',
    ]);
  }

  const cwd = extractCwdOption(args);
  const adwId = args[0] || generateAdwId();
  const issueNumber = args[1] && /^\d+$/.test(args[1]) ? parseInt(args[1], 10) : 0;
  setLogAdwId(adwId);
  return { adwId, cwd, issueNumber };
}

/** Prints the test phase summary. */
function printTestSummary(
  adwId: string,
  logsDir: string,
  unitTestsPassed: boolean,
  bddScenariosPassed: boolean,
  totalRetries: number,
  totalCostUsd: number
): void {
  log('===================================', 'info');
  if (unitTestsPassed && bddScenariosPassed) {
    log('ADW Test workflow completed!', 'success');
  } else {
    log('ADW Test workflow failed!', 'error');
  }
  log(`ADW ID: ${adwId}`, 'info');
  log(`Unit tests: ${unitTestsPassed ? 'PASSED' : 'FAILED'}`, unitTestsPassed ? 'success' : 'error');
  log(`BDD scenarios: ${bddScenariosPassed ? 'PASSED' : 'FAILED'}`, bddScenariosPassed ? 'success' : 'error');
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
  const { adwId, cwd, issueNumber } = parseArguments(args);

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

  const orchestratorStatePath = AgentStateManager.initializeState(adwId, OrchestratorId.Test);

  const initialState: Partial<AgentState> = {
    adwId,
    issueNumber,
    agentName: OrchestratorId.Test,
    execution: AgentStateManager.createExecutionState('running'),
    metadata: { maxRetryAttempts: MAX_TEST_RETRY_ATTEMPTS },
  };
  AgentStateManager.writeState(orchestratorStatePath, initialState);
  AgentStateManager.appendLog(orchestratorStatePath, 'Starting ADW Test workflow');

  // Load project config to determine unit test opt-in and BDD command
  const projectConfig = loadProjectConfig(cwd ?? process.cwd());
  const unitTestsEnabled = parseUnitTestsEnabled(projectConfig.projectMd);

  try {
    let totalCostUsd = 0;
    let totalRetries = 0;
    let totalModelUsage = {};
    let unitTestsPassed = true;

    if (unitTestsEnabled) {
      log('Phase 1: Unit Tests', 'info');
      AgentStateManager.appendLog(orchestratorStatePath, 'Starting Phase 1: Unit Tests');

      const unitTestsResult = await runUnitTestsWithRetry({
        logsDir,
        orchestratorStatePath,
        maxRetries: MAX_TEST_RETRY_ATTEMPTS,
        cwd: cwd ?? undefined,
      });
      totalCostUsd += unitTestsResult.costUsd;
      totalRetries += unitTestsResult.totalRetries;
      totalModelUsage = mergeModelUsageMaps(totalModelUsage, unitTestsResult.modelUsage);
      persistTokenCounts(orchestratorStatePath, totalCostUsd, totalModelUsage);
      unitTestsPassed = unitTestsResult.passed;
    } else {
      log('Unit tests disabled — skipping', 'info');
      AgentStateManager.appendLog(orchestratorStatePath, 'Unit tests disabled — skipping');
    }

    let bddScenariosPassed = true;
    if (unitTestsPassed) {
      log('Phase 2: BDD Scenarios', 'info');
      AgentStateManager.appendLog(orchestratorStatePath, `Starting Phase 2: BDD Scenarios @adw-${issueNumber}`);

      const bddResult = await runBddScenariosWithRetry({
        logsDir,
        orchestratorStatePath,
        maxRetries: MAX_TEST_RETRY_ATTEMPTS,
        cwd: cwd ?? undefined,
        scenarioCommand: projectConfig.commands.runBddScenarios,
        issueNumber,
      });
      totalCostUsd += bddResult.costUsd;
      totalRetries += bddResult.totalRetries;
      totalModelUsage = mergeModelUsageMaps(totalModelUsage, bddResult.modelUsage);
      persistTokenCounts(orchestratorStatePath, totalCostUsd, totalModelUsage);
      bddScenariosPassed = bddResult.passed;
    } else {
      log('Skipping BDD scenarios due to unit test failures', 'info');
      AgentStateManager.appendLog(orchestratorStatePath, 'Skipping BDD scenarios due to unit test failures');
      bddScenariosPassed = false;
    }

    const allPassed = unitTestsPassed && bddScenariosPassed;
    AgentStateManager.writeState(orchestratorStatePath, {
      execution: AgentStateManager.completeExecution(
        AgentStateManager.createExecutionState('running'),
        allPassed,
        allPassed ? undefined : 'Some tests failed after maximum retry attempts'
      ),
      metadata: {
        maxRetryAttempts: MAX_TEST_RETRY_ATTEMPTS,
        unitTestsPassed,
        bddScenariosPassed,
        totalRetries,
        totalCostUsd,
      },
    });

    if (allPassed) {
      AgentStateManager.appendLog(orchestratorStatePath, 'Test workflow completed successfully');
    } else {
      AgentStateManager.appendLog(orchestratorStatePath, 'Test workflow completed with failures');
    }

    printTestSummary(adwId, logsDir, unitTestsPassed, bddScenariosPassed, totalRetries, totalCostUsd);

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
