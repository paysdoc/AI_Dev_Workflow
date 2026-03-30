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
 * 5. Test Phase: optionally run unit tests (unit only)
 * 6. PR Phase: create pull request
 * 7. Diff Evaluation Phase: LLM evaluates the diff (Haiku, low effort)
 *    → if "safe":              auto-approve + auto-merge
 *    → if "regression_possible": post escalation comment
 *                               → review → document → auto-merge
 * 8. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 */

import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, log } from './core';
import { CostTracker, runPhase, runPhaseWithContinuation } from './core/phaseRunner';
import {
  initializeWorkflow,
  executeInstallPhase,
  executePlanPhase,
  executeBuildPhase,
  buildPhaseOnTokenLimit,
  executeTestPhase,
  executePRPhase,
  executeReviewPhase,
  executeDocumentPhase,
  executeAutoMergePhase,
  executeDiffEvaluationPhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';
import type { WorkflowConfig } from './phases';

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
        'Phases: review → document → auto-merge',
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

  const tracker = new CostTracker();

  try {
    await runPhase(config, tracker, executeInstallPhase);
    await runPhase(config, tracker, executePlanPhase);
    await runPhaseWithContinuation(config, tracker, executeBuildPhase, buildPhaseOnTokenLimit);
    const testResult = await runPhase(config, tracker, executeTestPhase);
    await runPhase(config, tracker, executePRPhase);
    const diffResult = await runPhase(config, tracker, executeDiffEvaluationPhase);

    if (diffResult.verdict === 'safe') {
      await runPhase(config, tracker, executeAutoMergePhase);
      await completeWorkflow(config, tracker.totalCostUsd, {
        unitTestsPassed: testResult.unitTestsPassed,
        totalTestRetries: testResult.totalRetries,
        diffVerdict: 'safe',
      }, tracker.totalModelUsage);
    } else {
      postEscalationComment(config);
      const reviewResult = await runPhase(config, tracker, executeReviewPhase);
      await runPhase(config, tracker, (cfg: WorkflowConfig) => executeDocumentPhase(cfg));
      await runPhase(config, tracker, executeAutoMergePhase);
      await completeWorkflow(config, tracker.totalCostUsd, {
        unitTestsPassed: testResult.unitTestsPassed,
        totalTestRetries: testResult.totalRetries,
        diffVerdict: 'regression_possible',
        reviewPassed: reviewResult.reviewPassed,
        totalReviewRetries: reviewResult.totalRetries,
      }, tracker.totalModelUsage);
    }
  } catch (error) {
    handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
  }
}

main();
