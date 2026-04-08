#!/usr/bin/env bunx tsx
/**
 * ADW PR Review - AI Developer Workflow for PR Review Comments
 *
 * Usage: bunx tsx adws/adwPrReview.tsx <pr-number>
 *
 * Workflow:
 * 1. Initialize: fetch PR details, detect unaddressed comments, setup worktree, initialize state
 * 2. Install Phase: install dependencies
 * 3. Plan Phase: read existing plan, run PR review plan agent
 * 4. Build Phase: run PR review build agent to implement revision plan
 * 5. Step Def Phase: generate BDD step definitions
 * 6. Unit Test Phase: run unit tests
 * 7. Scenario Test Phase [→ Scenario Fix Phase → retry]: run BDD scenarios, fix failures
 * 8. Finalize: commit and push changes, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 */

import { parseTargetRepoArgs, buildRepoIdentifier, MAX_TEST_RETRY_ATTEMPTS } from './core';
import { CostTracker, runPhase } from './core/phaseRunner';
import {
  initializePRReviewWorkflow,
  executePRReviewPlanPhase,
  executePRReviewBuildPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
  executeStepDefPhase,
  executeInstallPhase,
  executeUnitTestPhase,
  executeScenarioTestPhase,
  executeScenarioFixPhase,
} from './workflowPhases';
import type { WorkflowConfig } from './phases';

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

    // Unit tests
    await runPhase(config.base, tracker, executeUnitTestPhase);

    // Scenario test → fix retry loop (orchestrator-level, bounded by MAX_TEST_RETRY_ATTEMPTS)
    for (let attempt = 0; attempt < MAX_TEST_RETRY_ATTEMPTS; attempt++) {
      const scenarioResult = await runPhase(config.base, tracker, executeScenarioTestPhase);
      if (!scenarioResult.scenarioProof?.hasBlockerFailures) break;
      if (attempt < MAX_TEST_RETRY_ATTEMPTS - 1) {
        const fixWrapper = (cfg: WorkflowConfig) =>
          executeScenarioFixPhase(cfg, scenarioResult.scenarioProof!);
        await runPhase(config.base, tracker, fixWrapper);
      }
    }

    await completePRReviewWorkflow(config, tracker.totalModelUsage);
  } catch (error) {
    handlePRReviewWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

main();
