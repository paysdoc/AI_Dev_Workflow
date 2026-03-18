/**
 * Webhook Event Handlers
 *
 * Contains event handler functions extracted from trigger_webhook.ts:
 * - handlePullRequestEvent
 * - extractIssueNumberFromPRBody
 */

import { existsSync } from 'fs';
import { log, PullRequestWebhookPayload, rebuildProjectCostCsv } from '../core';
import { fetchExchangeRates } from '../core/costReport';
import { costCommitQueue } from '../core/costCommitQueue';
import type { RepoInfo } from '../github/githubApi';
import { closeIssue, formatIssueClosureComment } from '../github/githubApi';
import { removeWorktree } from '../vcs';
import { deleteRemoteBranch, commitAndPushCostFiles, pullLatestCostBranch } from '../vcs';
import { getTargetRepoWorkspacePath } from '../core/targetRepoManager';

/**
 * Tracks issue numbers whose PRs were merged and cost CSV was already committed.
 * Prevents the issue close handler from reverting cost CSV files that were
 * intentionally kept by the PR merge handler.
 * Entries persist for the lifetime of the process (negligible memory per entry).
 */
const mergedPrIssues = new Set<number>();

/** Records that an issue's cost CSV was handled by a merged PR. */
function recordMergedPrIssue(issueNumber: number): void {
  mergedPrIssues.add(issueNumber);
}

/** Checks whether an issue was already handled by a merged PR. */
export function wasMergedViaPR(issueNumber: number): boolean {
  return mergedPrIssues.has(issueNumber);
}

/**
 * Extracts issue number from PR body using the "Implements #N" pattern.
 * Returns null if no issue link is found.
 */
export function extractIssueNumberFromPRBody(body: string | null): number | null {
  if (!body) {
    return null;
  }
  const match = body.match(/Implements #(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Extracts issue number from a branch name.
 * Tries the legacy "issue-N" pattern first (e.g., feature/issue-42-slug),
 * then falls back to the ADW branch format {type}-{issueNumber}-{adwId}-{slug}
 * (e.g., bugfix-233-y000tl-fix-issue).
 * Returns null if neither pattern matches or input is falsy.
 */
export function extractIssueNumberFromBranch(branchName: string | null | undefined): number | null {
  if (!branchName) {
    return null;
  }
  const legacyMatch = branchName.match(/issue-(\d+)/);
  if (legacyMatch) {
    return parseInt(legacyMatch[1], 10);
  }
  const adwMatch = branchName.match(/^(?:feat|feature|bug|bugfix|chore|fix|hotfix)-(\d+)-/);
  return adwMatch ? parseInt(adwMatch[1], 10) : null;
}

/**
 * Handles pull_request webhook events.
 * When a PR is closed (merged or not), closes the linked issue.
 */
export async function handlePullRequestEvent(payload: PullRequestWebhookPayload): Promise<{ status: string; issue?: number }> {
  const { action, pull_request, repository } = payload;

  log(`Received pull_request event: action=${action}, PR=#${pull_request.number}, repo=${repository.full_name}`);

  // Only handle closed PRs
  if (action !== 'closed') {
    log(`Ignored pull_request action: ${action}`);
    return { status: 'ignored' };
  }

  const prNumber = pull_request.number;
  const prUrl = pull_request.html_url;
  const wasMerged = pull_request.merged;
  const prBody = pull_request.body;
  const headBranch = pull_request.head?.ref;
  const workspacePath = getTargetRepoWorkspacePath(repository.owner.login, repository.name);
  const targetCwd = existsSync(workspacePath) ? workspacePath : undefined;

  log(`PR #${prNumber} was ${wasMerged ? 'merged' : 'closed without merging'}`);

  // Clean up worktree for the PR branch
  if (headBranch) {
    try {
      const removed = removeWorktree(headBranch, targetCwd);
      if (removed) {
        log(`Cleaned up worktree for branch: ${headBranch}`, 'success');
      } else {
        log(`No worktree found for branch: ${headBranch}`, 'info');
      }
    } catch (error) {
      log(`Failed to clean up worktree for branch ${headBranch}: ${error}`, 'error');
    }

    try {
      deleteRemoteBranch(headBranch, targetCwd);
    } catch (error) {
      log(`Failed to delete remote branch ${headBranch}: ${error}`, 'error');
    }
  }

  // Extract issue number from PR body, falling back to branch name
  const issueNumber = extractIssueNumberFromPRBody(prBody) ?? extractIssueNumberFromBranch(headBranch);
  if (issueNumber === null) {
    log(`No issue link found in PR #${prNumber} body (no "Implements #N" pattern)`);
    return { status: 'ignored' };
  }

  if (!extractIssueNumberFromPRBody(prBody)) {
    log(`Found linked issue #${issueNumber} from branch name: ${headBranch}`);
  } else {
    log(`Found linked issue #${issueNumber} in PR #${prNumber}`);
  }

  // Build repo info from the webhook payload so API calls target the correct repo
  const repoInfo: RepoInfo = {
    owner: repository.owner.login,
    repo: repository.name,
  };

  // Create closure comment
  const comment = formatIssueClosureComment(prNumber, prUrl, wasMerged);

  // Close the issue
  const closed = await closeIssue(issueNumber, repoInfo, comment);

  if (closed) {
    log(`Successfully closed issue #${issueNumber} after PR #${prNumber} was ${wasMerged ? 'merged' : 'closed'}`);
  } else {
    log(`Issue #${issueNumber} was already closed or could not be closed`);
  }

  // Handle cost CSV files through serialized queue
  try {
    const repoName = repository.name;
    await costCommitQueue.enqueue(async () => {
      pullLatestCostBranch();
      const rates = await fetchExchangeRates(['EUR']);
      const eurRate = rates['EUR'] ?? 0;

      if (wasMerged) {
        rebuildProjectCostCsv(process.cwd(), repoName, eurRate);
        commitAndPushCostFiles({ repoName });
        recordMergedPrIssue(issueNumber);
      } else {
        rebuildProjectCostCsv(process.cwd(), repoName, eurRate);
        commitAndPushCostFiles({ repoName });
      }
    });
  } catch (error) {
    log(`Failed to handle cost CSV files for issue #${issueNumber}: ${error}`, 'error');
  }

  return { status: closed ? 'closed' : 'already_closed', issue: issueNumber };
}
