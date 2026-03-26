/**
 * Target repository workspace management.
 *
 * Handles cloning, pulling, and workspace path resolution for external
 * target repositories. Keeps cloned repos under TARGET_REPOS_DIR
 * (default: ~/.adw/repos/{owner}/{repo}/).
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TARGET_REPOS_DIR } from './config';
import type { TargetRepoInfo } from '../types/issueTypes';
import { log } from './utils';

/**
 * Returns the workspace path for a target repository.
 * Format: TARGET_REPOS_DIR/{owner}/{repo}
 */
export function getTargetRepoWorkspacePath(owner: string, repo: string): string {
  return path.join(TARGET_REPOS_DIR, owner, repo);
}

/**
 * Checks if a repository has already been cloned at the given workspace path.
 */
export function isRepoCloned(workspacePath: string): boolean {
  return fs.existsSync(path.join(workspacePath, '.git'));
}

/**
 * Converts an HTTPS GitHub clone URL to SSH format.
 * Handles URLs like https://github.com/{owner}/{repo} (with or without .git suffix).
 * Non-HTTPS URLs (e.g., already SSH) are returned unchanged.
 *
 * @param cloneUrl - The clone URL to convert
 * @returns The SSH-format URL, or the original URL if no conversion is needed
 */
export function convertToSshUrl(cloneUrl: string): string {
  const httpsMatch = cloneUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/);
  if (httpsMatch) {
    const sshUrl = `git@github.com:${httpsMatch[1]}/${httpsMatch[2]}.git`;
    log(`Converting HTTPS clone URL to SSH: ${cloneUrl} → ${sshUrl}`, 'info');
    return sshUrl;
  }
  return cloneUrl;
}

/**
 * Clones a target repository into the given workspace path.
 */
export function cloneTargetRepo(cloneUrl: string, workspacePath: string): void {
  const parentDir = path.dirname(workspacePath);
  fs.mkdirSync(parentDir, { recursive: true });

  const sshUrl = convertToSshUrl(cloneUrl);
  log(`Cloning ${sshUrl} into ${workspacePath}...`, 'info');
  execSync(`git clone "${sshUrl}" "${workspacePath}"`, {
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  log(`Cloned ${sshUrl} into ${workspacePath}`, 'success');
}

/**
 * Fetches latest changes and checks out the default branch.
 * Returns the name of the default branch.
 */
export function pullLatestDefaultBranch(workspacePath: string): string {
  log(`Fetching latest changes in ${workspacePath}...`, 'info');
  execSync('git fetch origin', { stdio: 'pipe', cwd: workspacePath });

  const defaultBranch = execSync(
    'gh repo view --json defaultBranchRef --jq .defaultBranchRef.name',
    { encoding: 'utf-8', cwd: workspacePath }
  ).trim();

  execSync(`git checkout "${defaultBranch}"`, { stdio: 'pipe', cwd: workspacePath });
  execSync(`git pull origin "${defaultBranch}"`, { stdio: 'pipe', cwd: workspacePath });
  log(`Checked out and pulled ${defaultBranch} in ${workspacePath}`, 'success');

  return defaultBranch;
}

/**
 * Ensures a target repository workspace exists and is up-to-date.
 * Clones the repo if not present, or pulls the latest default branch if already cloned.
 * Returns the absolute workspace path.
 */
export function ensureTargetRepoWorkspace(targetRepo: TargetRepoInfo): string {
  const workspacePath = targetRepo.workspacePath
    || getTargetRepoWorkspacePath(targetRepo.owner, targetRepo.repo);

  if (isRepoCloned(workspacePath)) {
    log(`Target repo ${targetRepo.owner}/${targetRepo.repo} already cloned at ${workspacePath}`, 'info');
    pullLatestDefaultBranch(workspacePath);
  } else {
    cloneTargetRepo(targetRepo.cloneUrl, workspacePath);
  }

  return workspacePath;
}
