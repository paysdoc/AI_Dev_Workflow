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

import {
  parseTargetRepoArgs,
  parseOrchestratorArguments,
  buildRepoIdentifier,
  AgentStateManager,
  log,
  ensureLogsDirectory,
  execWithRetry,
} from './core';
import { findOrchestratorStatePath } from './core/stateHelpers';
import { commentOnIssue, commentOnPR, type RepoInfo } from './github';
import { mergeWithConflictResolution } from './triggers/autoMergeHandler';
import { ensureWorktree } from './vcs';
import { getPlanFilePath, planFileExists } from './agents';
import type { AgentState } from './types/agentTypes';

/** Shape of a PR entry returned by `gh pr list --json ...` */
interface RawPR {
  readonly number: number;
  readonly state: string;
  readonly headRefName: string;
  readonly baseRefName: string;
}

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
  readonly ensureWorktree: (branchName: string, baseBranch?: string) => string;
  readonly ensureLogsDirectory: (adwId: string) => string;
  readonly mergeWithConflictResolution: typeof mergeWithConflictResolution;
  readonly writeTopLevelState: (adwId: string, state: Partial<AgentState>) => void;
  readonly commentOnIssue: typeof commentOnIssue;
  readonly commentOnPR: typeof commentOnPR;
  readonly getPlanFilePath: typeof getPlanFilePath;
  readonly planFileExists: typeof planFileExists;
}

/**
 * Looks up the PR for a branch via the GitHub CLI (open or recently closed/merged).
 * Returns the first result or null if none found or on error.
 */
export function defaultFindPRByBranch(branchName: string, repoInfo: RepoInfo): RawPR | null {
  const { owner, repo } = repoInfo;
  try {
    const json = execWithRetry(
      `gh pr list --repo ${owner}/${repo} --head "${branchName}" --state all --json number,state,headRefName,baseRefName --limit 5`,
    );
    const prs = JSON.parse(json) as RawPR[];
    return prs.length > 0 ? prs[0] : null;
  } catch {
    return null;
  }
}

/**
 * Core merge orchestrator logic — exported for unit testing.
 * All side effects are injected via `deps`.
 */
export async function executeMerge(
  issueNumber: number,
  adwId: string,
  repoInfo: RepoInfo,
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

  // 2. Find branch name from orchestrator-specific state
  const orchestratorStatePath = deps.findOrchestratorStatePath(adwId);
  if (!orchestratorStatePath) {
    log(`adwMerge: no orchestrator state found for adwId=${adwId}`, 'error');
    deps.writeTopLevelState(adwId, { workflowStage: 'abandoned' });
    return { outcome: 'abandoned', reason: 'no_orchestrator_state' };
  }

  const orchestratorState = deps.readOrchestratorState(orchestratorStatePath);
  const branchName = orchestratorState?.branchName;
  if (!branchName) {
    log(`adwMerge: no branchName in orchestrator state for adwId=${adwId}`, 'error');
    deps.writeTopLevelState(adwId, { workflowStage: 'abandoned' });
    return { outcome: 'abandoned', reason: 'no_branch_name' };
  }

  // 3. Find the PR by branch name
  const pr = deps.findPRByBranch(branchName, repoInfo);
  if (!pr) {
    log(`adwMerge: no PR found for branch '${branchName}' in ${repoInfo.owner}/${repoInfo.repo}`, 'error');
    deps.writeTopLevelState(adwId, { workflowStage: 'abandoned' });
    return { outcome: 'abandoned', reason: 'no_pr_found' };
  }

  const { number: prNumber, state: prState, baseRefName: baseBranch } = pr;
  log(`adwMerge: PR #${prNumber} state=${prState} branch=${branchName} base=${baseBranch}`, 'info');

  // 4. Already merged — idempotent completion
  if (prState === 'MERGED') {
    log(`adwMerge: PR #${prNumber} already merged, writing completed`, 'success');
    deps.writeTopLevelState(adwId, { workflowStage: 'completed' });
    deps.commentOnIssue(
      issueNumber,
      `## ADW Workflow Completed\n\nPR #${prNumber} has been merged.\n\n**ADW ID:** \`${adwId}\``,
      repoInfo,
    );
    return { outcome: 'completed', reason: 'already_merged' };
  }

  // 5. Closed without merge — abandon
  if (prState === 'CLOSED') {
    log(`adwMerge: PR #${prNumber} is closed without merge`, 'warn');
    deps.writeTopLevelState(adwId, { workflowStage: 'abandoned' });
    return { outcome: 'abandoned', reason: 'pr_closed' };
  }

  // 6. PR is open — ensure worktree and merge
  let worktreePath: string;
  try {
    worktreePath = deps.ensureWorktree(branchName, baseBranch);
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
    deps.writeTopLevelState(adwId, { workflowStage: 'completed' });
    deps.commentOnIssue(
      issueNumber,
      `## ADW Workflow Completed\n\nPR #${prNumber} has been merged successfully.\n\n**ADW ID:** \`${adwId}\``,
      repoInfo,
    );
    return { outcome: 'completed', reason: 'merged' };
  }

  // Merge failed after retries
  const lastError = mergeOutcome.error ?? '';
  log(`adwMerge: merge failed after retries: ${lastError}`, 'error');
  deps.writeTopLevelState(adwId, { workflowStage: 'abandoned' });

  const failureLines = [
    `## Auto-merge failed for PR #${prNumber}`,
    '',
    'The automated merge process was unable to merge this PR after multiple attempts.',
    '',
    lastError ? `**Last error:** ${lastError.substring(0, 500)}` : '',
    '',
    'Please resolve any remaining merge conflicts manually and merge the PR.',
  ];
  const failureComment = failureLines
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n');

  deps.commentOnPR(prNumber, failureComment, repoInfo);
  return { outcome: 'abandoned', reason: 'merge_failed' };
}

/** Builds the default MergeDeps using production implementations. */
function buildDefaultDeps(): MergeDeps {
  return {
    readTopLevelState: (id) => AgentStateManager.readTopLevelState(id),
    findOrchestratorStatePath,
    readOrchestratorState: (statePath) => AgentStateManager.readState(statePath),
    findPRByBranch: defaultFindPRByBranch,
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

  const result = await executeMerge(issueNumber, adwId, repoInfo, buildDefaultDeps());

  process.exit(result.outcome === 'abandoned' && result.reason === 'merge_failed' ? 1 : 0);
}

// Only run when executed directly — not when imported as a module (e.g. in tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
