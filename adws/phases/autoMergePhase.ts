/**
 * Auto-merge phase for review orchestrators.
 *
 * After the review phase passes and the PR has been created, this phase:
 * 1. Approves the PR using the personal gh auth login identity (only when a GitHub App
 *    is configured — i.e., the PR was authored by the bot, so a different actor must approve).
 * 2. Merges the PR via `gh pr merge`, resolving conflicts with the /resolve_conflict agent
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
import { commentOnPR, approvePR, isGitHubAppConfigured, commentOnIssue, issueHasLabel, type RepoInfo } from '../github';
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
 * Executes the auto-merge phase: approve (if GitHub App configured) then merge the PR.
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

  // Gate: if the issue has the `hitl` label, skip auto-approval and auto-merge.
  // The label is checked in real time so it can be added/removed during the workflow.
  if (issueHasLabel(issueNumber, 'hitl', repoInfo)) {
    log(`hitl label detected on issue #${issueNumber}, skipping auto-approval and auto-merge`, 'info');
    commentOnIssue(
      issueNumber,
      `## ✋ Awaiting human approval — PR #${prNumber} ready for review`,
      repoInfo,
    );
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }

  const headBranch = ctx.branchName || branchName;
  const baseBranch = defaultBranch;

  // Resolve spec path for the /resolve_conflict agent (best-effort)
  let specPath = '';
  const candidate = getPlanFilePath(issueNumber, worktreePath);
  if (planFileExists(issueNumber, worktreePath)) {
    specPath = candidate;
  }

  // Approve the PR when a GitHub App is configured (bot authored → personal account approves)
  if (isGitHubAppConfigured()) {
    log(`Approving PR #${prNumber} with personal gh auth login identity...`, 'info');
    const approveResult = approvePR(prNumber, repoInfo);
    if (!approveResult.success) {
      log(`PR approval failed (non-fatal, proceeding to merge): ${approveResult.error}`, 'warn');
    }
  } else {
    log('No GitHub App configured — skipping PR approval, merging directly', 'info');
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
