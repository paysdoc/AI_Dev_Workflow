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
  mergePR,
  approvePR,
  fetchPRList,
  fetchPRApprovalState,
  commentOnIssue,
  fetchIssueCommentsRest,
  deleteIssueComment,
  getIssueTitleSync,
  issueHasLabel,
  addIssueLabel,
  type RepoInfo,
} from './githubApi';

// Project Board API
export { moveIssueToStatus } from './projectBoardApi';

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

// Proof Comment Formatter
export {
  formatReviewProofComment,
  formatProofTable,
  formatVerificationSection,
  formatNonBlockerSection,
  formatBlockerSection,
  formatScenarioOutputSection,
  type ProofCommentInput,
  type VerificationResult,
} from './proofCommentFormatter';

// Workflow Comments
export {
  STAGE_ORDER,
  ADW_SIGNATURE,
  ADW_SIGNATURE_PATTERN,
  truncateText,
  isAdwComment,
  ACTIONABLE_COMMENT_PATTERN,
  isActionableComment,
  CANCEL_COMMENT_PATTERN,
  isCancelComment,
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
