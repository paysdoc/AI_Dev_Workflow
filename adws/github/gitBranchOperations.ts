/**
 * Git branch operations - creation, checkout, deletion, and branch name generation.
 */

import { execSync } from 'child_process';
import { log, slugify, IssueClassSlashCommand, branchPrefixMap } from '../core';
import { resolveTargetRepoCwd } from '../core/targetRepoRegistry';

/**
 * Protected branches that must never be deleted.
 */
export const PROTECTED_BRANCHES = ['main', 'master', 'develop'];

/**
 * Gets the current git branch name.
 * @param cwd - Optional working directory to run the command in
 */
export function getCurrentBranch(cwd?: string): string {
  const resolvedCwd = resolveTargetRepoCwd(cwd);
  return execSync('git branch --show-current', { encoding: 'utf-8', cwd: resolvedCwd }).trim();
}

/**
 * Generates a branch name from issue number, title, and type.
 * Format: {prefix}/issue-{number}-{slugified-title}
 *
 * @param issueNumber - The GitHub issue number
 * @param title - The issue title (will be slugified)
 * @param issueType - The issue classification (defaults to '/feature')
 * @returns Branch name with appropriate prefix based on issue type
 */
export function generateBranchName(
  issueNumber: number,
  title: string,
  issueType: IssueClassSlashCommand = '/feature'
): string {
  const slug = slugify(title);
  const prefix = branchPrefixMap[issueType];
  return `${prefix}/issue-${issueNumber}-${slug}`;
}

/**
 * @deprecated Use generateBranchName instead. This function is kept for backwards compatibility.
 * Generates a feature branch name from issue number and title.
 * Format: feature/issue-{number}-{slugified-title}
 */
export function generateFeatureBranchName(issueNumber: number, title: string): string {
  return generateBranchName(issueNumber, title, '/feature');
}

/**
 * Creates and checks out a branch for the given issue.
 * The branch prefix is determined by the issue type (feature/, bugfix/, chore/).
 * If the branch already exists, checks it out instead.
 *
 * @param issueNumber - The GitHub issue number
 * @param title - The issue title (will be slugified for branch name)
 * @param issueType - The issue classification (defaults to '/feature')
 * @param cwd - Optional working directory to run the command in
 * @returns The branch name.
 */
export function createFeatureBranch(
  issueNumber: number,
  title: string,
  issueType: IssueClassSlashCommand = '/feature',
  cwd?: string
): string {
  const branchName = generateBranchName(issueNumber, title, issueType);

  try {
    const resolvedCwd = resolveTargetRepoCwd(cwd);
    const existingBranches = execSync('git branch -a', { encoding: 'utf-8', cwd: resolvedCwd });

    if (existingBranches.includes(branchName)) {
      log(`Branch ${branchName} already exists, checking out...`, 'info');
      execSync(`git checkout "${branchName}"`, { stdio: 'pipe', cwd: resolvedCwd });
    } else {
      execSync(`git checkout -b "${branchName}"`, { stdio: 'pipe', cwd: resolvedCwd });
      log(`Created branch: ${branchName}`, 'success');
    }

    return branchName;
  } catch (error) {
    throw new Error(`Failed to create branch: ${error}`);
  }
}

/**
 * Checks out an existing branch and pulls the latest changes.
 *
 * @param branchName - The branch to checkout
 * @param cwd - Optional working directory to run the command in
 */
export function checkoutBranch(branchName: string, cwd?: string): void {
  try {
    const resolvedCwd = resolveTargetRepoCwd(cwd);
    execSync(`git checkout "${branchName}"`, { stdio: 'pipe', cwd: resolvedCwd });
    execSync(`git pull origin "${branchName}"`, { stdio: 'pipe', cwd: resolvedCwd });
    log(`Checked out and pulled latest for branch: ${branchName}`, 'success');
  } catch (error) {
    throw new Error(`Failed to checkout branch ${branchName}: ${error}`);
  }
}

/**
 * Infers the issue type from a branch name by examining its prefix.
 * Maps branch prefixes to issue classification:
 *   - bugfix/ -> /bug
 *   - chore/ -> /chore
 *   - review/ -> /pr_review
 *   - feature/ (or unknown) -> /feature
 *
 * @param branchName - The branch name to parse (e.g., "bugfix/issue-123-fix-login")
 * @returns The inferred issue type classification
 */
export function inferIssueTypeFromBranch(branchName: string): IssueClassSlashCommand {
  if (branchName.startsWith('bugfix/')) {
    return '/bug';
  }
  if (branchName.startsWith('chore/')) {
    return '/chore';
  }
  if (branchName.startsWith('review/')) {
    return '/pr_review';
  }
  // Default to feature for feature/ prefix or unknown prefixes
  return '/feature';
}

/**
 * Gets the default branch name of the repository using the GitHub CLI.
 * @returns The name of the default branch (e.g., 'main', 'master', 'develop')
 */
export function getDefaultBranch(cwd?: string): string {
  try {
    const resolvedCwd = resolveTargetRepoCwd(cwd);
    const result = execSync(
      "gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'",
      { encoding: 'utf-8', cwd: resolvedCwd }
    );
    const branchName = result.trim();

    if (!branchName) {
      throw new Error('GitHub CLI returned empty default branch name');
    }

    return branchName;
  } catch (error) {
    throw new Error(`Failed to get default branch: ${error}`);
  }
}

/**
 * Checks out the repository's default branch and pulls the latest changes.
 * This ensures the working directory is on the latest version of the default branch
 * before creating feature branches.
 *
 * @param cwd - Optional working directory to run the command in
 * @returns The name of the default branch that was checked out.
 */
export function checkoutDefaultBranch(cwd?: string): string {
  const resolvedCwd = resolveTargetRepoCwd(cwd);
  log('Checking out default branch...', 'info');

  const defaultBranch = getDefaultBranch(resolvedCwd);
  log(`Default branch is: ${defaultBranch}`, 'info');

  try {
    execSync(`git checkout "${defaultBranch}"`, { stdio: 'pipe', cwd: resolvedCwd });
    log(`Checked out branch: ${defaultBranch}`, 'success');
  } catch (error) {
    throw new Error(`Failed to checkout default branch '${defaultBranch}': ${error}`);
  }

  try {
    execSync(`git pull origin "${defaultBranch}"`, { stdio: 'pipe', cwd: resolvedCwd });
    log(`Pulled latest changes from origin/${defaultBranch}`, 'success');
  } catch (error) {
    throw new Error(`Failed to pull latest changes for '${defaultBranch}': ${error}`);
  }

  return defaultBranch;
}

/**
 * Merges the latest changes from origin/{defaultBranch} into the current branch.
 * Fetches the specific branch from origin first, then merges.
 * Logs warnings on failure instead of throwing, since a merge conflict
 * should not prevent the workflow from attempting to continue.
 *
 * @param defaultBranch - The default branch name to merge from (e.g., 'main')
 * @param cwd - The working directory to run the commands in
 */
export function mergeLatestFromDefaultBranch(defaultBranch: string, cwd: string): void {
  log(`Fetching origin/${defaultBranch} in ${cwd}...`, 'info');
  try {
    execSync(`git fetch origin "${defaultBranch}"`, { stdio: 'pipe', cwd });
  } catch (error) {
    log(`Warning: Failed to fetch origin/${defaultBranch}: ${error}`, 'info');
    return;
  }

  log(`Merging origin/${defaultBranch} into current branch...`, 'info');
  try {
    execSync(`git merge "origin/${defaultBranch}" --no-edit`, { stdio: 'pipe', cwd });
    log(`Merged latest changes from origin/${defaultBranch}`, 'success');
  } catch (error) {
    log(`Warning: Failed to merge origin/${defaultBranch}: ${error}`, 'info');
  }
}

/**
 * Deletes a local git branch using force deletion.
 * Refuses to delete protected branches (main, master, develop).
 *
 * @param branchName - The branch to delete
 * @param cwd - Optional working directory to run the command in
 * @returns True if successfully deleted, false otherwise
 */
export function deleteLocalBranch(branchName: string, cwd?: string): boolean {
  if (PROTECTED_BRANCHES.includes(branchName)) {
    log(`Refusing to delete protected branch '${branchName}'`, 'info');
    return false;
  }

  const resolvedCwd = resolveTargetRepoCwd(cwd);
  try {
    execSync(`git branch -D "${branchName}"`, { stdio: 'pipe', cwd: resolvedCwd });
    log(`Deleted local branch '${branchName}'`, 'success');
    return true;
  } catch (error) {
    log(`Failed to delete local branch '${branchName}': ${error}`, 'info');
    return false;
  }
}

/**
 * Deletes a remote git branch on origin.
 * Refuses to delete protected branches (main, master, develop).
 *
 * @param branchName - The branch to delete from origin
 * @param cwd - Optional working directory to run the command in
 * @returns True if successfully deleted, false otherwise
 */
export function deleteRemoteBranch(branchName: string, cwd?: string): boolean {
  if (PROTECTED_BRANCHES.includes(branchName)) {
    log(`Refusing to delete protected remote branch '${branchName}'`, 'info');
    return false;
  }

  const resolvedCwd = resolveTargetRepoCwd(cwd);
  try {
    execSync(`git push origin --delete "${branchName}"`, { stdio: 'pipe', cwd: resolvedCwd });
    log(`Deleted remote branch '${branchName}'`, 'success');
    return true;
  } catch (error) {
    log(`Failed to delete remote branch '${branchName}': ${error}`, 'info');
    return false;
  }
}

