/**
 * Diff evaluation phase.
 *
 * Runs the diff evaluator agent against the current branch diff,
 * posts the verdict as an audit comment on the issue, and returns
 * the verdict for orchestrator branching.
 *
 * Defaults to 'regression_possible' on any agent failure (fail-safe).
 */

import { execSync } from 'child_process';
import { log, emptyModelUsageMap } from '../core';
import type { ModelUsageMap } from '../core';
import { createPhaseCostRecords, PhaseCostStatus } from '../cost';
import type { PhaseCostRecord } from '../cost';
import { runDiffEvaluatorAgent } from '../agents/diffEvaluatorAgent';
import type { WorkflowConfig } from './workflowInit';

export type DiffEvaluationPhaseResult = {
  costUsd: number;
  modelUsage: ModelUsageMap;
  phaseCostRecords: PhaseCostRecord[];
  verdict: 'safe' | 'regression_possible';
};

/**
 * Gets the git diff for the current branch against the default branch.
 * Returns an empty string on error.
 */
function getGitDiff(worktreePath: string, defaultBranch: string): string {
  try {
    return execSync(`git diff ${defaultBranch}...HEAD`, {
      cwd: worktreePath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch (error) {
    log(`Failed to get git diff: ${error}`, 'warn');
    return '';
  }
}

/**
 * Posts a diff verdict comment on the issue (audit trail).
 * Errors are caught and logged to prevent workflow crashes from comment failures.
 */
function postVerdictComment(
  config: WorkflowConfig,
  verdict: 'safe' | 'regression_possible',
  reason: string,
): void {
  const { repoContext, issueNumber } = config;
  if (!repoContext) return;

  const verdictEmoji = verdict === 'safe' ? '✅' : '⚠️';
  const outcome = verdict === 'safe'
    ? 'Auto-approving and merging.'
    : 'Escalating to review → document → auto-merge.';

  const comment = [
    '## Diff Evaluation',
    '',
    `**Verdict:** ${verdictEmoji} \`${verdict}\``,
    `**Reason:** ${reason}`,
    '',
    outcome,
  ].join('\n');

  try {
    repoContext.issueTracker.commentOnIssue(issueNumber, comment);
  } catch (error) {
    log(`Failed to post diff verdict comment: ${error}`, 'warn');
  }
}

/**
 * Executes the diff evaluation phase: runs the LLM diff evaluator,
 * posts the verdict as an issue comment (audit trail), and returns the verdict.
 *
 * Defaults to 'regression_possible' on any agent error (fail-safe).
 */
export async function executeDiffEvaluationPhase(
  config: WorkflowConfig,
): Promise<DiffEvaluationPhaseResult> {
  const { adwId, issueNumber, worktreePath, defaultBranch, logsDir, issue } = config;
  const phaseStartTime = Date.now();

  log('Phase: Diff Evaluation', 'info');

  const diff = getGitDiff(worktreePath, defaultBranch);

  if (!diff) {
    log('Empty diff — classifying as safe (no changes to regress)', 'info');
    postVerdictComment(config, 'safe', 'No changes detected in diff — nothing to regress.');
    return {
      costUsd: 0,
      modelUsage: emptyModelUsageMap(),
      phaseCostRecords: createPhaseCostRecords({
        workflowId: adwId,
        issueNumber,
        phase: 'diff_evaluation',
        status: PhaseCostStatus.Success,
        retryCount: 0,
        contextResetCount: 0,
        durationMs: Date.now() - phaseStartTime,
        modelUsage: emptyModelUsageMap(),
      }),
      verdict: 'safe',
    };
  }

  let verdict: 'safe' | 'regression_possible' = 'regression_possible';
  let reason = 'Diff evaluation failed — defaulting to regression_possible (fail-safe)';
  let costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  try {
    const result = await runDiffEvaluatorAgent(diff, {
      logsDir,
      issueBody: issue.body,
      cwd: worktreePath,
    });

    modelUsage = result.modelUsage ?? emptyModelUsageMap();

    if (result.parsed) {
      verdict = result.parsed.verdict;
      reason = result.parsed.reason;
      log(`Diff evaluation verdict: ${verdict} — ${reason}`, 'info');
    } else {
      log('Diff evaluator returned no parsed verdict — defaulting to regression_possible', 'warn');
    }
  } catch (error) {
    log(`Diff evaluator agent failed: ${error}`, 'warn');
  }

  postVerdictComment(config, verdict, reason);

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'diff_evaluation',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage,
  });

  return { costUsd, modelUsage, phaseCostRecords, verdict };
}
