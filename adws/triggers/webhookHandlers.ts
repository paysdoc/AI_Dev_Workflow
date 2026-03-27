/**
 * Webhook Event Handlers
 *
 * Contains event handler functions extracted from trigger_webhook.ts:
 * - handlePullRequestEvent
 */

import { existsSync } from 'fs';
import { log, PullRequestWebhookPayload } from '../core';
import type { RepoInfo } from '../github/githubApi';
import { closeIssue, formatIssueClosureComment } from '../github/githubApi';
import { removeWorktree } from '../vcs';
import { deleteRemoteBranch } from '../vcs';
import { getTargetRepoWorkspacePath } from '../core/targetRepoManager';

/**
 * Extracts issue number from a branch name using the "issue-N" pattern.
 * All ADW branches follow the format {prefix}/issue-{number}-{slug}.
 * Returns null if the pattern does not match or input is falsy.
 */
export function extractIssueNumberFromBranch(branchName: string | null | undefined): number | null {
  if (!branchName) {
    return null;
  }
  const match = branchName.match(/issue-(\d+)/);
  return match ? parseInt(match[1], 10) : null;
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

  // Extract issue number from branch name (sole mechanism — branch names are deterministic)
  const issueNumber = extractIssueNumberFromBranch(headBranch);
  if (issueNumber === null) {
    log(`No issue link found in PR #${prNumber} (no \`issue-N\` pattern in branch name: ${headBranch})`);
    return { status: 'ignored' };
  }

  log(`Found linked issue #${issueNumber} from branch name: ${headBranch}`);

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

  return { status: closed ? 'closed' : 'already_closed', issue: issueNumber };
}
