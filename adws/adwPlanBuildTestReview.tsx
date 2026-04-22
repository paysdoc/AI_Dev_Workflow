#!/usr/bin/env bunx tsx
/**
 * ADW Plan, Build, Test & Review - Plan+Build+Test+PR+Review Orchestrator
 *
 * Usage: bunx tsx adws/adwPlanBuildTestReview.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Identical workflow to adwPlanBuildReview.tsx, distinguished only by the OrchestratorId
 * (PlanBuildTestReview vs PlanBuildReview) for state-tracking and cost attribution.
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
 * 9. PR Phase: create pull request (only after review passes)
 * 10. Approve PR + write awaiting_merge to state (API calls only — no worktree required)
 * 11. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 * - MAX_REVIEW_RETRY_ATTEMPTS: Maximum retry attempts for review-patch loop (default: 3)
 */

import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, AgentStateManager, log, MAX_TEST_RETRY_ATTEMPTS, MAX_REVIEW_RETRY_ATTEMPTS } from './core';
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
  executeScenarioFixPhase,
  executePRPhase,
  executeReviewPhase,
  executeReviewPatchCycle,
  handleWorkflowError,
  type ReviewIssue,
} from './workflowPhases';
import { persistTokenCounts } from './cost';
import type { WorkflowConfig } from './phases';
import { runWithOrchestratorLifecycle } from './phases/orchestratorLock';

/**
 * Main orchestrator workflow.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId, providedIssueType } = parseOrchestratorArguments(args, {
    scriptName: 'adwPlanBuildTestReview.tsx',
    usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
    supportsCwd: false,
  });
  const repoId = buildRepoIdentifier(targetRepo);

  const config = await initializeWorkflow(issueNumber, adwId, OrchestratorId.PlanBuildTestReview, {
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
      const testResult = await runPhase(config, tracker, executeUnitTestPhase);

      // Scenario test → fix retry loop (orchestrator-level, bounded by MAX_TEST_RETRY_ATTEMPTS)
      let scenarioProofPath = '';
      let scenarioRetries = 0;
      for (let attempt = 0; attempt < MAX_TEST_RETRY_ATTEMPTS; attempt++) {
        const scenarioResult = await runPhase(config, tracker, executeScenarioTestPhase);
        scenarioProofPath = scenarioResult.scenarioProof?.resultsFilePath ?? '';
        if (!scenarioResult.scenarioProof?.hasBlockerFailures) break;
        scenarioRetries++;
        if (attempt < MAX_TEST_RETRY_ATTEMPTS - 1) {
          const fixWrapper = (cfg: WorkflowConfig) =>
            executeScenarioFixPhase(cfg, scenarioResult.scenarioProof!);
          await runPhase(config, tracker, fixWrapper);
        }
      }

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

      await runPhase(config, tracker, executePRPhase);

      AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'awaiting_merge' });
      AgentStateManager.writeState(config.orchestratorStatePath, {
        metadata: {
          totalCostUsd: tracker.totalCostUsd,
          unitTestsPassed: testResult.unitTestsPassed,
          totalTestRetries: testResult.totalRetries,
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
      handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
    }
  })) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
}

main();
