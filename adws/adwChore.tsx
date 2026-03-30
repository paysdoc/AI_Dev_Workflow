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

import { OrchestratorId, log, emptyModelUsageMap } from './core';
import { defineOrchestrator, runOrchestrator, branch } from './core/orchestratorRunner';
import {
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
} from './workflowPhases';
import type { WorkflowConfig } from './workflowPhases';
import type { DiffEvaluationPhaseResult } from './workflowPhases';
import type { PhaseResult } from './core/phaseRunner';

type TestPhaseResult = Awaited<ReturnType<typeof executeTestPhase>>;
type ReviewPhaseResult = Awaited<ReturnType<typeof executeReviewPhase>>;

/**
 * Phase function that posts an escalation comment on the issue when the diff
 * evaluator detects possible regressions. Returns zero-cost result.
 */
async function executeEscalationCommentPhase(config: WorkflowConfig): Promise<PhaseResult> {
  const { repoContext, issueNumber } = config;
  if (repoContext) {
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
  return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
}

runOrchestrator(defineOrchestrator({
  id: OrchestratorId.Chore,
  scriptName: 'adwChore.tsx',
  usagePattern: '<github-issueNumber> [adw-id] [--issue-type <type>]',
  phases: [
    { name: 'install', execute: executeInstallPhase },
    { name: 'plan', execute: executePlanPhase },
    { name: 'build', execute: executeBuildPhase, onTokenLimit: buildPhaseOnTokenLimit },
    { name: 'test', execute: executeTestPhase },
    { name: 'pr', execute: executePRPhase },
    { name: 'diffEvaluation', execute: executeDiffEvaluationPhase },
    branch(
      'diff-verdict',
      (results) => results.get<DiffEvaluationPhaseResult>('diffEvaluation')?.verdict === 'safe',
      [
        { name: 'autoMerge', execute: executeAutoMergePhase },
      ],
      [
        { name: 'escalation', execute: executeEscalationCommentPhase },
        { name: 'review', execute: executeReviewPhase },
        { name: 'document', execute: (cfg: WorkflowConfig) => executeDocumentPhase(cfg) },
        { name: 'autoMerge', execute: executeAutoMergePhase },
      ],
    ),
  ],
  completionMetadata: (results) => {
    const test = results.get<TestPhaseResult>('test');
    const diff = results.get<DiffEvaluationPhaseResult>('diffEvaluation');
    const review = results.get<ReviewPhaseResult>('review');
    const verdict = diff?.verdict ?? 'regression_possible';

    const base: Record<string, unknown> = {
      unitTestsPassed: test?.unitTestsPassed ?? false,
      totalTestRetries: test?.totalRetries ?? 0,
      diffVerdict: verdict,
    };

    if (verdict === 'regression_possible' && review) {
      base.reviewPassed = review.reviewPassed;
      base.totalReviewRetries = review.totalRetries;
    }

    return base;
  },
}));
