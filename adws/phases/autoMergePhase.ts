/**
 * Auto-merge phase for review orchestrators.
 *
 * After the review phase passes and the PR has been created, this phase:
 * 1. Silently skips if the issue has the `hitl` label (no comment on re-entry).
 * 2. Reads approval state from GitHub (`gh pr view --json reviews`).
 *    - If no APPROVED review exists: applies `hitl` label, posts a one-time comment, exits.
 *    - If an APPROVED review exists: proceeds to merge.
 * 3. Merges the PR via `gh pr merge`, resolving conflicts with the /resolve_conflict agent
 *    if needed (up to MAX_AUTO_MERGE_ATTEMPTS attempts).
 *
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
import { commentOnPR, commentOnIssue, issueHasLabel, addIssueLabel, fetchPRApprovalState, type RepoInfo } from '../github';
import { mergeWithConflictResolution } from '../triggers/autoMergeHandler';
import { getPlanFilePath, planFileExists } from '../agents';
import type { WorkflowConfig } from './workflowInit';

/**
 * Extracts the PR number from a GitHub PR URL (e.g. https://github.com/owner/repo/pull/42).
 * Returns 0 if the URL is absent or unparseable.
 */
function extractPrNumber(prUrl: string | undefined): number {
  if (!prUrl) return 0;
  const parts = prUrl.split('/pull/');
  if (parts.length < 2) return 0;
  const n = parseInt(parts[1], 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Executes the auto-merge phase: read approval state then merge the PR.
 * Always returns successfully — merge failures are logged and commented but do not
 * propagate as thrown errors.
 */
export async function executeAutoMergePhase(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }> {
  const { adwId, issueNumber, worktreePath, logsDir, defaultBranch, branchName, ctx, repoContext } = config;
  const phaseStartTime = Date.now();

  const prNumber = extractPrNumber(ctx.prUrl);
  if (!prNumber) {
    log('executeAutoMergePhase: no PR URL found, skipping auto-merge', 'warn');
    writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'No PR URL found, skipping auto-merge');
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  const owner = repoContext?.repoId.owner ?? '';
  const repo = repoContext?.repoId.repo ?? '';
  if (!owner || !repo) {
    log('executeAutoMergePhase: no repo context, skipping auto-merge', 'warn');
    writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'No repo context available, skipping auto-merge');
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  const repoInfo: RepoInfo = { owner, repo };

  // Gate: if the issue has the `hitl` label, silently skip — no comment.
  // Prevents comment floods on every cron re-entry while awaiting human review.
  if (issueHasLabel(issueNumber, 'hitl', repoInfo)) {
    log(`hitl label detected on issue #${issueNumber}, skipping auto-merge`, 'info');
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  const headBranch = ctx.branchName || branchName;
  const baseBranch = defaultBranch;

  // Gate: require at least one APPROVED review on the PR (GitHub is source of truth).
  const hasApproval = fetchPRApprovalState(prNumber, repoInfo);
  if (!hasApproval) {
    log(`No APPROVED review found on PR #${prNumber}, applying hitl label and posting comment`, 'info');
    addIssueLabel(issueNumber, 'hitl', repoInfo);
    commentOnIssue(
      issueNumber,
      `## ✋ Awaiting human approval — PR #${prNumber} ready for review\n\nNo approved review found on the PR. A human must approve before auto-merge can proceed.`,
      repoInfo,
    );
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  // Resolve spec path for the /resolve_conflict agent (best-effort)
  let specPath = '';
  const candidate = getPlanFilePath(issueNumber, worktreePath);
  if (planFileExists(issueNumber, worktreePath)) {
    specPath = candidate;
  }

  // Merge with conflict resolution retry loop
  const mergeOutcome = await mergeWithConflictResolution(
    prNumber,
    repoInfo,
    headBranch,
    baseBranch,
    worktreePath,
    adwId,
    logsDir,
    specPath,
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

    commentOnPR(prNumber, failureComment, repoInfo);
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
