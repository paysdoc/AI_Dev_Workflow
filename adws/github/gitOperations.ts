/**
 * Git operations barrel - re-exports from focused modules.
 *
 * This file exists for backwards compatibility so that existing imports
 * from './gitOperations' continue to work unchanged.
 */

// Branch operations
export {
  getCurrentBranch,
  generateBranchName,
  generateFeatureBranchName,
  createFeatureBranch,
  checkoutBranch,
  inferIssueTypeFromBranch,
  getDefaultBranch,
  checkoutDefaultBranch,
  mergeLatestFromDefaultBranch,
  deleteLocalBranch,
  deleteRemoteBranch,
} from './gitBranchOperations';

// Commit and push operations
export {
  commitChanges,
  pushBranch,
  pullLatestCostBranch,
  commitAndPushCostFiles,
  PROTECTED_BRANCHES,
  type CommitCostFilesOptions,
} from './gitCommitOperations';
