/**
 * VCS module - Git command wrappers for branch, commit, and worktree operations.
 *
 * This module contains VCS-agnostic git operations. All functions take an explicit
 * `cwd` parameter — no global state, no provider interfaces.
 */

// Branch operations
export {
  getCurrentBranch,
  generateBranchName,
  generateFeatureBranchName,
  createFeatureBranch,
  checkoutBranch,
  inferIssueTypeFromBranch,
  checkoutDefaultBranch,
  mergeLatestFromDefaultBranch,
  fetchAndResetToRemote,
  deleteLocalBranch,
  deleteRemoteBranch,
  PROTECTED_BRANCHES,
} from './branchOperations';

// Commit operations
export {
  commitChanges,
  pushBranch,
  pullLatestCostBranch,
  commitAndPushCostFiles,
  commitAndPushKpiFile,
  type CommitCostFilesOptions,
} from './commitOperations';

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
