/**
 * VCS module - Git command wrappers for branch, commit, and worktree operations.
 *
 * Branch and commit/push I/O operations have migrated to GitContext (#662).
 * Worktree operations have migrated to GitContext (#661).
 * This module now exports pure branch-name vocabulary and the getMainRepoPath utility.
 */

// Pure branch-name vocabulary (I/O ops migrated to GitContext #662)
export {
  validateSlug,
  generateBranchName,
  inferIssueTypeFromBranch,
  PROTECTED_BRANCHES,
} from './branchOperations';

// Branch identity (deterministic fallback predicates)
export { deterministicBranchName, branchMatchesIssue } from './branchIdentity';

// Main repo path utility (used by agent subprocess env injection)
export { getMainRepoPath } from './worktreeOperations';

// Worktree cleanup — killProcessesInDirectory re-exported from gitContext
export { killProcessesInDirectory } from './worktreeCleanup';
