#!/usr/bin/env npx tsx
/**
 * ADW PR Review - AI Developer Workflow for PR Review Comments
 *
 * Usage: npx tsx adws/adwPrReview.tsx <pr-number>
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

import { parseTargetRepoArgs } from './core';
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

  if (args.length < 1) {
    console.error('Usage: npx tsx adws/adwPrReview.tsx <pr-number>');
    process.exit(1);
  }

  const prNumber = parseInt(args[0], 10);
  if (isNaN(prNumber)) {
    console.error(`Invalid PR number: ${args[0]}`);
    process.exit(1);
  }

  const config = await initializePRReviewWorkflow(prNumber, null);

  try {
    const { planOutput } = await executePRReviewPlanPhase(config);
    await executePRReviewBuildPhase(config, planOutput);
    await executePRReviewTestPhase(config);
    await completePRReviewWorkflow(config);
  } catch (error) {
    handlePRReviewWorkflowError(config, error);
  }
}

main();
