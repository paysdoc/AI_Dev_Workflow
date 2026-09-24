#!/usr/bin/env bunx tsx
/**
 * ADW PR Review - AI Developer Workflow for PR Review Comments
 *
 * Usage: bunx tsx adws/adwPrReview.tsx <issueNumber> <adwId>   (canonical form)
 *        bunx tsx adws/adwPrReview.tsx <pr-number>              (manual fallback, routed through resolver)
 *
 * Workflow:
 * 1. Initialize: build the launch boundary, resolve the invocation (branch→PR/adwId), fetch PR
 *    details, detect unaddressed comments, setup worktree, initialize state
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

import { parseTargetRepoArgs, buildLaunchBoundary, MAX_REVIEW_RETRY_ATTEMPTS, AgentStateManager, resolvePrReviewInvocation } from './core';
import { resolvePrReviewSpawn } from './triggers/webhookHandlers';
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
  runScenarioTestFixLoop,
  executeReviewPhase,
  executeReviewPatchCycle,
  type ReviewIssue,
} from './workflowPhases';
import type { WorkflowConfig } from './phases';
import { AuthRequiredError } from './types/agentTypes';
import { handleAuthRequiredPause } from './phases/authPause';
import { decidePostReviewOutcome } from './phases/decidePostReviewOutcome';
import { buildNotifierDeps } from './forge/hitlBoardNotifier';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);

  if (args.length < 1) {
    console.error('Usage: bunx tsx adws/adwPrReview.tsx <issueNumber> <adwId>  (canonical)\n       bunx tsx adws/adwPrReview.tsx <pr-number>                     (manual fallback)');
    process.exit(1);
  }

  const boundary = buildLaunchBoundary(targetRepo);

  const invocation = resolvePrReviewInvocation(args, {
    readTopLevelState: (id) => AgentStateManager.readTopLevelState(id),
    findPullRequestByBranch: (b) => boundary.providers.codeHost.findPullRequestByBranch(b),
    resolveSpawn: (n) => resolvePrReviewSpawn(n, boundary.providers),
  });
  if (invocation.kind === 'error') {
    console.error(invocation.message);
    process.exit(1);
  }
  if (invocation.kind === 'skip') {
    console.log(invocation.message);
    process.exit(0);
  }
  const { prNumber, adwId: resolvedAdwId } = invocation;

  const config = await initializePRReviewWorkflow(prNumber, resolvedAdwId, boundary, targetRepo ?? undefined);

  AgentStateManager.writeTopLevelState(config.base.adwId, {
    adwId: config.base.adwId,
    issueNumber: config.base.issueNumber,
    orchestratorScript: 'adws/adwPrReview.tsx',
    ...(config.base.branchName ? { branchName: config.base.branchName } : {}),
  });
  const tracker = new CostTracker();

  try {
    await runPhase(config.base, tracker, executeInstallPhase, 'install');

    const planResult = await runPhase(config.base, tracker, _ => executePRReviewPlanPhase(config), 'pr_review_plan');

    await runPhase(config.base, tracker, _ => executePRReviewBuildPhase(config, planResult.planOutput), 'pr_review_build');

    await runPhase(config.base, tracker, executeStepDefPhase, 'stepDef');

    // Unit tests
    await runPhase(config.base, tracker, executeUnitTestPhase);

    const { scenarioProofPath } = await runScenarioTestFixLoop(config.base, tracker);

    // Review → patch+retest retry loop (orchestrator-level, bounded by MAX_REVIEW_RETRY_ATTEMPTS)
    let proofPath = scenarioProofPath;
    let reviewBlockers: ReviewIssue[] = [];
    let reviewPassed = false;
    for (let attempt = 0; attempt < MAX_REVIEW_RETRY_ATTEMPTS; attempt++) {
      const reviewFn = (cfg: WorkflowConfig) => executeReviewPhase(cfg, proofPath);
      const reviewResult = await runPhase(config.base, tracker, reviewFn);
      reviewPassed = reviewResult.reviewPassed;
      reviewBlockers = reviewResult.reviewIssues.filter(i => i.issueSeverity === 'blocker');
      if (reviewPassed) break;
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

    const outcome = decidePostReviewOutcome(reviewPassed);
    await completePRReviewWorkflow(config, tracker.totalModelUsage, outcome);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      handleAuthRequiredPause(config.base, error, tracker.totalCostUsd, tracker.totalModelUsage);
    }
    await handlePRReviewWorkflowError(
      config,
      error,
      tracker.totalCostUsd,
      tracker.totalModelUsage,
      buildNotifierDeps(() => boundary.providers, boundary.repoId),
    );
  }
}

main();
