/**
 * Package-private branch operation orchestration for GitContext.
 * Each function takes an injected runner (cmd, cwd) => string so GitContext
 * methods stay thin and this module is testable without a real context.
 */

export const PROTECTED_BRANCHES = ['main', 'master', 'develop'] as const;

type Runner = (command: string, cwd: string) => string;

function isProtected(branch: string): boolean {
  return (PROTECTED_BRANCHES as readonly string[]).includes(branch);
}

function getCurrentBranch(run: Runner, cwd: string): string {
  return run('git branch --show-current', cwd);
}

function mergeLatestFromDefaultBranch(run: Runner, defaultBranch: string, cwd: string): void {
  try {
    run(`git fetch origin "${defaultBranch}"`, cwd);
  } catch (_err) {
    // warn-don't-throw: fetch failure should not abort the workflow
    return;
  }
  try {
    run(`git merge "origin/${defaultBranch}" --no-edit`, cwd);
  } catch (_err) {
    // warn-don't-throw: merge conflicts are non-fatal here
  }
}

function fetchAndResetToRemote(run: Runner, defaultBranch: string, cwd: string): void {
  try {
    run(`git fetch origin "${defaultBranch}"`, cwd);
  } catch (error) {
    throw new Error(`Failed to fetch origin/${defaultBranch}: ${error}`);
  }
  try {
    run(`git reset --hard "origin/${defaultBranch}"`, cwd);
  } catch (error) {
    throw new Error(`Failed to reset to origin/${defaultBranch}: ${error}`);
  }
}

function deleteLocalBranch(run: Runner, branch: string, cwd: string): boolean {
  if (isProtected(branch)) return false;
  try {
    run(`git branch -D "${branch}"`, cwd);
    return true;
  } catch {
    return false;
  }
}

function deleteRemoteBranch(run: Runner, branch: string, cwd: string): boolean {
  if (isProtected(branch)) return false;
  try {
    run(`git push origin --delete "${branch}"`, cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns local branch names from `git branch --list`.
 * Strips the leading `*`/whitespace marker; returns [] on failure.
 */
function localBranches(run: Runner, cwd: string): string[] {
  try {
    const output = run('git branch --list', cwd);
    const branches: string[] = [];
    for (const line of output.split('\n')) {
      const branch = line.replace(/^\*?\s+/, '').trim();
      if (branch) branches.push(branch);
    }
    return branches;
  } catch {
    return [];
  }
}

export const branchOps = {
  getCurrentBranch,
  mergeLatestFromDefaultBranch,
  fetchAndResetToRemote,
  deleteLocalBranch,
  deleteRemoteBranch,
  localBranches,
};
