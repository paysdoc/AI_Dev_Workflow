/**
 * Workflow comment formatting and posting functions.
 * Re-exports from focused modules for backwards compatibility.
 */

// Base utilities and parsing
export {
  STAGE_ORDER,
  ADW_SIGNATURE,
  ADW_SIGNATURE_PATTERN,
  truncateText,
  isAdwComment,
  ACTIONABLE_COMMENT_PATTERN,
  isActionableComment,
  extractActionableContent,
  isAdwRunningForIssue,
  parseWorkflowStageFromComment,
  extractAdwIdFromComment,
  extractBranchNameFromComment,
  extractPrUrlFromComment,
  extractPlanPathFromComment,
  detectRecoveryState,
} from './workflowCommentsBase';

// Issue workflow comments
export {
  type WorkflowContext,
  formatResumingComment,
  formatWorkflowComment,
  postWorkflowComment,
} from './workflowCommentsIssue';

// PR review workflow comments
export {
  type PRReviewWorkflowContext,
  formatPRReviewWorkflowComment,
  postPRWorkflowComment,
} from './workflowCommentsPR';
