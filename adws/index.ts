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
  type AgentPromptRequest,
  type AgentPromptResponse,
  type AgentTemplateRequest,
  type ClaudeCodeResultMessage,
  type WorkflowStage,
  type PRReviewWorkflowStage,
  type RecoveryState,
  // Orchestrator shared utilities
  shouldExecuteStage,
  getNextStage,
  // Unaddressed PR-review comment filter
  getLastAdwCommitTimestamp,
  // Workflow comment parsing (platform-agnostic)
  STAGE_ORDER,
  parseWorkflowStageFromComment,
  extractAdwIdFromComment,
  extractBranchNameFromComment,
  extractPrUrlFromComment,
  extractPlanPathFromComment,
  detectRecoveryState,
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
  type ReviewIssue,
  type ReviewResult,
  type ReviewAgentResult,
} from './agents';

// VCS module — pure branch-name vocabulary (I/O ops migrated to GitContext #662)
export {
  validateSlug,
  generateBranchName,
} from './vcs';

// Forge helpers - workflow comment formatters
export {
  formatResumingComment,
  formatWorkflowComment,
  type WorkflowContext,
} from './forge/workflowCommentsIssue';
export {
  formatPRReviewWorkflowComment,
  type PRReviewWorkflowContext,
} from './forge/workflowCommentsPR';

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
  executePRReviewCommitPushPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
  completeWorkflow,
  handleWorkflowError,
} from './workflowPhases';
