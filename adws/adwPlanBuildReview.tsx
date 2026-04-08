#!/usr/bin/env bunx tsx
/**
 * ADW Plan, Build & Review - Plan+Build+Test+PR+Review Orchestrator
 *
 * Usage: bunx tsx adws/adwPlanBuildReview.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state, detect recovery
 * 2. Plan Phase + Scenario Phase (parallel): run plan agent, write BDD scenarios
 * 3. Alignment Phase: single-pass alignment of plan against scenarios
 * 4. Build Phase: run build agent, commit implementation
 * 5. Test Phase: optionally run unit tests (unit only)
 * 6. Scenario Test Phase: run BDD scenarios
 * 7. Review Phase [→ Patch Cycle → Scenario Retest → retry]: passive judge, patch blockers
 * 8. PR Phase: create pull request (only after review passes)
 * 9. Approve PR + write awaiting_merge to state (API calls only — no worktree required)
 * 10. Finalize: update state, post completion comment
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
import { approvePR, isGitHubAppConfigured, issueHasLabel, commentOnIssue, type RepoInfo } from './github';
import { extractPrNumber } from './adwBuildHelpers';


/**
 * Main orchestrator workflow.
 */
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

  const tracker = new CostTracker();

  try {
    await runPhase(config, tracker, executeInstallPhase);
    await runPhasesParallel(config, tracker, [executePlanPhase, executeScenarioPhase]);
    await runPhase(config, tracker, executeAlignmentPhase);
    await runPhase(config, tracker, executeBuildPhase);
    const testResult = await runPhase(config, tracker, executeUnitTestPhase);

    // Scenario test phase — proof path needed for review
    const scenarioResult = await runPhase(config, tracker, executeScenarioTestPhase);
    let proofPath = scenarioResult.scenarioProof?.resultsFilePath ?? '';

    // Review → patch+retest retry loop (orchestrator-level, bounded by MAX_REVIEW_RETRY_ATTEMPTS)
    let reviewRetries = 0;
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

    // Post-PR: approve and write awaiting_merge (API calls only — no worktree required).
    const prNumber = extractPrNumber(config.ctx.prUrl);
    const owner = config.repoContext?.repoId.owner ?? '';
    const repo = config.repoContext?.repoId.repo ?? '';
    if (prNumber && owner && repo) {
      const repoInfo: RepoInfo = { owner, repo };
      if (issueHasLabel(issueNumber, 'hitl', repoInfo)) {
        log(`hitl label detected on issue #${issueNumber}, skipping auto-approval`, 'info');
        commentOnIssue(issueNumber, `## ✋ Awaiting human approval — PR #${prNumber} ready for review`, repoInfo);
      } else if (isGitHubAppConfigured()) {
        log(`Approving PR #${prNumber} with personal gh auth login identity...`, 'info');
        const approveResult = approvePR(prNumber, repoInfo);
        if (!approveResult.success) log(`PR approval failed (non-fatal): ${approveResult.error}`, 'warn');
      } else {
        log('No GitHub App configured — skipping PR approval', 'info');
      }
    }
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
  } catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

main();
