/**
 * GitHub module - GitHub API and git operations.
 */

// GitHub API
export {
  getRepoInfo,
  getRepoInfoFromUrl,
  getRepoInfoFromPayload,
  fetchGitHubIssue,
  fetchPRDetails,
  fetchPRReviews,
  fetchPRReviewComments,
  commentOnPR,
  fetchPRList,
  commentOnIssue,
  fetchIssueCommentsRest,
  deleteIssueComment,
  type RepoInfo,
} from './githubApi';

// Git Operations
export {
  getCurrentBranch,
  generateBranchName,
  generateFeatureBranchName,
  createFeatureBranch,
  checkoutBranch,
  commitChanges,
  pushBranch,
  getDefaultBranch,
  checkoutDefaultBranch,
  inferIssueTypeFromBranch,
  mergeLatestFromDefaultBranch,
  deleteLocalBranch,
  deleteRemoteBranch,
} from './gitOperations';

// Pull Request Creator
export { createPullRequest } from './pullRequestCreator';

// Worktree Operations
export {
  getWorktreePath,
  worktreeExists,
  listWorktrees,
  createWorktree,
  createWorktreeForNewBranch,
  killProcessesInDirectory,
  removeWorktree,
  removeWorktreesForIssue,
  getWorktreeForBranch,
  ensureWorktree,
  getMainRepoPath,
  isBranchCheckedOutElsewhere,
  freeBranchFromMainRepo,
  getWorktreesDir,
  copyEnvToWorktree,
  findWorktreeForIssue,
  type BranchCheckoutStatus,
  type WorktreeForIssueResult,
} from './worktreeOperations';

// PR Comment Detector
export {
  getLastAdwCommitTimestamp,
  getUnaddressedComments,
  hasUnaddressedComments,
} from './prCommentDetector';

// Workflow Comments
export {
  STAGE_ORDER,
  ADW_SIGNATURE,
  ADW_SIGNATURE_PATTERN,
  truncateText,
  isAdwComment,
  ACTIONABLE_COMMENT_PATTERN,
  isActionableComment,
  isAdwRunningForIssue,
  parseWorkflowStageFromComment,
  extractAdwIdFromComment,
  extractBranchNameFromComment,
  extractPrUrlFromComment,
  extractPlanPathFromComment,
  detectRecoveryState,
  formatResumingComment,
  formatWorkflowComment,
  postWorkflowComment,
  formatPRReviewWorkflowComment,
  postPRWorkflowComment,
  type WorkflowContext,
  type PRReviewWorkflowContext,
} from './workflowComments';
