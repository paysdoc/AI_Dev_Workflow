/**
 * VCS module - Git command wrappers for branch, commit, and worktree operations.
 *
 * Worktree create/remove/reset/list operations are now methods on GitContext
 * (adws/gitContext). This barrel exports only the surviving utilities:
 *   - Branch and commit operations (unchanged)
 *   - getMainRepoPath — explicit-cwd reverse lookup used by claudeAgent.ts
 *   - killProcessesInDirectory — janitor process-kill util (no base-path concern)
 */

// Branch operations
export {
  getCurrentBranch,
  validateSlug,
  generateBranchName,
  checkoutBranch,
  inferIssueTypeFromBranch,
  checkoutDefaultBranch,
  mergeLatestFromDefaultBranch,
  fetchAndResetToRemote,
  deleteLocalBranch,
  deleteRemoteBranch,
  PROTECTED_BRANCHES,
} from './branchOperations';

// Branch identity (deterministic fallback predicates)
export { deterministicBranchName, branchMatchesIssue } from './branchIdentity';

// Commit operations
export {
  commitChanges,
  pushBranch,
  getHeadTreeHash,
  hasUncommittedChanges,
} from './commitOperations';

// Worktree reverse-lookup (explicit cwd, no defaulting)
export { getMainRepoPath } from './worktreeOperations';

// Process-kill util (no base-path concern; used by devServerJanitor)
export { killProcessesInDirectory } from './worktreeProcessKill';
