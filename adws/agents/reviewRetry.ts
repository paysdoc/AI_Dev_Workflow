/**
 * Review-patch retry loop with multi-agent parallel review.
 * Iterates: 3 parallel review agents -> merge results -> patch blockers -> commit+push -> re-review.
 */

import { log, AgentStateManager, type IssueClassSlashCommand, type ModelUsageMap, emptyModelUsageMap, type AgentIdentifier } from '../core';
import { initAgentState, trackCost, type AgentRunResult } from '../core/retryOrchestrator';
import { runReviewAgent, type ReviewIssue, type ReviewAgentResult } from './reviewAgent';
import { runPatchAgent } from './patchAgent';
import { runCommitAgent } from './gitAgent';
import { pushBranch } from '../vcs';

/** Number of parallel review agents per iteration. */
export const REVIEW_AGENT_COUNT = 3;

export interface MergedReviewResult {
  mergedIssues: ReviewIssue[];
  mergedScreenshots: string[];
  passed: boolean;
  blockerIssues: ReviewIssue[];
}

export interface ReviewRetryResult {
  passed: boolean;
  costUsd: number;
  totalRetries: number;
  blockerIssues: ReviewIssue[];
  modelUsage: ModelUsageMap;
  reviewSummary?: string;
  allScreenshots: string[];
  allSummaries: string[];
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
  onReviewFailed?: (attempt: number, maxAttempts: number, blockerIssues: ReviewIssue[]) => void;
  onPatchingIssue?: (issue: ReviewIssue) => void;
  cwd?: string;
  /** Optional application URL for the dev server (e.g. http://localhost:12345) */
  applicationUrl?: string;
  /** Optional issue body for fast/cheap model selection */
  issueBody?: string;
}

/**
 * Merges review results from multiple parallel agents.
 * Deduplicates issues by exact match on trimmed lowercase issueDescription.
 * Deduplicates screenshots by path.
 * Pure function with no side effects.
 */
export function mergeReviewResults(results: readonly ReviewAgentResult[]): MergedReviewResult {
  const validResults = results.filter(r => r.reviewResult !== null);

  // Collect and deduplicate issues
  const seenDescriptions = new Set<string>();
  const mergedIssues = validResults
    .flatMap(r => r.reviewResult!.reviewIssues)
    .filter(issue => {
      const key = issue.issueDescription.trim().toLowerCase();
      if (seenDescriptions.has(key)) return false;
      seenDescriptions.add(key);
      return true;
    });

  // Collect and deduplicate screenshots
  const seenPaths = new Set<string>();
  const mergedScreenshots = validResults
    .flatMap(r => r.reviewResult!.screenshots)
    .filter(screenshot => {
      if (seenPaths.has(screenshot)) return false;
      seenPaths.add(screenshot);
      return true;
    });

  const blockerIssues = mergedIssues.filter(issue => issue.issueSeverity === 'blocker');
  const passed = blockerIssues.length === 0;

  return { mergedIssues, mergedScreenshots, passed, blockerIssues };
}

/**
 * Runs multiple review agents in parallel with automatic retry logic on failure.
 * On each attempt: launches 3 review agents concurrently, merges results,
 * patches any blocker issues with a single patch agent, commits, pushes, and re-reviews.
 */
export async function runReviewWithRetry(opts: ReviewRetryOptions): Promise<ReviewRetryResult> {
  const {
    adwId, specFile, logsDir, orchestratorStatePath: statePath,
    maxRetries, branchName, issueType, issueContext, onReviewFailed, onPatchingIssue, cwd, applicationUrl, issueBody,
  } = opts;

  let retryCount = 0;
  let lastBlockerIssues: ReviewIssue[] = [];
  const costState = { costUsd: 0, modelUsage: emptyModelUsageMap() };
  const allScreenshots: string[] = [];
  const allSummaries: string[] = [];

  while (retryCount < maxRetries) {
    log(`Running review (attempt ${retryCount + 1}/${maxRetries}) with ${REVIEW_AGENT_COUNT} parallel agents...`, 'info');
    AgentStateManager.appendLog(statePath, `Review attempt ${retryCount + 1}/${maxRetries} (${REVIEW_AGENT_COUNT} agents)`);

    // Launch REVIEW_AGENT_COUNT review agents in parallel
    const agentIndices = Array.from({ length: REVIEW_AGENT_COUNT }, (_, i) => i + 1);
    const reviewResults: ReviewAgentResult[] = await Promise.all(
      agentIndices.map(index =>
        runReviewAgent(
          adwId, specFile, logsDir, initAgentState(statePath, `review-agent-${index}` as AgentIdentifier), cwd, applicationUrl, issueBody, index,
        )
      )
    );

    // Track cost for each agent result
    reviewResults.forEach(result => trackCost(result as AgentRunResult, costState, statePath));

    // Collect summaries from all agents
    reviewResults
      .filter(result => result.reviewResult?.reviewSummary)
      .forEach(result => allSummaries.push(result.reviewResult!.reviewSummary!));

    // Merge and deduplicate results
    const merged = mergeReviewResults(reviewResults);
    allScreenshots.push(...merged.mergedScreenshots);

    if (merged.passed) {
      log('Review passed — no blocker issues found!', 'success');
      AgentStateManager.appendLog(statePath, 'Review passed');
      const reviewSummary = allSummaries.find(s => s.length > 0);
      return {
        passed: true, costUsd: costState.costUsd, totalRetries: retryCount,
        blockerIssues: [], modelUsage: costState.modelUsage,
        reviewSummary, allScreenshots, allSummaries,
      };
    }

    lastBlockerIssues = merged.blockerIssues;
    log(`${lastBlockerIssues.length} merged blocker issue(s) found, patching...`, 'info');
    AgentStateManager.appendLog(statePath, `${lastBlockerIssues.length} merged blocker issue(s) found`);

    // Patch each blocker issue with a single patch agent (sequential)
    for (const blockerIssue of lastBlockerIssues) {
      onPatchingIssue?.(blockerIssue);
      log(`Patching blocker #${blockerIssue.reviewIssueNumber}: ${blockerIssue.issueDescription}`, 'info');
      AgentStateManager.appendLog(statePath, `Patching blocker #${blockerIssue.reviewIssueNumber}`);

      const patchResult = await runPatchAgent(
        adwId, blockerIssue, logsDir, specFile, undefined, initAgentState(statePath, 'patch-agent'), cwd, issueBody,
      );
      trackCost(patchResult as AgentRunResult, costState, statePath);

      const msg = patchResult.success ? 'Patch applied for' : 'Patch failed for';
      log(`${msg} blocker #${blockerIssue.reviewIssueNumber}`, patchResult.success ? 'success' : 'error');
      AgentStateManager.appendLog(statePath, `${msg} blocker #${blockerIssue.reviewIssueNumber}`);
    }

    // Commit and push changes before re-review
    await runCommitAgent('review-agent', issueType, issueContext, logsDir, undefined, cwd, issueBody);
    pushBranch(branchName, cwd);
    log('Changes committed and pushed', 'success');
    AgentStateManager.appendLog(statePath, 'Patch changes committed and pushed');

    onReviewFailed?.(retryCount + 1, maxRetries, lastBlockerIssues);
    retryCount++;
  }

  log(`Review still has blockers after ${maxRetries} attempts`, 'error');
  AgentStateManager.appendLog(statePath, `Review still has blockers after ${maxRetries} attempts`);
  const reviewSummary = allSummaries.find(s => s.length > 0);
  return {
    passed: false, costUsd: costState.costUsd, totalRetries: retryCount,
    blockerIssues: lastBlockerIssues, modelUsage: costState.modelUsage,
    reviewSummary, allScreenshots, allSummaries,
  };
}
