/**
 * Auto-merge handler for approved PR reviews.
 *
 * When a pull_request_review event arrives with state "approved", this module:
 * 1. Checks for merge conflicts between the PR branch and its base branch.
 * 2. If conflicts exist, resolves them via the /resolve_conflict agent.
 * 3. Pushes the resolved branch and attempts a merge via gh pr merge.
 * 4. Retries up to MAX_AUTO_MERGE_ATTEMPTS times to handle race conditions.
 * 5. Posts a PR comment if all attempts are exhausted.
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import * as path from 'path';
import { existsSync } from 'fs';
import { log, generateAdwId, ensureLogsDirectory, MAX_AUTO_MERGE_ATTEMPTS, getTargetRepoWorkspacePath } from '../core';
import { fetchPRDetails, commentOnPR, mergePR, getRepoInfoFromPayload, type RepoInfo } from '../github';
import { ensureWorktree } from '../vcs';
import { runClaudeAgentWithCommand } from '../agents';
import { getPlanFilePath, planFileExists } from '../agents';

const maxAttempts = MAX_AUTO_MERGE_ATTEMPTS;

/**
 * Performs a dry-run merge to detect conflicts without modifying the working tree.
 * Returns true if conflicts are detected, false if the merge would succeed cleanly.
 */
function checkMergeConflicts(baseBranch: string, cwd: string): boolean {
  try {
    execSync(`git fetch origin "${baseBranch}"`, { stdio: 'pipe', cwd });
  } catch (error) {
    log(`Failed to fetch origin/${baseBranch}: ${error}`, 'warn');
    return false;
  }

  try {
    execSync(`git merge --no-commit --no-ff "origin/${baseBranch}"`, { stdio: 'pipe', cwd });
    // Merge succeeded cleanly — abort to restore state and report no conflicts
    try { execSync('git merge --abort', { stdio: 'pipe', cwd }); } catch { /* already clean */ }
    return false;
  } catch {
    // Merge failed — conflicts detected; abort to clean up
    try { execSync('git merge --abort', { stdio: 'pipe', cwd }); } catch { /* ignore */ }
    return true;
  }
}

/**
 * Initiates a real merge (with conflict markers) then invokes the /resolve_conflict agent.
 * Returns true if the agent resolved conflicts and committed successfully.
 */
async function resolveConflictsViaAgent(
  adwId: string,
  specPath: string,
  baseBranch: string,
  logsDir: string,
  cwd: string
): Promise<boolean> {
  // Start the actual merge so conflict markers appear in working tree
  try {
    execSync(`git fetch origin "${baseBranch}"`, { stdio: 'pipe', cwd });
    execSync(`git merge "origin/${baseBranch}" --no-edit`, { stdio: 'pipe', cwd });
    // If no conflict, the merge succeeded without needing agent resolution
    log(`Merge from origin/${baseBranch} succeeded cleanly — no agent resolution needed`, 'info');
    return true;
  } catch {
    // Expected when conflicts exist — agent will resolve them
  }

  const outputFile = path.join(logsDir, `resolve-conflict-${Date.now()}.jsonl`);
  log(`Invoking /resolve_conflict agent for adwId=${adwId}, baseBranch=${baseBranch}`, 'info');

  const result = await runClaudeAgentWithCommand(
    '/resolve_conflict',
    [adwId, specPath, baseBranch],
    'conflict-resolver',
    outputFile,
    'sonnet',
    undefined,
    undefined,
    undefined,
    cwd
  );

  if (result.success) {
    log(`Conflict resolution agent succeeded`, 'success');
  } else {
    log(`Conflict resolution agent failed: ${result.output.substring(0, 200)}`, 'error');
  }

  return result.success;
}

/**
 * Pushes the current branch to origin.
 * Returns true on success, false on failure.
 */
function pushBranchChanges(branchName: string, cwd: string): boolean {
  try {
    execSync(`git push origin "${branchName}"`, { stdio: 'pipe', cwd });
    log(`Pushed branch '${branchName}' to origin`, 'success');
    return true;
  } catch (error) {
    log(`Failed to push branch '${branchName}': ${error}`, 'error');
    return false;
  }
}

/**
 * Returns true when the merge error indicates a conflict (race condition).
 * Checks for known GitHub CLI / git conflict-related error strings.
 */
function isMergeConflictError(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes('conflict') ||
    lower.includes('not mergeable') ||
    lower.includes('merge conflict') ||
    lower.includes('dirty') ||
    lower.includes('behind')
  );
}

/**
 * Core retry loop: resolve conflicts → push → merge.
 * Extracted so it can be reused by both the webhook auto-merge handler and the
 * in-process autoMergePhase.
 *
 * @returns `{ success: true }` on successful merge, or `{ success: false, error }` after
 *          exhausting retries or encountering a non-conflict failure.
 */
export async function mergeWithConflictResolution(
  prNumber: number,
  repoInfo: RepoInfo,
  headBranch: string,
  baseBranch: string,
  worktreePath: string,
  adwId: string,
  logsDir: string,
  specPath: string,
): Promise<{ success: boolean; error?: string }> {
  let lastMergeError = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(`Auto-merge attempt ${attempt}/${maxAttempts} for PR #${prNumber}`, 'info');

    const hasConflicts = checkMergeConflicts(baseBranch, worktreePath);

    if (hasConflicts) {
      log(`Merge conflicts detected on attempt ${attempt}, invoking /resolve_conflict`, 'info');
      const resolved = await resolveConflictsViaAgent(adwId, specPath, baseBranch, logsDir, worktreePath);
      if (!resolved) {
        log(`Conflict resolution failed on attempt ${attempt}, retrying`, 'warn');
        continue;
      }
    }

    const pushed = pushBranchChanges(headBranch, worktreePath);
    if (!pushed) {
      log(`Push failed on attempt ${attempt}, retrying`, 'warn');
      continue;
    }

    const mergeResult = mergePR(prNumber, repoInfo);
    if (mergeResult.success) {
      log(`PR #${prNumber} merged successfully on attempt ${attempt}`, 'success');
      return { success: true };
    }

    lastMergeError = mergeResult.error || '';
    log(`Merge failed on attempt ${attempt}: ${lastMergeError}`, 'warn');

    if (!isMergeConflictError(lastMergeError)) {
      log(`Non-conflict merge failure — stopping retries for PR #${prNumber}`, 'error');
      break;
    }
  }

  return { success: false, error: lastMergeError };
}

/**
 * Main handler invoked when a pull_request_review webhook arrives with state "approved".
 * Runs asynchronously (fire-and-forget) from the webhook response.
 */
export async function handleApprovedReview(body: Record<string, unknown>): Promise<void> {
  const pullRequest = body.pull_request as Record<string, unknown> | undefined;
  const prNumber = pullRequest?.number as number | undefined;
  if (prNumber == null) {
    log('handleApprovedReview: missing pull_request.number in webhook body', 'error');
    return;
  }

  const repository = body.repository as Record<string, unknown> | undefined;
  const repoFullName = repository?.full_name as string | undefined;
  if (!repoFullName) {
    log('handleApprovedReview: missing repository.full_name in webhook body', 'error');
    return;
  }

  let repoInfo: RepoInfo;
  try {
    repoInfo = getRepoInfoFromPayload(repoFullName);
  } catch (error) {
    log(`handleApprovedReview: invalid repo full name "${repoFullName}": ${error}`, 'error');
    return;
  }

  log(`Auto-merge triggered for PR #${prNumber} in ${repoFullName}`, 'info');

  let prDetails;
  try {
    prDetails = fetchPRDetails(prNumber, repoInfo);
  } catch (error) {
    log(`handleApprovedReview: failed to fetch PR #${prNumber}: ${error}`, 'error');
    return;
  }

  const { headBranch, baseBranch } = prDetails;
  const adwId = generateAdwId(`auto-merge-pr-${prNumber}`);
  const logsDir = ensureLogsDirectory(adwId);

  if (!prDetails.url) {
    log('handleApprovedReview: no PR URL available, skipping auto-merge', 'warn');
    writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'missing PR URL, skipping auto-merge');
    return;
  }

  if (!repoInfo.owner || !repoInfo.repo) {
    log('handleApprovedReview: no repo context available, skipping auto-merge', 'warn');
    writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'missing repo context, skipping auto-merge');
    return;
  }

  if (prDetails.state === 'CLOSED' || prDetails.state === 'MERGED') {
    log(`PR #${prNumber} is already ${prDetails.state}, skipping auto-merge`, 'info');
    writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'PR already merged, skipping auto-merge');
    return;
  }

  log(`Auto-merge: head=${headBranch}, base=${baseBranch}, adwId=${adwId}`, 'info');

  // Derive target repo workspace path from webhook payload
  const targetRepoWorkspacePath = (() => {
    const workspacePath = getTargetRepoWorkspacePath(repoInfo.owner, repoInfo.repo);
    return existsSync(workspacePath) ? workspacePath : undefined;
  })();

  // Ensure worktree exists for the PR branch
  let worktreePath: string;
  try {
    worktreePath = ensureWorktree(headBranch, undefined, targetRepoWorkspacePath);
  } catch (error) {
    log(`handleApprovedReview: failed to ensure worktree for '${headBranch}': ${error}`, 'error');
    writeFileSync(path.join(logsDir, 'skip_reason.txt'), `Worktree creation failed for branch: ${headBranch}`);
    return;
  }

  // Resolve spec path for the /resolve_conflict agent
  const issueNumber = prDetails.issueNumber;
  let specPath = '';
  if (issueNumber) {
    const candidate = getPlanFilePath(issueNumber, worktreePath);
    if (planFileExists(issueNumber, worktreePath)) {
      specPath = candidate;
      log(`Using spec file: ${specPath}`, 'info');
    }
  }

  // Retry loop: resolve conflicts → push → merge
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

  if (mergeOutcome.success) {
    return;
  }

  // All attempts exhausted or non-recoverable error — post failure comment
  const lastMergeError = mergeOutcome.error || '';
  const failureComment = [
    `## Auto-merge failed for PR #${prNumber}`,
    '',
    'The automated merge process was unable to merge this PR after multiple attempts.',
    '',
    lastMergeError ? `**Last error:** ${lastMergeError.substring(0, 500)}` : '',
    '',
    'Please resolve any remaining merge conflicts manually and merge the PR.',
  ].filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');

  commentOnPR(prNumber, failureComment, repoInfo);
  log(`Posted auto-merge failure comment on PR #${prNumber}`, 'info');
}
