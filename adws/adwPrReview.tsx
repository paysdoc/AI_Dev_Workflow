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
 * 8. Review Phase [→ Patch Cycle → Scenario Retest → retry]: passive judge, patch blockers
 * 9. Finalize: commit and push changes, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 * - MAX_REVIEW_RETRY_ATTEMPTS: Maximum retry attempts for review-patch loop (default: 3)
 */

import { parseTargetRepoArgs, buildRepoIdentifier, MAX_TEST_RETRY_ATTEMPTS, MAX_REVIEW_RETRY_ATTEMPTS } from './core';
import { CostTracker, runPhase } from './core/phaseRunner';
import {
  initializePRReviewWorkflow,
  executePRReviewPlanPhase,
  executePRReviewBuildPhase,
  executePRReviewCommitPushPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
  executeStepDefPhase,
  executeInstallPhase,
  executeUnitTestPhase,
  executeScenarioTestPhase,
  executeScenarioFixPhase,
  executeReviewPhase,
  executeReviewPatchCycle,
  type ReviewIssue,
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
    let scenarioProofPath = '';
    for (let attempt = 0; attempt < MAX_TEST_RETRY_ATTEMPTS; attempt++) {
      const scenarioResult = await runPhase(config.base, tracker, executeScenarioTestPhase);
      scenarioProofPath = scenarioResult.scenarioProof?.resultsFilePath ?? '';
      if (!scenarioResult.scenarioProof?.hasBlockerFailures) break;
      if (attempt < MAX_TEST_RETRY_ATTEMPTS - 1) {
        const fixWrapper = (cfg: WorkflowConfig) =>
          executeScenarioFixPhase(cfg, scenarioResult.scenarioProof!);
        await runPhase(config.base, tracker, fixWrapper);
      }
    }

    // Review → patch+retest retry loop (orchestrator-level, bounded by MAX_REVIEW_RETRY_ATTEMPTS)
    let proofPath = scenarioProofPath;
    let reviewBlockers: ReviewIssue[] = [];
    for (let attempt = 0; attempt < MAX_REVIEW_RETRY_ATTEMPTS; attempt++) {
      const reviewFn = (cfg: WorkflowConfig) => executeReviewPhase(cfg, proofPath);
      const reviewResult = await runPhase(config.base, tracker, reviewFn);
      reviewBlockers = reviewResult.reviewIssues.filter(i => i.issueSeverity === 'blocker');
      if (reviewResult.reviewPassed) break;
      if (attempt < MAX_REVIEW_RETRY_ATTEMPTS - 1) {
        const patchWrapper = (cfg: WorkflowConfig) =>
          executeReviewPatchCycle(cfg, reviewBlockers);
        await runPhase(config.base, tracker, patchWrapper);
        // Re-run scenario tests to verify patch didn't break scenarios
        const retestResult = await runPhase(config.base, tracker, executeScenarioTestPhase);
        proofPath = retestResult.scenarioProof?.resultsFilePath ?? '';
      }
    }

    await runPhase(config.base, tracker, _ => executePRReviewCommitPushPhase(config), 'pr_review_commit_push');

    await completePRReviewWorkflow(config, tracker.totalModelUsage);
  } catch (error) {
    handlePRReviewWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

main();
