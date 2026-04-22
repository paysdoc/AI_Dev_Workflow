/**
 * Git commit and push operations - committing changes, pushing branches, and KPI file management.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from '../core';
import { getDefaultBranch, PROTECTED_BRANCHES } from './branchOperations';

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

function hasKpiFileChanges(cwd?: string): boolean {
  const output = execSync(
    'git status --porcelain -- "app_docs/agentic_kpis.md"',
    { encoding: 'utf-8', cwd },
  );
  return output.trim().length > 0;
}

function cleanupKpiTempWorktree(cwd: string | undefined, tmpdir: string): void {
  try {
    execSync(`git worktree remove --force "${tmpdir}"`, { stdio: 'pipe', cwd });
  } catch (error) {
    log(`Failed to remove temp worktree ${tmpdir}: ${error}`, 'error');
  }
  try {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  } catch (error) {
    log(`Failed to remove temp dir ${tmpdir}: ${error}`, 'error');
  }
}

/**
 * Commits `app_docs/agentic_kpis.md` to the repo's default branch via a
 * temporary detached worktree, leaving the active worktree's index and
 * HEAD untouched. Non-fatal: returns false and logs on any failure.
 *
 * @param cwd - Working directory for the source worktree (the ADW repo root)
 */
export function commitAndPushKpiFile(cwd?: string): boolean {
  try {
    if (!hasKpiFileChanges(cwd)) {
      log(`No KPI file changes to commit`, 'info');
      return false;
    }

    const defaultBranch = getDefaultBranch(cwd);
    execSync(`git fetch origin "${defaultBranch}"`, { stdio: 'pipe', cwd });

    const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-kpi-'));

    try {
      execSync(`git worktree add --detach "${tmpdir}" "origin/${defaultBranch}"`, { stdio: 'pipe', cwd });

      const srcRoot = cwd ?? process.cwd();
      const srcFile = path.join(srcRoot, 'app_docs/agentic_kpis.md');
      const dstFile = path.join(tmpdir, 'app_docs/agentic_kpis.md');
      fs.mkdirSync(path.dirname(dstFile), { recursive: true });
      fs.copyFileSync(srcFile, dstFile);

      execSync('git add "app_docs/agentic_kpis.md"', { stdio: 'pipe', cwd: tmpdir });
      execSync('git commit -m "kpis: update agentic_kpis"', { stdio: 'pipe', cwd: tmpdir });
      execSync(`git push origin HEAD:"${defaultBranch}"`, { stdio: 'pipe', cwd: tmpdir });

      log(`Committed and pushed agentic_kpis.md to ${defaultBranch}`, 'success');
      return true;
    } finally {
      cleanupKpiTempWorktree(cwd, tmpdir);
    }
  } catch (error) {
    log(`Failed to commit KPI file: ${error}`, 'error');
    return false;
  }
}
