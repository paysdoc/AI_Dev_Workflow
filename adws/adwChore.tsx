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

  if (!await runWithOrchestratorLifecycle(config, async () => {
    const tracker = new CostTracker();
    try {
      await runPhase(config, tracker, executeInstallPhase);
      await runPhase(config, tracker, executePlanPhase);
      await runPhase(config, tracker, executeBuildPhase);
      await runPhase(config, tracker, executeStepDefPhase, 'stepDef');
      const testResult = await runPhase(config, tracker, executeUnitTestPhase);

      const { scenarioProofPath, scenarioRetries } = await runScenarioTestFixLoop(config, tracker);

      // Diff evaluation uses git diff against the default branch (worktree-dependent).
      // Runs before PR so the worktree is still available.
      const diffResult = await runPhase(config, tracker, executeDiffEvaluationPhase);

      let reviewPassed: boolean | undefined;
      let reviewRetries = 0;
      if (diffResult.verdict !== 'safe') {
        postEscalationComment(config);

        let proofPath = scenarioProofPath;
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

        // Document phase runs Claude agent + git commit/push — worktree-dependent, must run before PR.
        await runPhase(config, tracker, (cfg: WorkflowConfig) => executeDocumentPhase(cfg));
      }

      await runPhase(config, tracker, executePRPhase);

      // Race accepted — a human can add hitl between this approval and the next cron tick;
      // the merge gate is permissive in that case (rule 3).
      if (config.repoContext && config.ctx.prUrl) {
        const { issueTracker, codeHost } = config.repoContext;
        const prNumber = extractPrNumber(config.ctx.prUrl);
        if (prNumber && !issueTracker.fetchLabels(issueNumber).includes('hitl')) {
          log(`Chore: pre-approving PR #${prNumber} (no hitl on issue #${issueNumber})`, 'info');
          const result = codeHost.approvePullRequest(prNumber);
          if (!result.success) {
            log(`Chore: pre-approval failed (non-fatal — hitl-removed humans can still approve manually): ${result.error}`, 'warn');
          }
        } else if (prNumber) {
          log(`Chore: skipping pre-approval — issue #${issueNumber} has hitl label`, 'info');
        }
      }

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
