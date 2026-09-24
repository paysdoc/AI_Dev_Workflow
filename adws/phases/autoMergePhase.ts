/**
 * Failure is non-fatal: if the merge cannot complete, a comment is posted on the PR and the
 * workflow continues to its completion comment.
 */

import { writeFileSync } from 'fs';
import * as path from 'path';
import {
  log,
  type ModelUsageMap,
  emptyModelUsageMap,
} from '../core';
import { createPhaseCostRecords, PhaseCostStatus, type PhaseCostRecord } from '../cost';
import { mergeWithConflictResolution } from '../triggers/autoMergeHandler';
import { getPlanFilePath, planFileExists } from '../agents';
import type { WorkflowConfig } from './workflowInit';

/** Returns 0 if the URL is absent or unparseable. */
function extractPrNumber(prUrl: string | undefined): number {
  if (!prUrl) return 0;
  const parts = prUrl.split('/pull/');
  if (parts.length < 2) return 0;
  const n = parseInt(parts[1], 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Always returns successfully — merge failures are logged and commented but do not
 * propagate as thrown errors.
 */
export async function executeAutoMergePhase(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const { adwId, issueNumber, worktreePath, logsDir, defaultBranch, branchName, ctx, repoContext, gitContext } = config;
  const phaseStartTime = Date.now();

  const prNumber = extractPrNumber(ctx.prUrl);
  if (!prNumber) {
    log('executeAutoMergePhase: no PR URL found, skipping auto-merge', 'warn');
    writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'No PR URL found, skipping auto-merge');
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  if (!repoContext) {
    log('executeAutoMergePhase: no repo context, skipping auto-merge', 'warn');
    writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'No repo context available, skipping auto-merge');
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  if (!gitContext) {
    log('executeAutoMergePhase: no git context, skipping auto-merge', 'warn');
    writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'No git context available, skipping auto-merge');
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  // Gate: if the issue has the `hitl` label, silently skip — no comment.
  // Prevents comment floods on every cron re-entry while awaiting human review.
  if (repoContext.issueTracker.fetchLabels(issueNumber).includes('hitl')) {
    log(`hitl label detected on issue #${issueNumber}, skipping auto-merge`, 'info');
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  const headBranch = ctx.branchName || branchName;
  const baseBranch = defaultBranch;

  const hasApproval = repoContext.codeHost.isPullRequestApproved(prNumber);
  if (!hasApproval) {
    log(`No APPROVED review found on PR #${prNumber}, applying hitl label and posting comment`, 'info');
    repoContext.issueTracker.addLabel(issueNumber, 'hitl');
    repoContext.issueTracker.commentOnIssue(
      issueNumber,
      `## ✋ Awaiting human approval — PR #${prNumber} ready for review\n\nNo approved review found on the PR. A human must approve before auto-merge can proceed.`,
    );
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  let specPath = '';
  const candidate = getPlanFilePath(issueNumber, worktreePath);
  if (planFileExists(issueNumber, worktreePath)) {
    specPath = candidate;
  }

  const mergeOutcome = await mergeWithConflictResolution(
    prNumber,
    repoContext.codeHost,
    headBranch,
    baseBranch,
    worktreePath,
    adwId,
    logsDir,
    specPath,
    gitContext,
  );

  if (!mergeOutcome.success) {
    log(`Auto-merge failed after retries (non-fatal): ${mergeOutcome.error}`, 'warn');
    const lastError = mergeOutcome.error || '';
    const failureComment = [
      `## Auto-merge failed for PR #${prNumber}`,
      '',
      'The automated merge process was unable to merge this PR after multiple attempts.',
      '',
      lastError ? `**Last error:** ${lastError.substring(0, 500)}` : '',
      '',
      'Please resolve any remaining merge conflicts manually and merge the PR.',
    ].filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');

    repoContext.codeHost.commentOnPullRequest(prNumber, failureComment);
    log(`Posted auto-merge failure comment on PR #${prNumber}`, 'info');
  } else {
    log(`PR #${prNumber} merged successfully`, 'success');
  }

  const phaseCostRecords = createPhaseCostRecords({
    workflowId: adwId,
    issueNumber,
    phase: 'auto_merge',
    status: PhaseCostStatus.Success,
    retryCount: 0,
    contextResetCount: 0,
    durationMs: Date.now() - phaseStartTime,
    modelUsage: emptyModelUsageMap(),
  });

  return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords };
}
