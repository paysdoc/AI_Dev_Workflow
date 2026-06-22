/**
 * VCS module - Git command wrappers for branch, commit, and worktree operations.
 *
 * Branch and commit/push I/O operations have migrated to GitContext (#662).
 * This module now exports pure branch-name vocabulary and worktree operations.
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

// Worktree operations
export {
  getWorktreePath,
  worktreeExists,
  getMainRepoPath,
  isBranchCheckedOutElsewhere,
  freeBranchFromMainRepo,
  getWorktreesDir,
  copyEnvToWorktree,
  type BranchCheckoutStatus,
} from './worktreeOperations';

// Worktree query
export {
  listWorktrees,
  findWorktreeForIssue,
  type WorktreeForIssueResult,
} from './worktreeQuery';

// Worktree creation
export {
  createWorktree,
  createWorktreeForNewBranch,
  ensureWorktree,
  getWorktreeForBranch,
} from './worktreeCreation';

// Worktree cleanup
export {
  killProcessesInDirectory,
  removeWorktree,
  removeWorktreesForIssue,
} from './worktreeCleanup';
