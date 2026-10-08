#!/usr/bin/env bunx tsx
/**
 * Usage: bunx tsx adws/adwChore.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: (Optional) Anthropic API key; setting it moves billing from the Claude subscription to the API
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 * - MAX_REVIEW_RETRY_ATTEMPTS: Maximum retry attempts for review-patch loop (default: 3)
 */

import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, AgentStateManager, log } from './core';
import { DevServerStartStatus } from './core/devServerFailure';
import { extractPrNumber } from './adwBuildHelpers';
import { CostTracker, runPhase } from './core/phaseRunner';
import {
  initializeWorkflow,
  executeBaselinePhase,
  executeInstallPhase,
  executePlanPhase,
  executeBuildPhase,
  executeStepDefPhase,
  executeUnitTestPhase,
  executeScenarioTestPhase,
  runScenarioTestFixLoop,
  executePRPhase,
  executeReviewPhase,
  executeReviewPatchCycle,
  executeDocumentPhase,
  executeDiffEvaluationPhase,
  runReviewRetryLoop,
  handleWorkflowError,
  type DiffEvaluationPhaseResult,
  type ReviewRetryResult,
} from './workflowPhases';
import { persistTokenCounts } from './cost';
import type { WorkflowConfig } from './phases';
import { runWithOrchestratorLifecycle } from './phases/orchestratorLock';
import { AuthRequiredError } from './types/agentTypes';
import { handleAuthRequiredPause } from './phases/authPause';
import { decidePostReviewOutcome } from './phases/decidePostReviewOutcome';
import { executeSdlcReviewFailedHandoff } from './phases/sdlcReviewHandoff';

/** Injectable so tests can drive the review loop and what follows it without starting agents. */
export interface ChorePhases {
  readonly executeBaselinePhase: typeof executeBaselinePhase;
  readonly executeInstallPhase: typeof executeInstallPhase;
  readonly executePlanPhase: typeof executePlanPhase;
  readonly executeBuildPhase: typeof executeBuildPhase;
  readonly executeStepDefPhase: typeof executeStepDefPhase;
  readonly executeUnitTestPhase: typeof executeUnitTestPhase;
  readonly runScenarioTestFixLoop: typeof runScenarioTestFixLoop;
  readonly executeDiffEvaluationPhase: typeof executeDiffEvaluationPhase;
  readonly executeReviewPhase: typeof executeReviewPhase;
  readonly executeReviewPatchCycle: typeof executeReviewPatchCycle;
  readonly executeScenarioTestPhase: typeof executeScenarioTestPhase;
  readonly executeDocumentPhase: typeof executeDocumentPhase;
  readonly executePRPhase: typeof executePRPhase;
}

const CHORE_PHASES: ChorePhases = {
  executeBaselinePhase,
  executeInstallPhase,
  executePlanPhase,
  executeBuildPhase,
  executeStepDefPhase,
  executeUnitTestPhase,
  runScenarioTestFixLoop,
  executeDiffEvaluationPhase,
  executeReviewPhase,
  executeReviewPatchCycle,
  executeScenarioTestPhase,
  executeDocumentPhase,
  executePRPhase,
};

enum ChoreEscalation {
  RegressionPossible = 'regression_possible',
  DevServerDidNotStart = 'dev_server_did_not_start',
}

// The first heading is asserted by features/regression/smoke/adw_chore_diff_verdicts.feature.
const ESCALATION_COMMENTS: Readonly<Record<ChoreEscalation, readonly string[]>> = {
  [ChoreEscalation.RegressionPossible]: [
    '## Chore Escalation: Regression Possible',
    '',
    'The diff evaluator detected changes that may affect application behaviour. Escalating to the full review pipeline.',
    '',
    'Phases: review → document → PR',
  ],
  [ChoreEscalation.DevServerDidNotStart]: [
    '## Chore Escalation: Dev Server Did Not Start',
    '',
    'The dev server did not start on the issue branch, so no scenario ran. That is a failed review, whatever the diff evaluator rules. Escalating to the full review pipeline.',
    '',
    'Phases: review → document → PR',
  ],
};

function postEscalationComment(config: WorkflowConfig, escalation: ChoreEscalation): void {
  const { repoContext, issueNumber } = config;
  if (!repoContext) return;
  try {
    repoContext.issueTracker.commentOnIssue(issueNumber, ESCALATION_COMMENTS[escalation].join('\n'));
  } catch (error) {
    log(`Failed to post escalation comment: ${error}`, 'warn');
  }
}

interface FailedReviewRecord {
  readonly testResult: { unitTestsPassed: boolean; totalRetries: number };
  readonly scenarioRetries: number;
  readonly reviewRetries: number;
  readonly diffVerdict: DiffEvaluationPhaseResult['verdict'];
}

function stopAfterFailedReview(config: WorkflowConfig, tracker: CostTracker, record: FailedReviewRecord): void {
  executeSdlcReviewFailedHandoff({
    adwId: config.adwId,
    issueNumber: config.issueNumber,
    repoContext: config.repoContext,
    ctx: config.ctx,
  });
  AgentStateManager.writeState(config.orchestratorStatePath, {
    metadata: {
      totalCostUsd: tracker.totalCostUsd,
      unitTestsPassed: record.testResult.unitTestsPassed,
      totalTestRetries: record.testResult.totalRetries,
      scenarioRetries: record.scenarioRetries,
      diffVerdict: record.diffVerdict,
      reviewPassed: false,
      totalReviewRetries: record.reviewRetries,
    },
  });
  persistTokenCounts(config.orchestratorStatePath, tracker.totalCostUsd, tracker.totalModelUsage);
}

// Race accepted — a human can add hitl between this approval and the next cron tick;
// the merge gate is permissive in that case (rule 3).
function preApprovePr(config: WorkflowConfig): void {
  const { repoContext, issueNumber, ctx } = config;
  if (!repoContext || !ctx.prUrl) return;
  const prNumber = extractPrNumber(ctx.prUrl);
  if (!prNumber) return;
  const { issueTracker, codeHost } = repoContext;
  if (issueTracker.fetchLabels(issueNumber).includes('hitl')) {
    log(`Chore: skipping pre-approval — issue #${issueNumber} has hitl label`, 'info');
    return;
  }
  log(`Chore: pre-approving PR #${prNumber} (no hitl on issue #${issueNumber})`, 'info');
  const result = codeHost.approvePullRequest(prNumber);
  if (!result.success) {
    log(`Chore: pre-approval failed (non-fatal — hitl-removed humans can still approve manually): ${result.error}`, 'warn');
  }
}

async function runChorePhases(
  config: WorkflowConfig,
  tracker: CostTracker,
  phases: ChorePhases,
): Promise<void> {
  await runPhase(config, tracker, phases.executeBaselinePhase, 'baseline');
  await runPhase(config, tracker, phases.executeInstallPhase);
  await runPhase(config, tracker, phases.executePlanPhase);
  await runPhase(config, tracker, phases.executeBuildPhase);
  await runPhase(config, tracker, phases.executeStepDefPhase, 'stepDef');
  const testResult = await runPhase(config, tracker, phases.executeUnitTestPhase);

  const scenarios = await phases.runScenarioTestFixLoop(config, tracker);
  const { scenarioRetries } = scenarios;

  // Diff evaluation uses git diff against the default branch (worktree-dependent).
  // Runs before PR so the worktree is still available.
  const diffResult = await runPhase(config, tracker, phases.executeDiffEvaluationPhase);

  // A failed start is a failed review whatever the diff judge rules: a chore whose scenarios never ran must not be auto-merged.
  const startFailed = scenarios.devServer.status === DevServerStartStatus.Failed;

  let review: ReviewRetryResult | undefined;
  if (diffResult.verdict !== 'safe' || startFailed) {
    postEscalationComment(config, startFailed ? ChoreEscalation.DevServerDidNotStart : ChoreEscalation.RegressionPossible);

    review = await runReviewRetryLoop(config, tracker, scenarios, phases);

    // The gate lives in this branch because a chore the judge rules safe, with a server that started, runs no
    // review, so it has no verdict to gate on.
    const outcome = decidePostReviewOutcome(review.reviewPassed);

    if (outcome.skipDocAndPR) {
      stopAfterFailedReview(config, tracker, {
        testResult,
        scenarioRetries,
        reviewRetries: review.reviewRetries,
        diffVerdict: diffResult.verdict,
      });
      return;
    }

    // Document phase runs Claude agent + git commit/push — worktree-dependent, must run before PR.
    await runPhase(config, tracker, (cfg: WorkflowConfig) => phases.executeDocumentPhase(cfg));
  }

  await runPhase(config, tracker, phases.executePRPhase);

  preApprovePr(config);

  AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'awaiting_merge' });
  AgentStateManager.writeState(config.orchestratorStatePath, {
    metadata: {
      totalCostUsd: tracker.totalCostUsd,
      unitTestsPassed: testResult.unitTestsPassed,
      totalTestRetries: testResult.totalRetries,
      scenarioRetries,
      diffVerdict: diffResult.verdict,
      ...(review ? { reviewPassed: review.reviewPassed, totalReviewRetries: review.reviewRetries } : {}),
    },
  });
  persistTokenCounts(config.orchestratorStatePath, tracker.totalCostUsd, tracker.totalModelUsage);
  log('===================================', 'info');
  log('Orchestrator finished — PR approved, awaiting merge via cron', 'success');
  if (config.ctx.prUrl) log(`PR: ${config.ctx.prUrl}`, 'info');
  log('===================================', 'info');
}

/** Everything main() runs inside the orchestrator lifecycle, exported so tests can drive it. */
export async function executeChore(
  config: WorkflowConfig,
  phases: ChorePhases = CHORE_PHASES,
): Promise<void> {
  const tracker = new CostTracker();
  try {
    await runChorePhases(config, tracker, phases);
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
    scriptName: 'adwChore.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
    supportsCwd: false,
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.Chore, {
    issueType: providedIssueType || undefined,
    targetRepo: targetRepo || undefined,
    repoId,
  });

  if (!await runWithOrchestratorLifecycle(config, () => executeChore(config))) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
}

// Only run when executed directly — not when imported as a module (e.g. in tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
