/**
 * Core module - Configuration, types, and utilities.
 */

// Configuration
export { CLAUDE_CODE_PATH, GITHUB_PAT, LOGS_DIR, SPECS_DIR, AGENTS_STATE_DIR, MAX_TEST_RETRY_ATTEMPTS, MAX_REVIEW_RETRY_ATTEMPTS, WORKTREES_DIR, COST_REPORT_CURRENCIES, MAX_THINKING_TOKENS, TOKEN_LIMIT_THRESHOLD, MAX_TOKEN_CONTINUATIONS, getSafeSubprocessEnv, SLASH_COMMAND_MODEL_MAP, SLASH_COMMAND_MODEL_MAP_FAST, getModelForCommand, isFastMode } from './config';

// Data types
export type {
  IssueClassSlashCommand,
  AdwSlashCommand,
  AdwClassificationResult,
  SlashCommand,
  GitHubUser,
  GitHubLabel,
  GitHubMilestone,
  GitHubComment,
  GitHubIssueListItem,
  GitHubIssue,
  AgentPromptRequest,
  AgentPromptResponse,
  AgentTemplateRequest,
  ClaudeCodeResultMessage,
  WorkflowStage,
  PRReviewComment,
  PRDetails,
  PRListItem,
  PRReviewWorkflowStage,
  RecoveryState,
  PullRequestWebhookPayload,
  AgentIdentifier,
  AgentExecutionStatus,
  AgentExecutionState,
  AgentState,
  IssueCommentSummary,
  TokenUsageSnapshot,
} from './dataTypes';

// Prefix maps for consistent branch naming and commit messages
export { commitPrefixMap, branchPrefixMap, adwCommandToIssueTypeMap, adwCommandToOrchestratorMap } from './dataTypes';

// Utilities
export {
  generateAdwId,
  slugify,
  log,
  setLogAdwId,
  getLogAdwId,
  resetLogAdwId,
  ensureLogsDirectory,
  ensureAgentStateDirectory,
  getAgentStatePath,
  type LogLevel,
} from './utils';

// Agent State Management
export {
  AgentStateManager,
  initializeAgentState,
  writeAgentState,
  readAgentState,
  appendAgentLog,
  writeAgentRawOutput,
  readParentAgentState,
  isProcessAlive,
  findOrchestratorStatePath,
  isAgentProcessRunning,
} from './agentState';

// Orchestrator shared utilities
export { shouldExecuteStage, hasUncommittedChanges, getNextStage } from './orchestratorLib';

// Cost types
export type { ModelUsage, ModelUsageMap, CurrencyAmount, CostBreakdown } from './costTypes';
export { emptyModelUsage, emptyModelUsageMap } from './costTypes';

// Cost pricing
export type { ModelPricing } from './costPricing';
export { MODEL_PRICING, getModelPricing, computeModelCost } from './costPricing';

// Cost report
export {
  CURRENCY_SYMBOLS,
  mergeModelUsageMaps,
  computeTotalCostUsd,
  fetchExchangeRates,
  buildCostBreakdown,
  formatCostBreakdownMarkdown,
  persistTokenCounts,
} from './costReport';

// Issue classifier
export type { IssueClassificationResult } from './issueClassifier';
export { parseAdwClassificationOutput, classifyWithAdwCommand, classifyIssueForTrigger, classifyGitHubIssue, getWorkflowScript } from './issueClassifier';

// Port allocator
export { allocateRandomPort, isPortAvailable } from './portAllocator';

