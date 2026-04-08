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

import { parseTargetRepoArgs, buildRepoIdentifier } from './core';
import { CostTracker, runPhase } from './core/phaseRunner';
import {
  initializePRReviewWorkflow,
  executePRReviewPlanPhase,
  executePRReviewBuildPhase,
  executePRReviewTestPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
  executeStepDefPhase,
  executeInstallPhase,
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

  const config = await initializePRReviewWorkflow(prNumber, null, repoInfo, repoId, targetRepo ?? undefined);
  const tracker = new CostTracker();

  try {
    await runPhase(config.base, tracker, executeInstallPhase, 'install');

    const planResult = await runPhase(config.base, tracker, _ => executePRReviewPlanPhase(config), 'pr_review_plan');

    await runPhase(config.base, tracker, _ => executePRReviewBuildPhase(config, planResult.planOutput), 'pr_review_build');

    await runPhase(config.base, tracker, executeStepDefPhase, 'stepDef');

    await runPhase(config.base, tracker, _ => executePRReviewTestPhase(config), 'pr_review_test');

    await completePRReviewWorkflow(config, tracker.totalModelUsage);
  } catch (error) {
    handlePRReviewWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

main();
