/**
 * Core module - Configuration, types, and utilities.
 */

// Constants
export { OrchestratorId } from './constants';
export type { OrchestratorIdType } from './constants';

// Configuration
export { CLAUDE_CODE_PATH, GITHUB_PAT, LOGS_DIR, SPECS_DIR, AGENTS_STATE_DIR, MAX_TEST_RETRY_ATTEMPTS, MAX_REVIEW_RETRY_ATTEMPTS, WORKTREES_DIR, TARGET_REPOS_DIR, COST_REPORT_CURRENCIES, MAX_CONCURRENT_PER_REPO, GRACE_PERIOD_MS, MAX_THINKING_TOKENS, TOKEN_LIMIT_THRESHOLD, MAX_TOKEN_CONTINUATIONS, getSafeSubprocessEnv, SLASH_COMMAND_MODEL_MAP, SLASH_COMMAND_MODEL_MAP_FAST, getModelForCommand, isFastMode, resolveClaudeCodePath, clearClaudeCodePathCache, SLASH_COMMAND_EFFORT_MAP, SLASH_COMMAND_EFFORT_MAP_FAST, getEffortForCommand } from './config';
export type { ReasoningEffort } from './config';

// Data types
export type {
  IssueClassSlashCommand,
  AdwSlashCommand,
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
  TargetRepoInfo,
} from '../types/dataTypes';

// Prefix maps for consistent branch naming and commit messages
export { commitPrefixMap, branchPrefixMap, branchPrefixAliases, adwCommandToIssueTypeMap, adwCommandToOrchestratorMap, issueTypeToOrchestratorMap, VALID_ISSUE_TYPES } from '../types/dataTypes';

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
  parseTargetRepoArgs,
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
export type { ModelUsage, ModelUsageMap, CurrencyAmount, CostBreakdown } from '../types/costTypes';
export { emptyModelUsage, emptyModelUsageMap } from '../types/costTypes';

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
  computeEurRate,
} from './costReport';

// Cost CSV writer
export type { ProjectCostRow } from './costCsvWriter';
export {
  getIssueCsvPath,
  getProjectCsvPath,
  formatIssueCostCsv,
  formatProjectCostCsv,
  parseProjectCostCsv,
  writeIssueCostCsv,
  parseIssueCostTotal,
  rebuildProjectCostCsv,
  revertIssueCostFile,
} from './costCsvWriter';

// Project configuration
export type { ProjectConfig, CommandsConfig } from './projectConfig';
export { loadProjectConfig, getDefaultProjectConfig, getDefaultCommandsConfig, parseMarkdownSections, parseCommandsMd } from './projectConfig';

// Issue classifier
export type { IssueClassificationResult } from './issueClassifier';
export { classifyWithAdwCommand, classifyIssueForTrigger, classifyGitHubIssue, extractAdwIdFromText } from './issueClassifier';

// Workflow mapping
export { getWorkflowScript } from './workflowMapping';

// Port allocator
export { allocateRandomPort, isPortAvailable } from './portAllocator';

// Target repo registry
export { setTargetRepo, getTargetRepo, clearTargetRepo, hasTargetRepo, resolveTargetRepoCwd } from './targetRepoRegistry';

// Orchestrator CLI utilities
export type { OrchestratorArgs } from './orchestratorCli';
export { extractCwdOption, extractIssueTypeOption, parseIssueNumber, printUsageAndExit as printOrchestratorUsage, parseOrchestratorArguments } from './orchestratorCli';

// Token Manager
export type { TokenTotals } from './tokenManager';
export { computeTotalTokens, computePrimaryModelTokens, isModelMatch } from './tokenManager';

// Target repo manager
export {
  getTargetRepoWorkspacePath,
  isRepoCloned,
  cloneTargetRepo,
  pullLatestDefaultBranch,
  ensureTargetRepoWorkspace,
} from './targetRepoManager';

