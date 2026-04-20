#!/usr/bin/env bunx tsx
/**
 * ADW Chore - Dedicated Chore Pipeline with LLM Diff Gate
 *
 * Usage: bunx tsx adws/adwChore.tsx <github-issueNumber> [adw-id] [--issue-type <type>]
 *
 * Workflow:
 * 1. Initialize: fetch issue, classify type, setup worktree, initialize state, detect recovery
 * 2. Install Phase: install dependencies
 * 3. Plan Phase: classify issue, create branch, run plan agent, commit plan
 * 4. Build Phase: run build agent, commit implementation
 * 5. Step Def Phase: generate BDD step definitions
 * 6. Unit Test Phase: optionally run unit tests (unit only)
 * 7. Scenario Test Phase [→ Scenario Fix Phase → retry]: run BDD scenarios, fix failures
 * 8. Diff Evaluation Phase: LLM evaluates the diff (Haiku, low effort — worktree-dependent)
 *    → if "regression_possible": post escalation comment → review → document
 * 9. PR Phase: create pull request
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
import { CostTracker, runPhase } from './core/phaseRunner';
import {
  initializeWorkflow,
  executeInstallPhase,
  executePlanPhase,
  executeBuildPhase,
  executeStepDefPhase,
  executeUnitTestPhase,
  executeScenarioTestPhase,
  executeScenarioFixPhase,
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

/**
 * Posts an escalation comment on the issue when the diff evaluator detects
 * possible regressions and the chore is escalated to the full review pipeline.
 */
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

/**
 * Main orchestrator workflow.
 */
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

      // Diff evaluation uses git diff against the default branch (worktree-dependent).
      // Runs before PR so the worktree is still available.
      const diffResult = await runPhase(config, tracker, executeDiffEvaluationPhase);

      let reviewPassed: boolean | undefined;
      let reviewRetries = 0;
      if (diffResult.verdict !== 'safe') {
        postEscalationComment(config);

        // Review → patch+retest retry loop (orchestrator-level, bounded by MAX_REVIEW_RETRY_ATTEMPTS)
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
            // Re-run scenario tests to verify patch didn't break scenarios
            const retestResult = await runPhase(config, tracker, executeScenarioTestPhase);
            proofPath = retestResult.scenarioProof?.resultsFilePath ?? '';
          }
        }

        // Document phase runs Claude agent + git commit/push — worktree-dependent, must run before PR.
        await runPhase(config, tracker, (cfg: WorkflowConfig) => executeDocumentPhase(cfg));
      }

      await runPhase(config, tracker, executePRPhase);

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
      handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
    }
  })) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
}

main();
