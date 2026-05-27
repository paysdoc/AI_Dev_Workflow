#!/usr/bin/env bunx tsx
/**
 * ADW Merge Orchestrator - Thin merge orchestrator for `awaiting_merge` handoff.
 *
 * Usage: bunx tsx adws/adwMerge.tsx <issueNumber> <adw-id> [--target-repo owner/repo] [--clone-url <url>]
 *
 * Workflow:
 * 1. Read top-level state file for the given adw-id
 * 2. Find the orchestrator state to get the branch name
 * 3. Look up the PR by branch via GitHub CLI
 * 4. If already merged: write `completed` to state, post comment, exit 0
 * 5. If closed (not merged): write `abandoned` to state, exit 0
 * 6. If open: resolve merge conflicts if any, then merge the PR
 * 7. On success: write `completed` to state, post completion comment
 * 8. On failure: post failure comment on PR, write `abandoned` to state
 *
 * Does NOT use initializeWorkflow() — reads state directly, no worktree setup at startup.
 */

import { runWithRawOrchestratorLifecycle } from './phases/orchestratorLock';
import {
  parseTargetRepoArgs,
  parseOrchestratorArguments,
  buildRepoIdentifier,
  AgentStateManager,
  log,
  ensureLogsDirectory,
  ensureTargetRepoWorkspace,
} from './core';

// Maximum PR-resolution attempts before escalating to merge_blocked (#527)
const MAX_PR_RESOLUTION_ATTEMPTS = 3;
import { findOrchestratorStatePath } from './core/stateHelpers';
import { commentOnIssue, commentOnPR, defaultFindPRByBranch, fetchPRApprovalState, issueHasLabel, type RawPR, type RepoInfo } from './github';
import { mergeWithConflictResolution } from './triggers/autoMergeHandler';
import { ensureWorktree } from './vcs';
import { getPlanFilePath, planFileExists } from './agents';
import type { AgentState } from './types/agentTypes';
export { handleWorkflowDiscarded } from './phases/workflowCompletion';

/** Outcome of executeMerge. */
export interface MergeRunResult {
  readonly outcome: 'completed' | 'abandoned';
  readonly reason: string;
}

/** Injectable dependencies for executeMerge — enables unit testing. */
export interface MergeDeps {
  readonly readTopLevelState: (adwId: string) => AgentState | null;
  readonly findOrchestratorStatePath: (adwId: string) => string | null;
  readonly readOrchestratorState: (statePath: string) => AgentState | null;
  readonly findPRByBranch: (branchName: string, repoInfo: RepoInfo) => RawPR | null;
  readonly issueHasLabel: (issueNumber: number, labelName: string, repoInfo: RepoInfo) => boolean;
  readonly fetchPRApprovalState: (prNumber: number, repoInfo: RepoInfo) => boolean;
  readonly ensureWorktree: (branchName: string, baseBranch: string, baseRepo: string) => string;
  readonly ensureLogsDirectory: (adwId: string) => string;
  readonly mergeWithConflictResolution: typeof mergeWithConflictResolution;
  readonly writeTopLevelState: (adwId: string, state: Partial<AgentState>) => void;
  readonly commentOnIssue: typeof commentOnIssue;
  readonly commentOnPR: typeof commentOnPR;
  readonly getPlanFilePath: typeof getPlanFilePath;
  readonly planFileExists: typeof planFileExists;
}

/** Builds the explanatory issue comment posted when the merge escalates to merge_blocked. */
function buildMergeBlockedComment(cause: string, adwId: string): string {
  return [
    '## ADW Merge Blocked',
    '',
    `**Cause:** ${cause}`,
    '',
    '**Remedy:** Resolve the issue above, then comment `## Retry` on this issue. ADW will reset to `awaiting_merge` and re-attempt the merge on the next cron tick.',
    '',
    `**ADW ID:** \`${adwId}\``,
  ].join('\n');
}

/**
 * Core merge orchestrator logic — exported for unit testing.
 * All side effects are injected via `deps`.
 */
export async function executeMerge(
  issueNumber: number,
  adwId: string,
  repoInfo: RepoInfo,
  baseRepoPath: string,
  deps: MergeDeps,
): Promise<MergeRunResult> {
  // 1. Read and validate top-level state
  const topLevelState = deps.readTopLevelState(adwId);
  if (!topLevelState) {
    log(`adwMerge: no top-level state found for adwId=${adwId}`, 'error');
    return { outcome: 'abandoned', reason: 'no_state_file' };
  }
  if (topLevelState.workflowStage !== 'awaiting_merge') {
    log(`adwMerge: unexpected workflowStage '${topLevelState.workflowStage}' for adwId=${adwId}`, 'warn');
    deps.writeTopLevelState(adwId, { workflowStage: 'abandoned' });
    return { outcome: 'abandoned', reason: `unexpected_stage:${topLevelState.workflowStage}` };
  }

  // 2. Resolve branch name — top-level state is the canonical persistence target (#524/#530);
  //    orchestrator state is the fallback for older runs / defense-in-depth.
  let branchName = topLevelState.branchName;
  if (!branchName) {
    const orchestratorStatePath = deps.findOrchestratorStatePath(adwId);
    if (!orchestratorStatePath) {
      log(`adwMerge: no orchestrator state found for adwId=${adwId}`, 'error');
      deps.writeTopLevelState(adwId, { workflowStage: 'abandoned' });
      return { outcome: 'abandoned', reason: 'no_orchestrator_state' };
    }
    branchName = deps.readOrchestratorState(orchestratorStatePath)?.branchName;
  }
  if (!branchName) {
    log(`adwMerge: no branchName in state for adwId=${adwId}`, 'error');
    deps.writeTopLevelState(adwId, { workflowStage: 'abandoned' });
    return { outcome: 'abandoned', reason: 'no_branch_name' };
  }

  // 3. Find the PR by branch name (bounded retry — #527)
  const pr = deps.findPRByBranch(branchName, repoInfo);
  if (!pr) {
    const attemptCount = (topLevelState.mergeRetryCount ?? 0) + 1;
    if (attemptCount >= MAX_PR_RESOLUTION_ATTEMPTS) {
      log(`adwMerge: no PR for '${branchName}' after ${attemptCount} attempts — escalating to merge_blocked`, 'error');
      deps.writeTopLevelState(adwId, { workflowStage: 'merge_blocked', mergeRetryCount: attemptCount });
      deps.commentOnIssue(
        issueNumber,
        buildMergeBlockedComment(
          `No open pull request was found for branch \`${branchName}\` after ${attemptCount} attempts. The PR may have been closed/merged out-of-band, or the stored branch name may be stale.`,
          adwId,
        ),
        repoInfo,
      );
      return { outcome: 'abandoned', reason: 'no_pr_found_blocked' };
    }
    log(`adwMerge: no PR for '${branchName}' (attempt ${attemptCount}/${MAX_PR_RESOLUTION_ATTEMPTS}) — staying awaiting_merge`, 'warn');
    deps.writeTopLevelState(adwId, { workflowStage: 'awaiting_merge', mergeRetryCount: attemptCount });
    return { outcome: 'abandoned', reason: 'no_pr_found' };
  }

  const { number: prNumber, state: prState, baseRefName: baseBranch } = pr;
  log(`adwMerge: PR #${prNumber} state=${prState} branch=${branchName} base=${baseBranch}`, 'info');

  // 4. Already merged — idempotent completion
  if (prState === 'MERGED') {
    log(`adwMerge: PR #${prNumber} already merged, writing completed`, 'success');
    deps.writeTopLevelState(adwId, { workflowStage: 'completed', mergeRetryCount: 0 });
    deps.commentOnIssue(
      issueNumber,
      `## ADW Workflow Completed\n\nPR #${prNumber} has been merged.\n\n**ADW ID:** \`${adwId}\``,
      repoInfo,
    );
    return { outcome: 'completed', reason: 'already_merged' };
  }

  // 5. Closed without merge — discard (terminal, operator intent)
  if (prState === 'CLOSED') {
    log(`adwMerge: PR #${prNumber} is closed without merge`, 'warn');
    deps.writeTopLevelState(adwId, { workflowStage: 'discarded' });
    return { outcome: 'abandoned', reason: 'pr_closed' };
  }

  // 5b. Unified gate — defer when hitl is on the issue AND the PR is not approved.
  //     Stateless: every cron tick re-evaluates the current label state and PR approval.
  //     No state write, no comment, log only — avoids flooding the issue while waiting.
  const hitlOnIssue = deps.issueHasLabel(issueNumber, 'hitl', repoInfo);
  const isApproved = deps.fetchPRApprovalState(prNumber, repoInfo);
  if (hitlOnIssue && !isApproved) {
    log(`Issue #${issueNumber} has hitl label and PR #${prNumber} is not approved — deferring`, 'info');
    return { outcome: 'abandoned', reason: 'hitl_blocked_unapproved' };
  }

  // 6. PR is open — ensure worktree and merge
  let worktreePath: string;
  try {
    worktreePath = deps.ensureWorktree(branchName, baseBranch, baseRepoPath);
  } catch (error) {
    log(`adwMerge: failed to ensure worktree for '${branchName}': ${error}`, 'error');
    deps.writeTopLevelState(adwId, { workflowStage: 'abandoned' });
    return { outcome: 'abandoned', reason: 'worktree_error' };
  }

  const logsDir = deps.ensureLogsDirectory(adwId);
  const specPath = deps.planFileExists(issueNumber, worktreePath)
    ? deps.getPlanFilePath(issueNumber, worktreePath)
    : '';

  const mergeOutcome = await deps.mergeWithConflictResolution(
    prNumber,
    repoInfo,
    branchName,
    baseBranch,
    worktreePath,
    adwId,
    logsDir,
    specPath,
  );

  if (mergeOutcome.success) {
    log(`adwMerge: PR #${prNumber} merged successfully`, 'success');
    deps.writeTopLevelState(adwId, { workflowStage: 'completed', mergeRetryCount: 0 });
    deps.commentOnIssue(
      issueNumber,
      `## ADW Workflow Completed\n\nPR #${prNumber} has been merged successfully.\n\n**ADW ID:** \`${adwId}\``,
      repoInfo,
    );
    return { outcome: 'completed', reason: 'merged' };
  }

  // Merge failed after retries.
  // Conscious reversal of #460: merge_failed now escalates to the human-recoverable
  // merge_blocked instead of terminal discarded (#460). Anti-loop intent preserved:
  // merge_blocked recovers only via explicit ## Retry, never automatically.
  // pr_closed remains discarded.
  const lastError = mergeOutcome.error ?? '';
  log(`adwMerge: merge failed after retries: ${lastError}`, 'error');
  deps.writeTopLevelState(adwId, { workflowStage: 'merge_blocked' });

  const causeLines = [`Automated merge of PR #${prNumber} failed after multiple conflict-resolution attempts.`];
  if (lastError) causeLines.push(`Last error: ${lastError.substring(0, 500)}`);
  deps.commentOnIssue(
    issueNumber,
    buildMergeBlockedComment(causeLines.join(' '), adwId),
    repoInfo,
  );
  return { outcome: 'abandoned', reason: 'merge_failed' };
}

/** Builds the default MergeDeps using production implementations. */
function buildDefaultDeps(): MergeDeps {
  return {
    readTopLevelState: (id) => AgentStateManager.readTopLevelState(id),
    findOrchestratorStatePath,
    readOrchestratorState: (statePath) => AgentStateManager.readState(statePath),
    findPRByBranch: defaultFindPRByBranch,
    issueHasLabel,
    fetchPRApprovalState,
    ensureWorktree,
    ensureLogsDirectory,
    mergeWithConflictResolution,
    writeTopLevelState: (id, state) => AgentStateManager.writeTopLevelState(id, state),
    commentOnIssue,
    commentOnPR,
    getPlanFilePath,
    planFileExists,
  };
}

/** Main entry point. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetRepo = parseTargetRepoArgs(args);
  const { issueNumber, adwId } = parseOrchestratorArguments(args, {
    scriptName: 'adwMerge.tsx',
    usagePattern: '<issueNumber> <adw-id> [--target-repo owner/repo] [--clone-url <url>]',
    supportsCwd: false,
    supportsIssueType: false,
  });

  if (!adwId) {
    console.error('adwMerge: adw-id is required as the second positional argument');
    process.exit(1);
  }

  const repoId = buildRepoIdentifier(targetRepo);
  const repoInfo: RepoInfo = { owner: repoId.owner, repo: repoId.repo };

  const baseRepoPath = targetRepo ? ensureTargetRepoWorkspace(targetRepo) : process.cwd();

  let result: Awaited<ReturnType<typeof executeMerge>> | undefined;
  const acquired = await runWithRawOrchestratorLifecycle(repoInfo, issueNumber, adwId, async () => {
    result = await executeMerge(issueNumber, adwId, repoInfo, baseRepoPath, buildDefaultDeps());
  });
  if (!acquired) {
    log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
    process.exit(0);
  }
  if (!result) {
    process.exit(1);
  }
  process.exit(result.outcome === 'abandoned' && result.reason === 'merge_failed' ? 1 : 0);
}

// Only run when executed directly — not when imported as a module (e.g. in tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
