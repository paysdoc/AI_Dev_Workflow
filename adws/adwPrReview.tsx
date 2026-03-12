#!/usr/bin/env bunx tsx
/**
 * ADW PR Review - AI Developer Workflow for PR Review Comments
 *
 * Usage: bunx tsx adws/adwPrReview.tsx <pr-number>
 *
 * Workflow:
 * 1. Initialize: fetch PR details, detect unaddressed comments, setup worktree, initialize state
 * 2. Plan Phase: read existing plan, run PR review plan agent
 * 3. Build Phase: run PR review build agent to implement revision plan
 * 4. Test Phase: run unit tests with retry, run E2E tests with retry
 * 5. Finalize: commit and push changes, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 */

import { parseTargetRepoArgs, buildRepoIdentifier, mergeModelUsageMaps, persistTokenCounts, computeTotalTokens, RUNNING_TOKENS, type ModelUsageMap } from './core';
import {
  initializePRReviewWorkflow,
  executePRReviewPlanPhase,
  executePRReviewBuildPhase,
  executePRReviewTestPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
} from './workflowPhases';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const repoInfo = targetRepo ? { owner: targetRepo.owner, repo: targetRepo.repo } : undefined;
  const repoId = buildRepoIdentifier(targetRepo);

  if (args.length < 1) {
    console.error('Usage: bunx tsx adws/adwPrReview.tsx <pr-number>');
    process.exit(1);
  }

  const prNumber = parseInt(args[0], 10);
  if (isNaN(prNumber)) {
    console.error(`Invalid PR number: ${args[0]}`);
    process.exit(1);
  }

  const config = await initializePRReviewWorkflow(prNumber, null, repoInfo, repoId);

  let totalCostUsd = 0;
  let totalModelUsage: ModelUsageMap = {};

  try {
    const planResult = await executePRReviewPlanPhase(config);
    totalCostUsd += planResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, planResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeTotalTokens(totalModelUsage);

    const buildResult = await executePRReviewBuildPhase(config, planResult.planOutput);
    totalCostUsd += buildResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, buildResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeTotalTokens(totalModelUsage);

    const testResult = await executePRReviewTestPhase(config);
    totalCostUsd += testResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, testResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeTotalTokens(totalModelUsage);

    await completePRReviewWorkflow(config, totalModelUsage);
  } catch (error) {
    handlePRReviewWorkflowError(config, error, totalCostUsd, totalModelUsage);
  }
}

main();
