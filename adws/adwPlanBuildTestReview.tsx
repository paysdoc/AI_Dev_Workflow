#!/usr/bin/env bunx tsx
/**
 * ADW Plan, Build, Test & Review - Plan+Build+Test+PR+Review Orchestrator
 *
 * Usage: bunx tsx adws/adwPlanBuildTestReview.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
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
 * 9. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 * - MAX_REVIEW_RETRY_ATTEMPTS: Maximum retry attempts for review-patch loop (default: 3)
 */

import { mergeModelUsageMaps, persistTokenCounts, parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, computeDisplayTokens, RUNNING_TOKENS } from './core';
import {
  initializeWorkflow,
  executePlanPhase,
  executeScenarioPhase,
  executePlanValidationPhase,
  executeBuildPhase,
  executeTestPhase,
  executeStepDefPhase,
  executePRPhase,
  executeReviewPhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';
import { commitPhasesCostData } from './phases/phaseCostCommit';


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

  let totalCostUsd = 0;
  let totalModelUsage = {};

  try {
    const [planResult, scenarioResult] = await Promise.all([
      executePlanPhase(config),
      executeScenarioPhase(config),
    ]);
    totalCostUsd += planResult.costUsd + scenarioResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(
      mergeModelUsageMaps(totalModelUsage, planResult.modelUsage),
      scenarioResult.modelUsage,
    );
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    await commitPhasesCostData(config, [...planResult.phaseCostRecords, ...scenarioResult.phaseCostRecords]);

    config.totalModelUsage = totalModelUsage;
    const planValidationResult = await executePlanValidationPhase(config);
    totalCostUsd += planValidationResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, planValidationResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);

    config.totalModelUsage = totalModelUsage;
    const buildResult = await executeBuildPhase(config);
    totalCostUsd += buildResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, buildResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    await commitPhasesCostData(config, buildResult.phaseCostRecords);

    config.totalModelUsage = totalModelUsage;
    const testResult = await executeTestPhase(config);
    totalCostUsd += testResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, testResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    await commitPhasesCostData(config, testResult.phaseCostRecords);

    config.totalModelUsage = totalModelUsage;
    const stepDefResult = await executeStepDefPhase(config);
    totalCostUsd += stepDefResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, stepDefResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    await commitPhasesCostData(config, stepDefResult.phaseCostRecords);

    config.totalModelUsage = totalModelUsage;
    const reviewResult = await executeReviewPhase(config);
    totalCostUsd += reviewResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, reviewResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    await commitPhasesCostData(config, reviewResult.phaseCostRecords);

    config.totalModelUsage = totalModelUsage;
    const prResult = await executePRPhase(config);
    totalCostUsd += prResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, prResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    await commitPhasesCostData(config, prResult.phaseCostRecords);

    await completeWorkflow(config, totalCostUsd, {
      unitTestsPassed: testResult.unitTestsPassed,
      totalTestRetries: testResult.totalRetries,
      reviewPassed: reviewResult.reviewPassed,
      totalReviewRetries: reviewResult.totalRetries,
    }, totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, totalCostUsd, totalModelUsage);
  }
}

main();
