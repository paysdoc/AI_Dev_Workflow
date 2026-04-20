/**
 * Git branch operations - creation, checkout, deletion, and branch name generation.
 */

import { execSync } from 'child_process';
import { log, IssueClassSlashCommand, branchPrefixMap, branchPrefixAliases } from '../core';

/**
 * Protected branches that must never be deleted.
 */
export const PROTECTED_BRANCHES = ['main', 'master', 'develop'];

/**
 * Gets the current git branch name.
 * @param cwd - Optional working directory to run the command in
 */
export function getCurrentBranch(cwd?: string): string {
  return execSync('git branch --show-current', { encoding: 'utf-8', cwd }).trim();
}

/**
 * Validates a slug for branch-name assembly.
 *
 * A valid slug is: non-empty, lowercase, [a-z0-9-] only, no leading/trailing
 * hyphens, no consecutive hyphens, ≤ 50 characters, no known branch prefix
 * (canonical or alias), no "issue-<N>" segment, no path separators, and no
 * forbidden git-ref characters.
 *
 * Throws with an operator-legible message on any violation.
 */
export function validateSlug(slug: string): string {
  if (!slug || slug.trim() === '') {
    throw new Error('Slug is empty');
  }

  if (slug.includes('/') || slug.includes('\\')) {
    throw new Error(`Slug contains forbidden path separator: "${slug}"`);
  }

  if (/[~^:*?[\]@{}\\`]/.test(slug) || slug.includes('..')) {
    throw new Error(`Slug contains forbidden git-ref characters: "${slug}"`);
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Slug contains forbidden characters (only a-z, 0-9, and hyphens allowed): "${slug}"`);
  }

  if (slug.startsWith('-') || slug.endsWith('-')) {
    throw new Error(`Slug must not start or end with a hyphen: "${slug}"`);
  }

  if (slug.includes('--')) {
    throw new Error(`Slug must not contain consecutive hyphens: "${slug}"`);
  }

  if (slug.length > 50) {
    throw new Error(`Slug exceeds 50 characters (length=${slug.length}): "${slug}"`);
  }

  const canonicalPrefixes = Object.values(branchPrefixMap);
  const aliasPrefixes = Object.values(branchPrefixAliases).flat() as string[];
  const forbiddenPrefixes = [...new Set([...canonicalPrefixes, ...aliasPrefixes])];

  for (const prefix of forbiddenPrefixes) {
    if (slug.startsWith(`${prefix}-`)) {
      throw new Error(`Slug already contains a forbidden prefix "${prefix}-": "${slug}"`);
    }
  }

  if (/issue-\d+/.test(slug)) {
    throw new Error(`Slug must not contain "issue-<number>" segment: "${slug}"`);
  }

  return slug;
}

/**
 * Assembles a canonical branch name from issue type, number, and slug.
 * Format: <prefix>-issue-<issueNumber>-<slug> (hyphen-separated).
 *
 * The slug is validated before assembly — any drift in LLM output is caught here
 * and throws rather than propagating a malformed branch name.
 *
 * @param issueNumber - The GitHub issue number
 * @param slug - A pre-validated slug (lowercase, hyphens only, no prefix, no issue number)
 * @param issueType - The issue classification (defaults to '/feature')
 * @returns Canonical branch name, e.g. "feature-issue-42-add-user-auth"
 */
export function generateBranchName(
  issueNumber: number,
  slug: string,
  issueType: IssueClassSlashCommand = '/feature'
): string {
  const validatedSlug = validateSlug(slug);
  const prefix = branchPrefixMap[issueType];
  return `${prefix}-issue-${issueNumber}-${validatedSlug}`;
}

/**
 * @deprecated Runs `git pull --rebase` which crashes on divergent branches.
 * Use `git fetch origin` + worktree-based workflows instead.
 * Checks out an existing branch and pulls the latest changes.
 *
 * @param branchName - The branch to checkout
 * @param cwd - Optional working directory to run the command in
 */
export function checkoutBranch(branchName: string, cwd?: string): void {
  log('WARNING: checkoutBranch is deprecated. Use `git fetch origin` + worktree-based workflows instead.', 'warn');
  try {
    execSync(`git checkout "${branchName}"`, { stdio: 'pipe', cwd });
    execSync(`git pull --rebase origin "${branchName}"`, { stdio: 'pipe', cwd });
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
  if (branchName.startsWith('bugfix/') || branchName.startsWith('bugfix-')) {
    return '/bug';
  }
  if (branchName.startsWith('chore/') || branchName.startsWith('chore-')) {
    return '/chore';
  }
  if (branchName.startsWith('review/') || branchName.startsWith('review-')) {
    return '/pr_review';
  }
  return '/feature';
}

/**
 * Gets the default branch name of the repository using the GitHub CLI.
 * @returns The name of the default branch (e.g., 'main', 'master', 'develop')
 */
export function getDefaultBranch(cwd?: string): string {
  try {
    const result = execSync(
      "gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'",
      { encoding: 'utf-8', cwd }
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
 * @deprecated Runs `git pull --rebase` which crashes on divergent branches.
 * Use `git fetch origin` + worktree-based workflows instead.
 * Checks out the repository's default branch and pulls the latest changes.
 * This ensures the working directory is on the latest version of the default branch
 * before creating feature branches.
 *
 * @param cwd - Optional working directory to run the command in
 * @returns The name of the default branch that was checked out.
 */
export function checkoutDefaultBranch(cwd?: string): string {
  log('WARNING: checkoutDefaultBranch is deprecated. Use `git fetch origin` + worktree-based workflows instead.', 'warn');
  log('Checking out default branch...', 'info');

  const defaultBranch = getDefaultBranch(cwd);
  log(`Default branch is: ${defaultBranch}`, 'info');

  try {
    execSync(`git checkout "${defaultBranch}"`, { stdio: 'pipe', cwd });
    log(`Checked out branch: ${defaultBranch}`, 'success');
  } catch (error) {
    throw new Error(`Failed to checkout default branch '${defaultBranch}': ${error}`);
  }

  try {
    execSync(`git pull --rebase origin "${defaultBranch}"`, { stdio: 'pipe', cwd });
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
 * Fetches the latest refs for the default branch from origin, then resets
 * the working tree (hard) to match the remote tip exactly.
 * Throws on failure since the reset is critical for correct worktree state.
 *
 * @param defaultBranch - The default branch name to sync from (e.g., 'main')
 * @param cwd - The working directory (worktree path) to run the commands in
 */
export function fetchAndResetToRemote(defaultBranch: string, cwd: string): void {
  log(`Fetching origin/${defaultBranch}...`, 'info');
  try {
    execSync(`git fetch origin "${defaultBranch}"`, { stdio: 'pipe', cwd });
  } catch (error) {
    throw new Error(`Failed to fetch origin/${defaultBranch}: ${error}`);
  }

  log(`Resetting to origin/${defaultBranch}...`, 'info');
  try {
    execSync(`git reset --hard "origin/${defaultBranch}"`, { stdio: 'pipe', cwd });
  } catch (error) {
    throw new Error(`Failed to reset to origin/${defaultBranch}: ${error}`);
  }

  log(`Synced worktree to origin/${defaultBranch}`, 'success');
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

  try {
    execSync(`git branch -D "${branchName}"`, { stdio: 'pipe', cwd });
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

  try {
    execSync(`git push origin --delete "${branchName}"`, { stdio: 'pipe', cwd });
    log(`Deleted remote branch '${branchName}'`, 'success');
    return true;
  } catch (error) {
    log(`Failed to delete remote branch '${branchName}': ${error}`, 'info');
    return false;
  }
}

