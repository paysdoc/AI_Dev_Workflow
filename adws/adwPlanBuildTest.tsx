#!/usr/bin/env bunx tsx
/**
 * Usage: bunx tsx adws/adwPlanBuildTest.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: (Optional) Anthropic API key; setting it moves billing from the Claude subscription to the API
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 */

import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, AgentStateManager, log } from './core';
import { DevServerStartStatus } from './core/devServerFailure';
import { CostTracker, runPhase } from './core/phaseRunner';
import {
  initializeWorkflow,
  executeBaselinePhase,
  executeInstallPhase,
  executePlanPhase,
  executeBuildPhase,
  executeStepDefPhase,
  executeUnitTestPhase,
  runScenarioTestFixLoop,
  recordFailedStartReview,
  executePRPhase,
  executeProofPublishPhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';
import { persistTokenCounts } from './cost';
import type { WorkflowConfig } from './phases';
import { runWithOrchestratorLifecycle } from './phases/orchestratorLock';
import { AuthRequiredError } from './types/agentTypes';
import { handleAuthRequiredPause } from './phases/authPause';
import { executeSdlcReviewFailedHandoff } from './phases/sdlcReviewHandoff';

/** Injectable so tests can drive what follows the scenario run without starting agents. */
export interface PlanBuildTestPhases {
  readonly executeBaselinePhase: typeof executeBaselinePhase;
  readonly executeInstallPhase: typeof executeInstallPhase;
  readonly executePlanPhase: typeof executePlanPhase;
  readonly executeBuildPhase: typeof executeBuildPhase;
  readonly executeStepDefPhase: typeof executeStepDefPhase;
  readonly executeUnitTestPhase: typeof executeUnitTestPhase;
  readonly runScenarioTestFixLoop: typeof runScenarioTestFixLoop;
  readonly executePRPhase: typeof executePRPhase;
  readonly executeProofPublishPhase: typeof executeProofPublishPhase;
}

const PLAN_BUILD_TEST_PHASES: PlanBuildTestPhases = {
  executeBaselinePhase,
  executeInstallPhase,
  executePlanPhase,
  executeBuildPhase,
  executeStepDefPhase,
  executeUnitTestPhase,
  runScenarioTestFixLoop,
  executePRPhase,
  executeProofPublishPhase,
};

async function runPlanBuildTestPhases(
  config: WorkflowConfig,
  tracker: CostTracker,
  phases: PlanBuildTestPhases,
): Promise<void> {
  await runPhase(config, tracker, phases.executeBaselinePhase, 'baseline');
  await runPhase(config, tracker, phases.executeInstallPhase);
  await runPhase(config, tracker, phases.executePlanPhase);
  await runPhase(config, tracker, phases.executeBuildPhase);
  await runPhase(config, tracker, phases.executeStepDefPhase, 'stepDef');
  const testResult = await runPhase(config, tracker, phases.executeUnitTestPhase);

  const { scenarioRetries, devServer } = await phases.runScenarioTestFixLoop(config, tracker);

  // This orchestrator has no review patch loop, so the failed review has no attempt left to patch with.
  if (devServer.status === DevServerStartStatus.Failed) {
    recordFailedStartReview(config, devServer);
    executeSdlcReviewFailedHandoff({
      adwId: config.adwId,
      issueNumber: config.issueNumber,
      repoContext: config.repoContext,
      ctx: config.ctx,
    });
    AgentStateManager.writeState(config.orchestratorStatePath, {
      metadata: {
        totalCostUsd: tracker.totalCostUsd,
        unitTestsPassed: testResult.unitTestsPassed,
        totalTestRetries: testResult.totalRetries,
        scenarioRetries,
        reviewPassed: false,
        totalReviewRetries: 1,
      },
    });
    persistTokenCounts(config.orchestratorStatePath, tracker.totalCostUsd, tracker.totalModelUsage);
    return;
  }

  await runPhase(config, tracker, phases.executePRPhase);
  await runPhase(config, tracker, phases.executeProofPublishPhase);

  await completeWorkflow(config, tracker.totalCostUsd, {
    unitTestsPassed: testResult.unitTestsPassed,
    totalTestRetries: testResult.totalRetries,
    scenarioRetries,
  }, tracker.totalModelUsage);
}

/** Everything main() runs inside the orchestrator lifecycle, exported so tests can drive it. */
export async function executePlanBuildTest(
  config: WorkflowConfig,
  phases: PlanBuildTestPhases = PLAN_BUILD_TEST_PHASES,
): Promise<void> {
  const tracker = new CostTracker();
  try {
    await runPlanBuildTestPhases(config, tracker, phases);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      handleAuthRequiredPause(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
    }
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, providedIssueType } = parseOrchestratorArguments(args, {
    scriptName: 'adwPlanBuildTest.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
    supportsCwd: false,
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.PlanBuildTest, {
    issueType: providedIssueType || undefined,
    targetRepo: targetRepo || undefined,
    repoId,
  });

  if (!await runWithOrchestratorLifecycle(config, () => executePlanBuildTest(config))) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
}

// Only run when executed directly — not when imported as a module (e.g. in tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
