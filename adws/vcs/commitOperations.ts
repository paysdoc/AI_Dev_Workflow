/**
 * Git commit and push operations - committing changes, pushing branches, and KPI file management.
 */

import { execSync } from 'child_process';
import { log } from '../core';
import { getCurrentBranch, PROTECTED_BRANCHES } from './branchOperations';

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
    const status = execSync('git status --porcelain', { encoding: 'utf-8', cwd });

    if (!status.trim()) {
      log('No changes to commit', 'info');
      return false;
    }

    execSync('git add -A', { stdio: 'pipe', cwd });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { stdio: 'pipe', cwd });
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
  execSync(`git push -u origin "${branchName}"`, { stdio: 'pipe', cwd });
  log(`Pushed branch to origin`, 'success');
}

/**
 * Stages, commits, and pushes the agentic KPI file.
 * Returns true if changes were committed, false if no changes or on failure.
 */
export function commitAndPushKpiFile(cwd?: string): boolean {
  try {
    const status = execSync(
      'git status --porcelain -- "app_docs/agentic_kpis.md"',
      { encoding: 'utf-8', cwd },
    ).trim();

    if (!status) {
      log(`No KPI file changes to commit`, 'info');
      return false;
    }

    execSync('git add "app_docs/agentic_kpis.md"', { stdio: 'pipe', cwd });
    execSync('git commit -m "kpis: update agentic_kpis"', { stdio: 'pipe', cwd });

    const branch = getCurrentBranch(cwd);

    if (!branch) {
      throw new Error('Cannot push KPI file: no current branch detected (detached HEAD)');
    }

    execSync(`git fetch origin "${branch}"`, { stdio: 'pipe', cwd });
    execSync(`git rebase --autostash "origin/${branch}"`, { stdio: 'pipe', cwd });
    execSync(`git push origin "${branch}"`, { stdio: 'pipe', cwd });

    log(`Committed and pushed agentic_kpis.md`, 'success');
    return true;
  } catch (error) {
    log(`Failed to commit KPI file: ${error}`, 'error');
    return false;
  }
}
