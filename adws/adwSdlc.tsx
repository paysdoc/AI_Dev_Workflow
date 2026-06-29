#!/usr/bin/env bunx tsx
/**
 * ADW SDLC - Full Software Development Life Cycle Orchestrator
 *
 * Usage: bunx tsx adws/adwSdlc.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state, detect recovery
 * 2. Plan Phase + Scenario Phase (parallel): run plan agent, write BDD scenarios
 * 3. Alignment Phase: single-pass alignment of plan against scenarios
 * 4. Build Phase: run build agent, commit implementation
 * 5. Step Def Phase: generate BDD step definitions
 * 6. Unit Test Phase: optionally run unit tests (unit only)
 * 7. Scenario Test Phase [→ Scenario Fix Phase → retry]: run BDD scenarios, fix failures
 * 8. Review Phase [→ Patch Cycle → Scenario Retest → retry]: passive judge, patch blockers
 * 9. Document Phase: generate feature documentation
 * 10. PR Phase: create pull request (only after review passes)
 * 11. Approve PR + write awaiting_merge to state, then exit (merge handled by adwMerge.tsx via cron)
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
  handleWorkflowError,
  type ReviewIssue,
} from './workflowPhases';
import { persistTokenCounts } from './cost';
import type { WorkflowConfig } from './phases';
import { runWithOrchestratorLifecycle } from './phases/orchestratorLock';
import { AuthRequiredError } from './types/agentTypes';
import { handleAuthRequiredPause } from './phases/authPause';
import { decidePostReviewOutcome } from './phases/decidePostReviewOutcome';

/**
 * Main orchestrator workflow.
 */
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

      // Review → patch+retest retry loop (orchestrator-level, bounded by MAX_REVIEW_RETRY_ATTEMPTS)
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
          // Re-run scenario tests to verify patch didn't break scenarios
          const retestResult = await runPhase(config, tracker, executeScenarioTestPhase);
          proofPath = retestResult.scenarioProof?.resultsFilePath ?? '';
        }
      }

      const outcome = decidePostReviewOutcome(reviewPassed);

      if (outcome.skipDocAndPR) {
        // Review exhausted with unresolved blockers — enter human-gated blocking stage.
        // No PR is created; document phase is skipped. Human must push a fix then post ## Retry.
        AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'review_failed' });
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
        log('===================================', 'warn');
        log('Review exhausted — stage set to review_failed (no PR created). Post ## Retry after fixing.', 'warn');
        if (config.ctx.branchName) log(`Branch: ${config.ctx.branchName}`, 'info');
        log('===================================', 'warn');
        return;
      }

      // Review passed — proceed with document, PR, and awaiting_merge handoff.
      // Document phase: no screenshots dir needed (review no longer produces images)
      await runPhase(config, tracker, (cfg: WorkflowConfig) => executeDocumentPhase(cfg));

      await runPhase(config, tracker, executePRPhase);
      await runPhase(config, tracker, executeProofPublishPhase);

      // Write awaiting_merge and persist costs. Do NOT call completeWorkflow —
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
