#!/usr/bin/env bunx tsx
/**
 * ADW Plan, Build & Review - Plan+Build+PR+Review Orchestrator
 *
 * Usage: bunx tsx adws/adwPlanBuildReview.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state, detect recovery
 * 2. Plan Phase: classify issue, create branch, run plan agent, commit plan
 * 3. Build Phase: run build agent, commit implementation
 * 4. PR Phase: create pull request
 * 5. Review Phase: review implementation against spec, patch blockers, retry
 * 6. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_REVIEW_RETRY_ATTEMPTS: Maximum retry attempts for review-patch loop (default: 3)
 */

import { mergeModelUsageMaps, persistTokenCounts, parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, computeDisplayTokens, RUNNING_TOKENS } from './core';
import {
  initializeWorkflow,
  executePlanPhase,
  executeBuildPhase,
  executePRPhase,
  executeReviewPhase,
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
    scriptName: 'adwPlanBuildReview.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
    supportsCwd: false,
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.PlanBuildReview, {
    issueType: providedIssueType || undefined,
    targetRepo: targetRepo || undefined,
    repoId,
  });

  let totalCostUsd = 0;
  let totalModelUsage = {};

  try {
    const planResult = await executePlanPhase(config);
    totalCostUsd += planResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, planResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);

    config.totalModelUsage = totalModelUsage;
    const buildResult = await executeBuildPhase(config);
    totalCostUsd += buildResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, buildResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);

    config.totalModelUsage = totalModelUsage;
    const prResult = await executePRPhase(config);
    totalCostUsd += prResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, prResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);

    config.totalModelUsage = totalModelUsage;
    const reviewResult = await executeReviewPhase(config);
    totalCostUsd += reviewResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, reviewResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);

    await completeWorkflow(config, totalCostUsd, {
      reviewPassed: reviewResult.reviewPassed,
      totalReviewRetries: reviewResult.totalRetries,
    }, totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, totalCostUsd, totalModelUsage);
  }
}

main();
