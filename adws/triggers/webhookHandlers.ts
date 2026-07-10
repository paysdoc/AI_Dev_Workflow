/**
 * Webhook Event Handlers
 *
 * Contains event handler functions extracted from trigger_webhook.ts:
 * - handlePullRequestEvent: handles abandoned PRs (closed without merge)
 * - handleIssueClosedEvent: cleans up worktrees, branch, and dependencies
 */

import { log, PullRequestWebhookPayload, GRACE_PERIOD_MS, generateAdwId } from '../core';
import type { RepoInfo } from '../github/githubApi';
import type { GitContext } from '../gitContext';
import { closeIssue, fetchIssueCommentsRest } from '../github/issueApi';
import { fetchPRDetails, gitContextForSync } from '../github';
import { AgentStateManager } from '../core/agentState';
import { findOrchestratorStatePath } from '../core/stateHelpers';
import { extractLatestAdwId, isActiveStage, getLastActivityFromState } from './cronStageResolver';
import { closeAbandonedDependents } from './webhookGatekeeper';
import { handleIssueClosedDependencyUnblock } from './issueClosedUnblockRouter';
import type { AgentState } from '../types/agentTypes';
import { resolvePrReviewTarget } from '../core/resolvePrReviewTarget';

/**
 * Extracts issue number from a branch name using the "issue-N" pattern.
 * All ADW branches follow the format {prefix}/issue-{number}-{slug}.
 * Returns null if the pattern does not match or input is falsy.
 */
export function extractIssueNumberFromBranch(branchName: string | null | undefined): number | null {
  if (!branchName) return null;
  const match = branchName.match(/issue-(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// ── Injectable dependencies ────────────────────────────────────────────────

export interface PrClosedDeps {
  fetchIssueComments: (issueNumber: number, repoInfo: RepoInfo) => { body: string }[];
  writeTopLevelState: (adwId: string, state: Partial<AgentState>) => void;
  closeIssue: (issueNumber: number, repoInfo: RepoInfo, comment?: string) => Promise<boolean>;
}

export interface IssueClosedDeps {
  fetchIssueComments: (issueNumber: number, repoInfo: RepoInfo) => { body: string }[];
  readTopLevelState: (adwId: string) => AgentState | null;
  removeWorktreesForIssue: (issueNumber: number) => number;
  findOrchestratorStatePath: (adwId: string) => string | null;
  readOrchestratorState: (statePath: string) => AgentState | null;
  deleteRemoteBranch: (branchName: string, cwd?: string) => boolean;
  closeAbandonedDependents: (closedIssueNumber: number, repoInfo: RepoInfo) => Promise<void>;
  handleIssueClosedDependencyUnblock: (closedIssueNumber: number, repoInfo: RepoInfo, targetRepoArgs: string[], gitContext?: GitContext) => Promise<void>;
}

function defaultPrClosedDeps(): PrClosedDeps {
  return {
    fetchIssueComments: fetchIssueCommentsRest,
    writeTopLevelState: (adwId, state) => AgentStateManager.writeTopLevelState(adwId, state),
    closeIssue,
  };
}

function defaultIssueClosedDeps(repoInfo?: RepoInfo, cwd?: string): IssueClosedDeps {
  return {
    fetchIssueComments: fetchIssueCommentsRest,
    readTopLevelState: (adwId) => AgentStateManager.readTopLevelState(adwId),
    removeWorktreesForIssue: (issueNumber) =>
      repoInfo
        ? gitContextForSync({ owner: repoInfo.owner, repo: repoInfo.repo, selfHost: !cwd }).removeWorktreesForIssue(issueNumber)
        : 0,
    findOrchestratorStatePath,
    readOrchestratorState: (statePath) => AgentStateManager.readState(statePath),
    deleteRemoteBranch: repoInfo
      ? (branchName, cwd) => gitContextForSync({ owner: repoInfo.owner, repo: repoInfo.repo, selfHost: false }).deleteRemoteBranch(branchName, cwd)
      : () => false,
    closeAbandonedDependents,
    handleIssueClosedDependencyUnblock,
  };
}

// ── PR close handler ────────────────────────────────────────────────────────

/**
 * Handles pull_request.closed webhook events.
 * - Merged PRs: ignored (cleanup flows through issues.closed via GitHub auto-close).
 * - Closed-without-merge PRs: writes 'discarded' to state (terminal) and closes the linked issue.
 */
export async function handlePullRequestEvent(
  payload: PullRequestWebhookPayload,
  deps: PrClosedDeps = defaultPrClosedDeps(),
): Promise<{ status: string; issue?: number }> {
  const { action, pull_request, repository } = payload;
  log(`Received pull_request event: action=${action}, PR=#${pull_request.number}, repo=${repository.full_name}`);

  if (action !== 'closed') {
    return { status: 'ignored' };
  }

  // Merged PRs: GitHub auto-close fires issues.closed which handles all cleanup
  if (pull_request.merged) {
    log(`PR #${pull_request.number} was merged — cleanup flows through issues.closed`);
    return { status: 'ignored' };
  }

  // Abandoned PR (closed without merge)
  const headBranch = pull_request.head?.ref;
  const issueNumber = extractIssueNumberFromBranch(headBranch);
  if (issueNumber === null) {
    log(`No issue link found in PR #${pull_request.number} (no \`issue-N\` pattern in branch name: ${headBranch})`);
    return { status: 'ignored' };
  }

  log(`PR #${pull_request.number} abandoned — linked to issue #${issueNumber}`);
  const repoInfo: RepoInfo = { owner: repository.owner.login, repo: repository.name };

  // Write discarded state — operator-closed PR is a terminal decision; issues.closed handler routes to the abandoned-dependents path.
  try {
    const comments = deps.fetchIssueComments(issueNumber, repoInfo);
    const adwId = extractLatestAdwId(comments);
    if (adwId) {
      deps.writeTopLevelState(adwId, { workflowStage: 'discarded' });
      log(`Wrote discarded state for adwId=${adwId}`, 'info');
    }
  } catch (error) {
    log(`Failed to fetch comments/write state for issue #${issueNumber}: ${error}`, 'warn');
  }

  const comment = [
    '## PR Abandoned',
    '',
    `PR #${pull_request.number} was closed without merging.`,
    '',
    'This issue is being closed. Reopen this issue and its PR if you want to retry.',
  ].join('\n');

  const closed = await deps.closeIssue(issueNumber, repoInfo, comment);
  log(closed ? `Closed issue #${issueNumber} after abandoned PR` : `Issue #${issueNumber} already closed`);

  return { status: 'abandoned', issue: issueNumber };
}

// ── Issue close handler ─────────────────────────────────────────────────────

export interface IssueClosedResult {
  status: 'skipped' | 'cleaned';
  reason?: string;
  worktreesRemoved: number;
  branchDeleted: boolean;
}

/**
 * Handles issues.closed webhook events.
 * - Reads workflow state to detect abandoned vs. normal closure.
 * - Grace period guard: skips cleanup when orchestrator is still actively running.
 * - Cleans up worktrees and deletes the remote branch.
 * - Abandoned closure: closes dependent issues with an error comment.
 * - Normal closure: unblocks dependent issues and spawns their workflows.
 */
export async function handleIssueClosedEvent(
  issueNumber: number,
  repoInfo: RepoInfo | undefined,
  cwd: string | undefined,
  targetRepoArgs: string[] = [],
  deps?: IssueClosedDeps,
  gitContext?: GitContext,
): Promise<IssueClosedResult> {
  const d = deps ?? defaultIssueClosedDeps(repoInfo, cwd);
  let adwId: string | null = null;
  let workflowStage: string | undefined;
  let state: AgentState | null = null;

  // Fetch comments and resolve adw-id + state (requires repoInfo)
  if (repoInfo) {
    try {
      const comments = d.fetchIssueComments(issueNumber, repoInfo);
      adwId = extractLatestAdwId(comments);
    } catch (error) {
      log(`Failed to fetch comments for issue #${issueNumber}: ${error}`, 'warn');
    }
  }

  if (adwId) {
    state = d.readTopLevelState(adwId);
    workflowStage = state?.workflowStage;

    // Grace period guard: skip cleanup when orchestrator is actively in progress
    if (state && workflowStage && isActiveStage(workflowStage)) {
      const lastActivity = getLastActivityFromState(state);
      if (lastActivity !== null && Date.now() - lastActivity < GRACE_PERIOD_MS) {
        log(`Issue #${issueNumber}: skipping cleanup — stage '${workflowStage}' is active within grace period`, 'info');
        return { status: 'skipped', reason: 'active_within_grace_period', worktreesRemoved: 0, branchDeleted: false };
      }
    }
  }

  // Worktree cleanup
  const worktreesRemoved = d.removeWorktreesForIssue(issueNumber);
  log(`Removed ${worktreesRemoved} worktree(s) for issue #${issueNumber}`, 'success');

  // Remote branch deletion — top-level state is canonical (#524/#530); orchestrator is fallback.
  let branchDeleted = false;
  if (adwId && state) {
    let branchName = state.branchName;
    if (!branchName) {
      const orchestratorPath = d.findOrchestratorStatePath(adwId);
      if (orchestratorPath) {
        branchName = d.readOrchestratorState(orchestratorPath)?.branchName;
      }
    }
    if (branchName) {
      branchDeleted = d.deleteRemoteBranch(branchName, cwd);
    }
  }

  // Dependency handling
  if (repoInfo) {
    // 'abandoned' = transient failure, 'discarded' = deliberate terminal. Both propagate "don't pick up blocked work" to dependents; only 'completed' unblocks them.
    if (workflowStage === 'abandoned' || workflowStage === 'discarded') {
      await d.closeAbandonedDependents(issueNumber, repoInfo);
    } else {
      await d.handleIssueClosedDependencyUnblock(issueNumber, repoInfo, targetRepoArgs, gitContext);
    }
  }

  return { status: 'cleaned', worktreesRemoved, branchDeleted };
}

// ── PR-review spawn delegation ───────────────────────────────────────────────

/**
 * Resolves the PR-review identity for a given PR number.
 * Fetches PR details, runs the pure resolver, seeds state on the fresh path.
 * Returns { issueNumber, adwId } or null when the PR is not issue-linked (skip).
 */
export function resolvePrReviewSpawn(
  prNumber: number,
  repoInfo: RepoInfo,
): { issueNumber: number; adwId: string } | null {
  const prDetails = fetchPRDetails(prNumber, repoInfo);
  const target = resolvePrReviewTarget(
    { issueNumber: prDetails.issueNumber, title: prDetails.title },
    {
      fetchIssueComments: (n) => fetchIssueCommentsRest(n, repoInfo),
      generateAdwId,
    },
  );
  if (target.kind === 'skip') {
    log(`PR #${prNumber} is not issue-linked — skipping PR-review (no ADW review/auto-merge)`);
    return null;
  }
  if (target.kind === 'fresh') {
    AgentStateManager.writeTopLevelState(target.adwId, {
      adwId: target.adwId,
      issueNumber: target.issueNumber,
      branchName: prDetails.headBranch,
      orchestratorScript: 'adws/adwPrReview.tsx',
    });
  }
  return { issueNumber: target.issueNumber, adwId: target.adwId };
}
