#!/usr/bin/env bunx tsx
/**
 * ADW Plan, Build & Test - Plan+Build+Test+PR Orchestrator (no review)
 *
 * Usage: bunx tsx adws/adwPlanBuildTest.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Identical workflow to adwPlanBuild.tsx, distinguished only by the OrchestratorId
 * (PlanBuildTest vs PlanBuild) for state-tracking and cost attribution.
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state, detect recovery
 * 2. Plan Phase: classify issue, create branch, run plan agent, commit plan
 * 3. Build Phase: run build agent, commit implementation
 * 4. Step Def Phase: generate BDD step definitions
 * 5. Unit Test Phase: optionally run unit tests (unit only)
 * 6. Scenario Test Phase [→ Scenario Fix Phase → retry]: run BDD scenarios, fix failures
 * 7. PR Phase: create pull request
 * 8. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 */

import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, MAX_TEST_RETRY_ATTEMPTS } from './core';
import { CostTracker, runPhase } from './core/phaseRunner';
import {
  initializeWorkflow,
  executeInstallPhase,
  executePlanPhase,
  executeBuildPhase,
  executeStepDefPhase,
  executeUnitTestPhase,
  executeScenarioTestPhase,
  executeScenarioFixPhase,
  executePRPhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';
import type { WorkflowConfig } from './phases';

/**
 * Main orchestrator workflow.
 */
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

  const tracker = new CostTracker();

  try {
    await runPhase(config, tracker, executeInstallPhase);
    await runPhase(config, tracker, executePlanPhase);
    await runPhase(config, tracker, executeBuildPhase);
    await runPhase(config, tracker, executeStepDefPhase, 'stepDef');
    const testResult = await runPhase(config, tracker, executeUnitTestPhase);

    // Scenario test → fix retry loop (orchestrator-level, bounded by MAX_TEST_RETRY_ATTEMPTS)
    let scenarioRetries = 0;
    for (let attempt = 0; attempt < MAX_TEST_RETRY_ATTEMPTS; attempt++) {
      const scenarioResult = await runPhase(config, tracker, executeScenarioTestPhase);
      if (!scenarioResult.scenarioProof?.hasBlockerFailures) break;
      scenarioRetries++;
      if (attempt < MAX_TEST_RETRY_ATTEMPTS - 1) {
        const fixWrapper = (cfg: WorkflowConfig) =>
          executeScenarioFixPhase(cfg, scenarioResult.scenarioProof!);
        await runPhase(config, tracker, fixWrapper);
      }
    }

    await runPhase(config, tracker, executePRPhase);

    await completeWorkflow(config, tracker.totalCostUsd, {
      unitTestsPassed: testResult.unitTestsPassed,
      totalTestRetries: testResult.totalRetries,
      scenarioRetries,
    }, tracker.totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

main();
