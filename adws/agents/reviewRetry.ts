/**
 * Review-patch retry loop for automated review and patching.
 * Iterates: review -> patch blockers -> commit+push -> re-review.
 */

import { log, AgentStateManager, type IssueClassSlashCommand, type ModelUsageMap, emptyModelUsageMap } from '../core';
import { initAgentState, trackCost, type AgentRunResult } from '../core/retryOrchestrator';
import { runReviewAgent, type ReviewIssue, type ReviewAgentResult } from './reviewAgent';
import { runPatchAgent } from './patchAgent';
import { runCommitAgent } from './gitAgent';
import { pushBranch } from '../github';

export interface ReviewRetryResult {
  passed: boolean;
  costUsd: number;
  totalRetries: number;
  blockerIssues: ReviewIssue[];
  modelUsage: ModelUsageMap;
}

export interface ReviewRetryOptions {
  adwId: string;
  specFile: string;
  logsDir: string;
  orchestratorStatePath: string;
  maxRetries: number;
  branchName: string;
  issueType: IssueClassSlashCommand;
  issueContext: string;
  onReviewFailed?: (attempt: number, maxAttempts: number) => void;
  cwd?: string;
  /** Optional application URL for the dev server (e.g. http://localhost:12345) */
  applicationUrl?: string;
}

export async function runReviewWithRetry(opts: ReviewRetryOptions): Promise<ReviewRetryResult> {
  const {
    adwId, specFile, logsDir, orchestratorStatePath: statePath,
    maxRetries, branchName, issueType, issueContext, onReviewFailed, cwd, applicationUrl,
  } = opts;

  let retryCount = 0;
  let lastBlockerIssues: ReviewIssue[] = [];
  const costState = { costUsd: 0, modelUsage: emptyModelUsageMap() };

  while (retryCount < maxRetries) {
    log(`Running review (attempt ${retryCount + 1}/${maxRetries})...`, 'info');
    AgentStateManager.appendLog(statePath, `Review attempt ${retryCount + 1}/${maxRetries}`);

    const reviewResult: ReviewAgentResult = await runReviewAgent(
      adwId, specFile, logsDir, initAgentState(statePath, 'review-agent'), cwd, applicationUrl,
    );
    trackCost(reviewResult as AgentRunResult, costState, statePath);

    if (reviewResult.passed) {
      log('Review passed — no blocker issues found!', 'success');
      AgentStateManager.appendLog(statePath, 'Review passed');
      return { passed: true, costUsd: costState.costUsd, totalRetries: retryCount, blockerIssues: [], modelUsage: costState.modelUsage };
    }

    lastBlockerIssues = reviewResult.blockerIssues;
    log(`${lastBlockerIssues.length} blocker issue(s) found, patching...`, 'info');
    AgentStateManager.appendLog(statePath, `${lastBlockerIssues.length} blocker issue(s) found`);

    // Patch each blocker issue
    for (const blockerIssue of lastBlockerIssues) {
      log(`Patching blocker #${blockerIssue.reviewIssueNumber}: ${blockerIssue.issueDescription}`, 'info');
      AgentStateManager.appendLog(statePath, `Patching blocker #${blockerIssue.reviewIssueNumber}`);

      const patchResult = await runPatchAgent(
        adwId, blockerIssue, logsDir, specFile, undefined, initAgentState(statePath, 'patch-agent'), cwd,
      );
      trackCost(patchResult as AgentRunResult, costState, statePath);

      const msg = patchResult.success ? 'Patch applied for' : 'Patch failed for';
      log(`${msg} blocker #${blockerIssue.reviewIssueNumber}`, patchResult.success ? 'success' : 'error');
      AgentStateManager.appendLog(statePath, `${msg} blocker #${blockerIssue.reviewIssueNumber}`);
    }

    // Commit and push changes before re-review
    await runCommitAgent('review-agent', issueType, issueContext, logsDir, undefined, cwd);
    pushBranch(branchName, cwd);
    log('Changes committed and pushed', 'success');
    AgentStateManager.appendLog(statePath, 'Patch changes committed and pushed');

    onReviewFailed?.(retryCount + 1, maxRetries);
    retryCount++;
  }

  log(`Review still has blockers after ${maxRetries} attempts`, 'error');
  AgentStateManager.appendLog(statePath, `Review still has blockers after ${maxRetries} attempts`);
  return { passed: false, costUsd: costState.costUsd, totalRetries: retryCount, blockerIssues: lastBlockerIssues, modelUsage: costState.modelUsage };
}
