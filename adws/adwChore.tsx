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
 * 6. Diff Evaluation Phase: LLM evaluates the diff (Haiku, low effort — worktree-dependent)
 *    → if "regression_possible": post escalation comment → review → document
 * 7. PR Phase: create pull request
 * 8. Approve PR + write awaiting_merge to state (API calls only — no worktree required)
 * 9. Finalize: update state, post completion comment
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
  executeStepDefPhase,
  executeUnitTestPhase,
  executePRPhase,
  executeReviewPhase,
  executeDocumentPhase,
  executeDiffEvaluationPhase,
  handleWorkflowError,
} from './workflowPhases';
import { persistTokenCounts } from './cost';
import type { WorkflowConfig } from './phases';
import { approvePR, isGitHubAppConfigured, issueHasLabel, commentOnIssue, type RepoInfo } from './github';
import { extractPrNumber } from './adwBuildHelpers';

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
    await runPhase(config, tracker, executeStepDefPhase, 'stepDef');
    const testResult = await runPhase(config, tracker, executeUnitTestPhase);

    // Diff evaluation uses git diff against the default branch (worktree-dependent).
    // Runs before PR so the worktree is still available.
    const diffResult = await runPhase(config, tracker, executeDiffEvaluationPhase);

    let reviewResult: { reviewPassed: boolean; totalRetries: number } | undefined;
    if (diffResult.verdict !== 'safe') {
      postEscalationComment(config);
      reviewResult = await runPhase(config, tracker, executeReviewPhase);
      // Document phase runs Claude agent + git commit/push — worktree-dependent, must run before PR.
      await runPhase(config, tracker, (cfg: WorkflowConfig) => executeDocumentPhase(cfg));
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
        diffVerdict: reviewResult ? 'regression_possible' : 'safe',
        ...(reviewResult ? {
          reviewPassed: reviewResult.reviewPassed,
          totalReviewRetries: reviewResult.totalRetries,
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
}

main();
