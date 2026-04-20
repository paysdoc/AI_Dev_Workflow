#!/usr/bin/env bunx tsx
/**
 * ADW Test - AI Developer Workflow Testing Phase
 *
 * Usage: bunx tsx adws/adwTest.tsx <issueNumber> [adw-id] [--cwd <path>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state, detect recovery
 * 2. Test Phase: optionally run unit tests + BDD scenarios tagged @adw-{issueNumber}
 * 3. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts (default: 5)
 */

import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, log } from './core';
import { CostTracker, runPhase } from './core/phaseRunner';
import {
  initializeWorkflow,
  executeUnitTestPhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';
import { acquireOrchestratorLock, releaseOrchestratorLock } from './phases/orchestratorLock';

/**
 * Main orchestrator workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, cwd } = parseOrchestratorArguments(args, {
    scriptName: 'adwTest.tsx',
    usagePattern: '<issueNumber> [adw-id] [--cwd <path>]',
    supportsIssueType: false,
    supportsCwd: true,
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.Test, {
    targetRepo: targetRepo || undefined,
    repoId,
    cwd: cwd || undefined,
  });

  if (!acquireOrchestratorLock(config)) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }

  const tracker = new CostTracker();

  try {
    const testResult = await runPhase(config, tracker, executeUnitTestPhase, 'test');

    await completeWorkflow(config, tracker.totalCostUsd, {
      unitTestsPassed: testResult.unitTestsPassed,
      totalTestRetries: testResult.totalRetries,
    }, tracker.totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  } finally {
    releaseOrchestratorLock(config);
  }
}

main();
