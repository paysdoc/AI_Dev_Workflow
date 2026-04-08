/**
 * ADW (AI Developer Workflow) module exports.
 *
 * This file provides a centralized export point for all ADW modules.
 */

// Core module - Configuration, types, and utilities
export {
  // Configuration
  CLAUDE_CODE_PATH,
  GITHUB_PAT,
  LOGS_DIR,
  SPECS_DIR,
  // Utilities
  generateAdwId,
  slugify,
  log,
  ensureLogsDirectory,
  type LogLevel,
  // Data types
  type IssueClassSlashCommand,
  type SlashCommand,
  type GitHubUser,
  type GitHubLabel,
  type GitHubMilestone,
  type GitHubComment,
  type GitHubIssueListItem,
  type GitHubIssue,
  type AgentPromptRequest,
  type AgentPromptResponse,
  type AgentTemplateRequest,
  type ClaudeCodeResultMessage,
  type WorkflowStage,
  type PRReviewComment,
  type PRDetails,
  type PRListItem,
  type PRReviewWorkflowStage,
  type RecoveryState,
  type IssueCommentSummary,
  // Orchestrator shared utilities
  shouldExecuteStage,
  hasUncommittedChanges,
  getNextStage,
} from './core';

// Agents module - Claude Code agent runners
// All agents use slash commands from .claude/commands/ for consistent prompt templates
export {
  runClaudeAgentWithCommand,
  type AgentResult,
  type ProgressInfo,
  type ProgressCallback,
  getPlanFilePath,
  planFileExists,
  runPrReviewPlanAgent,
  runPlanAgent,
  runPrReviewBuildAgent,
  runBuildAgent,
  runReviewAgent,
  runPatchAgent,
  runReviewWithRetry,
  type ReviewIssue,
  type ReviewResult,
  type ReviewAgentResult,
  type ReviewRetryResult,
  type ReviewRetryOptions,
} from './agents';

// VCS module - Git command wrappers
export {
  getCurrentBranch,
  generateFeatureBranchName,
  createFeatureBranch,
  checkoutBranch,
  commitChanges,
  pushBranch,
} from './vcs';

// GitHub module - GitHub API and workflow comments
export {
  getRepoInfo,
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
  getLastAdwCommitTimestamp,
  getUnaddressedComments,
  hasUnaddressedComments,
  STAGE_ORDER,
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
} from './github';

// Workflow Phases - Composable orchestrator phase functions
export {
  type WorkflowConfig,
  type PRReviewWorkflowConfig,
  initializeWorkflow,
  initializePRReviewWorkflow,
  executePlanPhase,
  executeBuildPhase,
  executeUnitTestPhase,
  executePRPhase,
  executeReviewPhase,
  executeInstallPhase,
  executePRReviewPlanPhase,
  executePRReviewBuildPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';
