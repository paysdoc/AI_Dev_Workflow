#!/usr/bin/env bunx tsx
/**
 * Usage: bunx tsx adws/adwPlanBuildReview.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_REVIEW_RETRY_ATTEMPTS: Maximum retry attempts for review-patch loop (default: 3)
 */

import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, AgentStateManager, log, MAX_REVIEW_RETRY_ATTEMPTS } from './core';
import { CostTracker, runPhase, runPhasesParallel } from './core/phaseRunner';
import {
  initializeWorkflow,
  executeInstallPhase,
  executePlanPhase,
  executeScenarioPhase,
  executeAlignmentPhase,
  executeBuildPhase,
  executeUnitTestPhase,
  executeScenarioTestPhase,
  executePRPhase,
  executeReviewPhase,
  executeReviewPatchCycle,
  handleWorkflowError,
  type ReviewIssue,
} from './workflowPhases';
import { persistTokenCounts } from './cost';
import type { WorkflowConfig } from './phases';
import { runWithOrchestratorLifecycle } from './phases/orchestratorLock';
import { AuthRequiredError } from './types/agentTypes';
import { handleAuthRequiredPause } from './phases/authPause';
import { decidePostReviewOutcome } from './phases/decidePostReviewOutcome';
import { executeSdlcReviewFailedHandoff } from './phases/sdlcReviewHandoff';

/** Injectable so tests can drive the review loop and what follows it without starting agents. */
export interface PlanBuildReviewPhases {
  readonly executeInstallPhase: typeof executeInstallPhase;
  readonly executePlanPhase: typeof executePlanPhase;
  readonly executeScenarioPhase: typeof executeScenarioPhase;
  readonly executeAlignmentPhase: typeof executeAlignmentPhase;
  readonly executeBuildPhase: typeof executeBuildPhase;
  readonly executeUnitTestPhase: typeof executeUnitTestPhase;
  readonly executeScenarioTestPhase: typeof executeScenarioTestPhase;
  readonly executeReviewPhase: typeof executeReviewPhase;
  readonly executeReviewPatchCycle: typeof executeReviewPatchCycle;
  readonly executePRPhase: typeof executePRPhase;
}

const PLAN_BUILD_REVIEW_PHASES: PlanBuildReviewPhases = {
  executeInstallPhase,
  executePlanPhase,
  executeScenarioPhase,
  executeAlignmentPhase,
  executeBuildPhase,
  executeUnitTestPhase,
  executeScenarioTestPhase,
  executeReviewPhase,
  executeReviewPatchCycle,
  executePRPhase,
};

async function runPlanBuildReviewPhases(
  config: WorkflowConfig,
  tracker: CostTracker,
  phases: PlanBuildReviewPhases,
): Promise<void> {
  await runPhase(config, tracker, phases.executeInstallPhase);
  await runPhasesParallel(config, tracker, [phases.executePlanPhase, phases.executeScenarioPhase]);
  await runPhase(config, tracker, phases.executeAlignmentPhase);
  await runPhase(config, tracker, phases.executeBuildPhase);
  const testResult = await runPhase(config, tracker, phases.executeUnitTestPhase);

  const scenarioResult = await runPhase(config, tracker, phases.executeScenarioTestPhase);
  let proofPath = scenarioResult.scenarioProof?.resultsFilePath ?? '';

  let reviewRetries = 0;
  let reviewPassed = false;
  let reviewBlockers: ReviewIssue[] = [];
  for (let attempt = 0; attempt < MAX_REVIEW_RETRY_ATTEMPTS; attempt++) {
    const reviewFn = (cfg: WorkflowConfig) => phases.executeReviewPhase(cfg, proofPath);
    const reviewResult = await runPhase(config, tracker, reviewFn);
    reviewPassed = reviewResult.reviewPassed;
    reviewBlockers = reviewResult.reviewIssues.filter(i => i.issueSeverity === 'blocker');
    if (reviewPassed) break;
    reviewRetries++;
    if (attempt < MAX_REVIEW_RETRY_ATTEMPTS - 1) {
      const patchWrapper = (cfg: WorkflowConfig) =>
        phases.executeReviewPatchCycle(cfg, reviewBlockers);
      await runPhase(config, tracker, patchWrapper);
      const retestResult = await runPhase(config, tracker, phases.executeScenarioTestPhase);
      proofPath = retestResult.scenarioProof?.resultsFilePath ?? '';
    }
  }

  const outcome = decidePostReviewOutcome(reviewPassed);

  if (outcome.skipDocAndPR) {
    executeSdlcReviewFailedHandoff({
      adwId: config.adwId,
      issueNumber: config.issueNumber,
      repoContext: config.repoContext,
      ctx: config.ctx,
    });
    AgentStateManager.writeState(config.orchestratorStatePath, {
      metadata: {
        totalCostUsd: tracker.totalCostUsd,
        unitTestsPassed: testResult.unitTestsPassed,
        totalTestRetries: testResult.totalRetries,
        reviewPassed: false,
        totalReviewRetries: reviewRetries,
      },
    });
    persistTokenCounts(config.orchestratorStatePath, tracker.totalCostUsd, tracker.totalModelUsage);
    return;
  }

  await runPhase(config, tracker, phases.executePRPhase);

  AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'awaiting_merge' });
  AgentStateManager.writeState(config.orchestratorStatePath, {
    metadata: {
      totalCostUsd: tracker.totalCostUsd,
      unitTestsPassed: testResult.unitTestsPassed,
      totalTestRetries: testResult.totalRetries,
      reviewPassed,
      totalReviewRetries: reviewRetries,
    },
  });
  persistTokenCounts(config.orchestratorStatePath, tracker.totalCostUsd, tracker.totalModelUsage);
  log('===================================', 'info');
  log('Orchestrator finished — PR approved, awaiting merge via cron', 'success');
  if (config.ctx.prUrl) log(`PR: ${config.ctx.prUrl}`, 'info');
  log('===================================', 'info');
}

/** Everything main() runs inside the orchestrator lifecycle, exported so tests can drive it. */
export async function executePlanBuildReview(
  config: WorkflowConfig,
  phases: PlanBuildReviewPhases = PLAN_BUILD_REVIEW_PHASES,
): Promise<void> {
  const tracker = new CostTracker();
  try {
    await runPlanBuildReviewPhases(config, tracker, phases);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      handleAuthRequiredPause(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
    }
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

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

  if (!await runWithOrchestratorLifecycle(config, () => executePlanBuildReview(config))) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
}

// Only run when executed directly — not when imported as a module (e.g. in tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
