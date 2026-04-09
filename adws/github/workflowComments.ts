/**
 * Workflow comment formatting and posting functions.
 * Re-exports from focused modules for backwards compatibility.
 */

// Platform-agnostic parsing utilities (from core)
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
  extractActionableContent,
  parseWorkflowStageFromComment,
  extractAdwIdFromComment,
  extractBranchNameFromComment,
  extractPrUrlFromComment,
  extractPlanPathFromComment,
  detectRecoveryState,
} from '../core/workflowCommentParsing';

// GitHub-specific comment utilities
export { isAdwRunningForIssue } from './workflowCommentsBase';

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
