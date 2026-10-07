#!/usr/bin/env bunx tsx
/**
 * Usage: bunx tsx adws/adwPrReview.tsx <issueNumber> <adwId>   (canonical form)
 *        bunx tsx adws/adwPrReview.tsx <pr-number>              (manual fallback, routed through resolver)
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: (Optional) Anthropic API key; setting it moves billing from the Claude subscription to the API
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 * - MAX_REVIEW_RETRY_ATTEMPTS: Maximum retry attempts for review-patch loop (default: 3)
 */

import { parseTargetRepoArgs, buildLaunchBoundary, AgentStateManager, resolvePrReviewInvocation, log, type LaunchBoundary } from './core';
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
  executeBaselinePhase,
  executeInstallPhase,
  executeUnitTestPhase,
  runScenarioTestFixLoop,
  runReviewRetryLoop,
  type PRReviewWorkflowConfig,
} from './workflowPhases';
import { runWithOrchestratorLifecycle, MERGE_POLL_LOCK_WAIT } from './phases/orchestratorLock';
import { AuthRequiredError } from './types/agentTypes';
import { handleAuthRequiredPause } from './phases/authPause';
import { decidePostReviewOutcome } from './phases/decidePostReviewOutcome';
import { buildNotifierDeps } from './forge/hitlBoardNotifier';

/** Everything main() runs inside the orchestrator lifecycle. */
async function runPrReviewPhases(config: PRReviewWorkflowConfig, boundary: LaunchBoundary): Promise<void> {
  const tracker = new CostTracker();

  try {
    // Not 'baseline': the issue's adwId already records the SDLC run's baseline as completed, which would skip this one.
    await runPhase(config.base, tracker, executeBaselinePhase, 'pr_review_baseline');

    await runPhase(config.base, tracker, executeInstallPhase, 'install');

    const planResult = await runPhase(config.base, tracker, _ => executePRReviewPlanPhase(config), 'pr_review_plan');

    await runPhase(config.base, tracker, _ => executePRReviewBuildPhase(config, planResult.planOutput), 'pr_review_build');

    await runPhase(config.base, tracker, executeStepDefPhase, 'stepDef');

    await runPhase(config.base, tracker, executeUnitTestPhase);

    const scenarios = await runScenarioTestFixLoop(config.base, tracker);

    const { reviewPassed } = await runReviewRetryLoop(config.base, tracker, scenarios);

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

  if (!await runWithOrchestratorLifecycle(config.base, () => runPrReviewPhases(config, boundary), MERGE_POLL_LOCK_WAIT)) {
    log(`Issue #${config.base.issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
}

main();
