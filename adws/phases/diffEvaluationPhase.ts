import { log, emptyModelUsageMap } from '../core';
import type { ModelUsageMap } from '../core';
import { createPhaseCostRecords, PhaseCostStatus } from '../cost';
import type { PhaseCostRecord } from '../cost';
import { runDiffEvaluatorAgent } from '../agents/diffEvaluatorAgent';
import type { WorkflowConfig } from './workflowInit';
import type { GitContext } from '@paysdoc/devplatform/git';

export type DiffEvaluationPhaseResult = {
  costUsd: number;
  modelUsage: ModelUsageMap;
  phaseCostRecords: PhaseCostRecord[];
  verdict: 'safe' | 'regression_possible';
};

/** Returns an empty string on error or when no context is available. */
function getGitDiff(ctx: GitContext | undefined, worktreePath: string, defaultBranch: string): string {
  if (!ctx) return '';
  try {
    return ctx.diff(`${defaultBranch}...HEAD`, worktreePath);
  } catch (error) {
    log(`Failed to get git diff: ${error}`, 'warn');
    return '';
  }
}

/** Errors are caught and logged to prevent workflow crashes from comment failures. */
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

/** Defaults to 'regression_possible' on any agent error (fail-safe). */
export async function executeDiffEvaluationPhase(
  config: WorkflowConfig,
): Promise<DiffEvaluationPhaseResult> {
  const { adwId, issueNumber, worktreePath, defaultBranch, logsDir, issue, repoContext } = config;
  const phaseStartTime = Date.now();

  log('Phase: Diff Evaluation', 'info');

  const diff = getGitDiff(config.gitContext, worktreePath, defaultBranch);

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
  const costUsd = 0;
  let modelUsage = emptyModelUsageMap();

  try {
    const result = await runDiffEvaluatorAgent(diff, {
      logsDir,
      issueBody: issue.body,
      cwd: worktreePath,
      launchContext: { selfHost: !repoContext, adwId, gitContext: config.gitContext },
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
