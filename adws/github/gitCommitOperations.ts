/**
 * Git commit and push operations - committing changes, pushing branches, and cost file management.
 */

import { execSync } from 'child_process';
import { log, getIssueCsvPath, getProjectCsvPath } from '../core';
import { resolveTargetRepoCwd } from '../core/targetRepoRegistry';
import { getCurrentBranch, PROTECTED_BRANCHES } from './gitBranchOperations';

// Re-export PROTECTED_BRANCHES for consumers that import from this module
export { PROTECTED_BRANCHES };

/**
 * Stages all changes and commits with the given message.
 * @param message - The commit message
 * @param cwd - Optional working directory to run the command in
 * @returns True if changes were committed, false if no changes to commit.
 */
export function commitChanges(message: string, cwd?: string): boolean {
  try {
    const resolvedCwd = resolveTargetRepoCwd(cwd);
    const status = execSync('git status --porcelain', { encoding: 'utf-8', cwd: resolvedCwd });

    if (!status.trim()) {
      log('No changes to commit', 'info');
      return false;
    }

    execSync('git add -A', { stdio: 'pipe', cwd: resolvedCwd });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { stdio: 'pipe', cwd: resolvedCwd });
    log(`Committed: ${message}`, 'success');
    return true;
  } catch (error) {
    log(`Failed to commit: ${error}`, 'error');
    return false;
  }
}

/**
 * Pushes the current branch to origin with upstream tracking.
 * @param branchName - The branch name to push
 * @param cwd - Optional working directory to run the command in
 */
export function pushBranch(branchName: string, cwd?: string): void {
  const resolvedCwd = resolveTargetRepoCwd(cwd);
  execSync(`git push -u origin "${branchName}"`, { stdio: 'pipe', cwd: resolvedCwd });
  log(`Pushed branch to origin`, 'success');
}

/**
 * Pulls the latest changes from origin using rebase on the current branch.
 * Intended for callers that need to sync before computing cost data.
 * @param cwd - Optional working directory to run the command in
 */
export function pullLatestCostBranch(cwd?: string): void {
  const resolvedCwd = resolveTargetRepoCwd(cwd);
  const branch = getCurrentBranch(resolvedCwd);
  execSync(`git pull --rebase --autostash origin "${branch}"`, { stdio: 'pipe', cwd: resolvedCwd });
  log(`Pulled latest changes from origin/${branch}`, 'success');
}

export interface CommitCostFilesOptions {
  repoName?: string;
  issueNumber?: number;
  issueTitle?: string;
  paths?: string[];
  cwd?: string;
}

/**
 * Stages, commits, and pushes cost-related CSV files.
 * Supports three modes:
 * - Single issue: repoName + issueNumber + issueTitle — stages issue CSV and project total CSV
 * - Project-wide: repoName only — stages all CSVs in projects/<repoName>/
 * - All projects: no repoName — stages all CSVs under projects/
 *
 * Returns false if issueNumber is provided without repoName (invalid).
 * Returns true if changes were committed, false if no changes or on failure.
 */
export function commitAndPushCostFiles(options: CommitCostFilesOptions = {}): boolean {
  const { repoName, issueNumber, issueTitle, paths, cwd } = options;

  if (issueNumber !== undefined && !repoName) {
    log('Cannot commit issue cost files without a project name', 'error');
    return false;
  }

  try {
    const resolvedCwd = resolveTargetRepoCwd(cwd);
    let addPath: string;
    let statusPath: string;
    let commitMessage: string;

    if (paths && paths.length > 0) {
      // Explicit paths mode: stage only the specified files
      addPath = paths.map(p => `"${p}"`).join(' ');
      statusPath = addPath;
      commitMessage = `cost: update cost data for ${repoName ?? 'project'}`;
    } else if (repoName && issueNumber !== undefined && issueTitle) {
      // Single issue mode
      const issueCsvPath = getIssueCsvPath(repoName, issueNumber, issueTitle);
      const projectCsvPath = getProjectCsvPath(repoName);
      addPath = `"${issueCsvPath}" "${projectCsvPath}"`;
      statusPath = `"${issueCsvPath}" "${projectCsvPath}"`;
      commitMessage = `cost: add cost data for issue #${issueNumber}`;
    } else if (repoName) {
      // Project mode
      addPath = `"projects/${repoName}/*.csv"`;
      statusPath = `"projects/${repoName}/"`;
      commitMessage = `cost: add cost data for ${repoName}`;
    } else {
      // All projects mode
      addPath = 'projects/';
      statusPath = '"projects/"';
      commitMessage = 'cost: add cost data for all projects';
    }

    const status = execSync(
      `git status --porcelain -- ${statusPath}`,
      { encoding: 'utf-8', cwd: resolvedCwd },
    ).trim();

    if (!status) {
      log(`No cost CSV changes to commit`, 'info');
      return false;
    }

    execSync(`git add ${addPath}`, { stdio: 'pipe', cwd: resolvedCwd });
    execSync(
      `git commit -m "${commitMessage}"`,
      { stdio: 'pipe', cwd: resolvedCwd },
    );

    const branch = getCurrentBranch(resolvedCwd);
    execSync(`git pull --rebase --autostash origin "${branch}"`, { stdio: 'pipe', cwd: resolvedCwd });
    execSync(`git push origin "${branch}"`, { stdio: 'pipe', cwd: resolvedCwd });

    log(`Committed and pushed cost CSV files`, 'success');
    return true;
  } catch (error) {
    log(`Failed to commit cost CSV files: ${error}`, 'error');
    return false;
  }
}
