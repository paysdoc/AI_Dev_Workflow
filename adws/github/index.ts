/**
 * GitHub module - GitHub API and workflow comment operations.
 */

// GitHub API
export {
  getRepoInfo,
  getRepoInfoFromUrl,
  getRepoInfoFromPayload,
  getAuthenticatedUser,
  fetchGitHubIssue,
  fetchPRDetails,
  fetchPRReviews,
  fetchPRReviewComments,
  commentOnPR,
  fetchPRList,
  commentOnIssue,
  fetchIssueCommentsRest,
  deleteIssueComment,
  getIssueTitleSync,
  type RepoInfo,
} from './githubApi';

// Pull Request Creator
export { createPullRequest } from './pullRequestCreator';

// GitHub App Authentication
export {
  isGitHubAppConfigured,
  activateGitHubAppAuth,
  ensureAppAuthForRepo,
  refreshTokenIfNeeded,
  getInstallationToken,
} from './githubAppAuth';

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
  CLEAR_COMMENT_PATTERN,
  isClearComment,
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
