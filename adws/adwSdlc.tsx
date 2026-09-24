#!/usr/bin/env bunx tsx
/**
 * Usage: bunx tsx adws/adwSdlc.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
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
  executeStepDefPhase,
  executeUnitTestPhase,
  executeScenarioTestPhase,
  runScenarioTestFixLoop,
  executePRPhase,
  executeReviewPhase,
  executeReviewPatchCycle,
  executeDocumentPhase,
  executeProofPublishPhase,
  executePromotionRotAdvisory,
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, providedIssueType } = parseOrchestratorArguments(args, {
    scriptName: 'adwSdlc.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
    supportsCwd: false,
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.Sdlc, {
    issueType: providedIssueType || undefined,
    targetRepo: targetRepo || undefined,
    repoId,
  });

  if (!await runWithOrchestratorLifecycle(config, async () => {
    const tracker = new CostTracker();
    try {
      await runPhase(config, tracker, executeInstallPhase);
      await runPhasesParallel(config, tracker, [executePlanPhase, executeScenarioPhase]);
      await runPhase(config, tracker, executeAlignmentPhase);
      await runPhase(config, tracker, executeBuildPhase);
      await runPhase(config, tracker, executeStepDefPhase, 'stepDef');
      const unitTestResult = await runPhase(config, tracker, executeUnitTestPhase);

      const { scenarioProofPath, scenarioRetries } = await runScenarioTestFixLoop(config, tracker);

      let reviewRetries = 0;
      let proofPath = scenarioProofPath;
      let reviewPassed = false;
      let reviewBlockers: ReviewIssue[] = [];
      for (let attempt = 0; attempt < MAX_REVIEW_RETRY_ATTEMPTS; attempt++) {
        const reviewFn = (cfg: WorkflowConfig) => executeReviewPhase(cfg, proofPath);
        const reviewResult = await runPhase(config, tracker, reviewFn);
        reviewPassed = reviewResult.reviewPassed;
        reviewBlockers = reviewResult.reviewIssues.filter(i => i.issueSeverity === 'blocker');
        if (reviewPassed) break;
        reviewRetries++;
        if (attempt < MAX_REVIEW_RETRY_ATTEMPTS - 1) {
          const patchWrapper = (cfg: WorkflowConfig) =>
            executeReviewPatchCycle(cfg, reviewBlockers);
          await runPhase(config, tracker, patchWrapper);
          const retestResult = await runPhase(config, tracker, executeScenarioTestPhase);
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
            unitTestsPassed: unitTestResult.unitTestsPassed,
            totalTestRetries: unitTestResult.totalRetries,
            scenarioRetries,
            reviewPassed: false,
            totalReviewRetries: reviewRetries,
          },
        });
        persistTokenCounts(config.orchestratorStatePath, tracker.totalCostUsd, tracker.totalModelUsage);
        return;
      }

      await runPhase(config, tracker, (cfg: WorkflowConfig) => executeDocumentPhase(cfg));

      await runPhase(config, tracker, executePRPhase);
      await runPhase(config, tracker, executeProofPublishPhase);
      await runPhase(config, tracker, executePromotionRotAdvisory);

      // Do NOT call completeWorkflow —
      // that overwrites the stage with 'completed'. adwMerge.tsx handles completion after merge.
      AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'awaiting_merge' });
      AgentStateManager.writeState(config.orchestratorStatePath, {
        metadata: {
          totalCostUsd: tracker.totalCostUsd,
          unitTestsPassed: unitTestResult.unitTestsPassed,
          totalTestRetries: unitTestResult.totalRetries,
          scenarioRetries,
          reviewPassed,
          totalReviewRetries: reviewRetries,
        },
      });
      persistTokenCounts(config.orchestratorStatePath, tracker.totalCostUsd, tracker.totalModelUsage);
      log('===================================', 'info');
      log('Orchestrator finished — PR approved, awaiting merge via cron', 'success');
      if (config.ctx.prUrl) log(`PR: ${config.ctx.prUrl}`, 'info');
      log('===================================', 'info');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        handleAuthRequiredPause(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
      }
      handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
    }
  })) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
}

main();
