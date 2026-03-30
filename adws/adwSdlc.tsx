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
 * 5. Test Phase: optionally run unit tests (unit only)
 * 6. Review Phase: review implementation + run BDD scenarios, patch blockers, retry
 * 7. Document Phase: generate feature documentation (includes review screenshots)
 * 8. PR Phase: create pull request (only after review passes)
 * 9. KPI Phase: track agentic KPIs (non-fatal)
 * 10. AutoMerge Phase: approve and merge the PR (non-fatal)
 * 11. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 * - MAX_TEST_RETRY_ATTEMPTS: Maximum retry attempts for tests (default: 5)
 * - MAX_REVIEW_RETRY_ATTEMPTS: Maximum retry attempts for review-patch loop (default: 3)
 */

import * as path from 'path';
import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId } from './core';
import { CostTracker, runPhase, runPhaseWithContinuation, runPhasesParallel } from './core/phaseRunner';
import {
  initializeWorkflow,
  executeInstallPhase,
  executePlanPhase,
  executeScenarioPhase,
  executeAlignmentPhase,
  executeBuildPhase,
  buildPhaseOnTokenLimit,
  executeTestPhase,
  executePRPhase,
  executeReviewPhase,
  executeDocumentPhase,
  executeKpiPhase,
  executeAutoMergePhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';
import type { WorkflowConfig } from './phases';

/**
 * Derives the review screenshots directory from the review result.
 * Review screenshots are stored in the agent state directory.
 */
function getReviewScreenshotsDir(adwId: string): string {
  return path.join('agents', adwId, 'review-agent', 'review_img');
}

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

  const tracker = new CostTracker();

  try {
    await runPhase(config, tracker, executeInstallPhase);
    await runPhasesParallel(config, tracker, [executePlanPhase, executeScenarioPhase]);
    await runPhase(config, tracker, executeAlignmentPhase);
    await runPhaseWithContinuation(config, tracker, executeBuildPhase, buildPhaseOnTokenLimit);
    const testResult = await runPhase(config, tracker, executeTestPhase);
    const reviewResult = await runPhase(config, tracker, executeReviewPhase);

    // Document phase uses review screenshots: bind screenshotsDir via wrapper.
    const screenshotsDir = getReviewScreenshotsDir(config.adwId);
    const executeDocumentWithScreenshots = (cfg: WorkflowConfig) =>
      executeDocumentPhase(cfg, screenshotsDir);
    await runPhase(config, tracker, executeDocumentWithScreenshots);

    await runPhase(config, tracker, executePRPhase);

    // KPI phase takes an extra argument: bind reviewRetries via wrapper.
    const executeKpiWithRetries = (cfg: WorkflowConfig) =>
      executeKpiPhase(cfg, reviewResult.totalRetries);
    await runPhase(config, tracker, executeKpiWithRetries);

    await runPhase(config, tracker, executeAutoMergePhase);

    await completeWorkflow(config, tracker.totalCostUsd, {
      unitTestsPassed: testResult.unitTestsPassed,
      totalTestRetries: testResult.totalRetries,
      reviewPassed: reviewResult.reviewPassed,
      totalReviewRetries: reviewResult.totalRetries,
    }, tracker.totalModelUsage);
  } catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

main();
