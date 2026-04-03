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
 * 6. Diff Evaluation Phase: LLM evaluates the diff (Haiku, low effort)
 *    → if "safe":              PR → approve + awaiting_merge
 *    → if "regression_possible": post escalation comment
 *                               → review → document → PR → approve + awaiting_merge
 * 7. Finalize: update state, post completion comment
 *
 * Environment Requirements:
 * - ANTHROPIC_API_KEY: Anthropic API key
 * - CLAUDE_CODE_PATH: Path to Claude CLI (default: /usr/local/bin/claude)
 * - GITHUB_PAT: (Optional) GitHub Personal Access Token
 */

import { parseTargetRepoArgs, parseOrchestratorArguments, buildRepoIdentifier, OrchestratorId, AgentStateManager, log } from './core';
import { CostTracker, runPhase } from './core/phaseRunner';
import {
  initializeWorkflow,
  executeInstallPhase,
  executePlanPhase,
  executeBuildPhase,
  executeTestPhase,
  executePRPhase,
  executeReviewPhase,
  executeDocumentPhase,
  executeDiffEvaluationPhase,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';
import { approvePR, isGitHubAppConfigured } from './github';
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

  const tracker = new CostTracker();

  try {
    await runPhase(config, tracker, executeInstallPhase);
    await runPhase(config, tracker, executePlanPhase);
    await runPhase(config, tracker, executeBuildPhase);
    const testResult = await runPhase(config, tracker, executeTestPhase);
    const diffResult = await runPhase(config, tracker, executeDiffEvaluationPhase);

    if (diffResult.verdict === 'safe') {
      await runPhase(config, tracker, executePRPhase);
      // Post-PR: approve PR (when GitHub App is configured) and write awaiting_merge handoff
      {
        const prNum = config.ctx.prNumber;
        const owner = config.repoContext?.repoId.owner ?? '';
        const repo = config.repoContext?.repoId.repo ?? '';
        if (prNum && owner && repo && isGitHubAppConfigured()) {
          const approveResult = approvePR(prNum, { owner, repo });
          if (!approveResult.success) {
            log(`PR approval failed (non-fatal): ${approveResult.error}`, 'warn');
          }
        }
        AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'awaiting_merge' });
        log('Workflow handed off: awaiting_merge', 'info');
      }
      await completeWorkflow(config, tracker.totalCostUsd, {
        unitTestsPassed: testResult.unitTestsPassed,
        totalTestRetries: testResult.totalRetries,
        diffVerdict: 'safe',
      }, tracker.totalModelUsage);
    } else {
      postEscalationComment(config);
      const reviewResult = await runPhase(config, tracker, executeReviewPhase);
      await runPhase(config, tracker, (cfg: WorkflowConfig) => executeDocumentPhase(cfg));
      await runPhase(config, tracker, executePRPhase);
      // Post-PR: approve PR (when GitHub App is configured) and write awaiting_merge handoff
      {
        const prNum = config.ctx.prNumber;
        const owner = config.repoContext?.repoId.owner ?? '';
        const repo = config.repoContext?.repoId.repo ?? '';
        if (prNum && owner && repo && isGitHubAppConfigured()) {
          const approveResult = approvePR(prNum, { owner, repo });
          if (!approveResult.success) {
            log(`PR approval failed (non-fatal): ${approveResult.error}`, 'warn');
          }
        }
        AgentStateManager.writeTopLevelState(config.adwId, { workflowStage: 'awaiting_merge' });
        log('Workflow handed off: awaiting_merge', 'info');
      }
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
