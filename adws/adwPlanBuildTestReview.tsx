#!/usr/bin/env bunx tsx
/**
 * ADW Plan, Build, Test & Review - Plan+Build+Test+PR+Review Orchestrator
 *
 * Usage: bunx tsx adws/adwPlanBuildTestReview.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Identical workflow to adwPlanBuildReview.tsx, distinguished only by the OrchestratorId
 * (PlanBuildTestReview vs PlanBuildReview) for state-tracking and cost attribution.
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state, detect recovery
 * 2. Plan Phase + Scenario Phase (parallel): run plan agent, write BDD scenarios
 * 3. Plan Validation Phase: validate plan against scenarios
 * 4. Build Phase: run build agent, commit implementation
 * 5. Test Phase: optionally run unit tests (unit only)
 * 6. Step Def Gen Phase: generate step definitions, remove ungeneratable scenarios
 * 7. Review Phase: review implementation + run BDD scenarios, patch blockers, retry
 * 8. PR Phase: create pull request (only after review passes)
 * 9. AutoMerge Phase: approve and merge the PR (non-fatal)
 * 10. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 * - MAX_REVIEW_RETRY_ATTEMPTS: Maximum retry attempts for review-patch loop (default: 3)
 */

import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId } from './core';
import { CostTracker, runPhase, runPhasesParallel } from './core/phaseRunner';
import {
  initializeWorkflow,
  executeInstallPhase,
  executePlanPhase,
  executeScenarioPhase,
  executePlanValidationPhase,
  executeBuildPhase,
  executeTestPhase,
  executeStepDefPhase,
  executePRPhase,
  executeReviewPhase,
  executeAutoMergePhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';


/**
 * Main orchestrator workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, providedIssueType } = parseOrchestratorArguments(args, {
    scriptName: 'adwPlanBuildTestReview.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
    supportsCwd: false,
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.PlanBuildTestReview, {
    issueType: providedIssueType || undefined,
    targetRepo: targetRepo || undefined,
    repoId,
  });

  const tracker = new CostTracker();

  try {
    await runPhase(config, tracker, executeInstallPhase);
    await runPhasesParallel(config, tracker, [executePlanPhase, executeScenarioPhase]);
    await runPhase(config, tracker, executePlanValidationPhase);
    await runPhase(config, tracker, executeBuildPhase);
    const testResult = await runPhase(config, tracker, executeTestPhase);
    await runPhase(config, tracker, executeStepDefPhase);
    const reviewResult = await runPhase(config, tracker, executeReviewPhase);
    await runPhase(config, tracker, executePRPhase);
    await runPhase(config, tracker, executeAutoMergePhase);

    await completeWorkflow(config, tracker.totalCostUsd, {
      unitTestsPassed: testResult.unitTestsPassed,
      totalTestRetries: testResult.totalRetries,
      reviewPassed: reviewResult.reviewPassed,
      totalReviewRetries: reviewResult.totalRetries,
    }, tracker.totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

main();
