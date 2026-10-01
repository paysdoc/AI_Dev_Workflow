#!/usr/bin/env bunx tsx
/**
 * Usage: bunx tsx adws/adwChore.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 * - MAX_REVIEW_RETRY_ATTEMPTS: Maximum retry attempts for review-patch loop (default: 3)
 */

import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, AgentStateManager, log, MAX_REVIEW_RETRY_ATTEMPTS } from './core';
import { extractPrNumber } from './adwBuildHelpers';
import { CostTracker, runPhase } from './core/phaseRunner';
import {
  initializeWorkflow,
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
export interface ChorePhases {
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

function postEscalationComment(config: WorkflowConfig): void {
  const { repoContext, issueNumber } = config;
  if (!repoContext) return;
  try {
    repoContext.issueTracker.commentOnIssue(
      issueNumber,
      [
        '## Chore Escalation: Regression Possible',
        '',
        'The diff evaluator detected changes that may affect application behaviour. Escalating to the full review pipeline.',
        '',
        'Phases: review → document → PR',
      ].join('\n'),
    );
  } catch (error) {
    log(`Failed to post escalation comment: ${error}`, 'warn');
  }
}

interface EscalatedReviewResult {
  readonly reviewPassed: boolean | undefined;
  readonly reviewRetries: number;
}

async function runEscalatedReviewLoop(
  config: WorkflowConfig,
  tracker: CostTracker,
  phases: ChorePhases,
  scenarioProofPath: string,
): Promise<EscalatedReviewResult> {
  let reviewPassed: boolean | undefined;
  let reviewRetries = 0;
  let proofPath = scenarioProofPath;
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
  return { reviewPassed, reviewRetries };
}

function stopAfterFailedReview(
  config: WorkflowConfig,
  tracker: CostTracker,
  testResult: { unitTestsPassed: boolean; totalRetries: number },
  scenarioRetries: number,
  reviewRetries: number,
): void {
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
      scenarioRetries,
      diffVerdict: 'regression_possible',
      reviewPassed: false,
      totalReviewRetries: reviewRetries,
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
  await runPhase(config, tracker, phases.executeInstallPhase);
  await runPhase(config, tracker, phases.executePlanPhase);
  await runPhase(config, tracker, phases.executeBuildPhase);
  await runPhase(config, tracker, phases.executeStepDefPhase, 'stepDef');
  const testResult = await runPhase(config, tracker, phases.executeUnitTestPhase);

  const { scenarioProofPath, scenarioRetries } = await phases.runScenarioTestFixLoop(config, tracker);

  // Diff evaluation uses git diff against the default branch (worktree-dependent).
  // Runs before PR so the worktree is still available.
  const diffResult = await runPhase(config, tracker, phases.executeDiffEvaluationPhase);

  let reviewPassed: boolean | undefined;
  let reviewRetries = 0;
  if (diffResult.verdict !== 'safe') {
    postEscalationComment(config);

    ({ reviewPassed, reviewRetries } = await runEscalatedReviewLoop(config, tracker, phases, scenarioProofPath));

    // A loop that recorded no verdict counts as failed. The gate lives in this branch because a
    // chore the diff judge rules safe runs no review, so it has no verdict to gate on.
    const outcome = decidePostReviewOutcome(reviewPassed ?? false);

    if (outcome.skipDocAndPR) {
      stopAfterFailedReview(config, tracker, testResult, scenarioRetries, reviewRetries);
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
      diffVerdict: reviewPassed !== undefined ? 'regression_possible' : 'safe',
      ...(reviewPassed !== undefined ? {
        reviewPassed,
        totalReviewRetries: reviewRetries,
      } : {}),
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
