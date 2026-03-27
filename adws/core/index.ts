/**
 * Core module - Configuration, types, and utilities.
 */

// Constants
export { OrchestratorId, MAX_AUTO_MERGE_ATTEMPTS } from './constants';
export type { OrchestratorIdType } from './constants';

// Configuration
export { CLAUDE_CODE_PATH, GITHUB_PAT, JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PAT, JIRA_PROJECT_KEY, GITLAB_TOKEN, GITLAB_INSTANCE_URL, LOGS_DIR, SPECS_DIR, AGENTS_STATE_DIR, MAX_TEST_RETRY_ATTEMPTS, MAX_REVIEW_RETRY_ATTEMPTS, MAX_VALIDATION_RETRY_ATTEMPTS, WORKTREES_DIR, TARGET_REPOS_DIR, COST_REPORT_CURRENCIES, REVIEW_AGENT_COUNT, MAX_CONCURRENT_PER_REPO, GRACE_PERIOD_MS, MAX_THINKING_TOKENS, TOKEN_LIMIT_THRESHOLD, MAX_CONTEXT_RESETS, RUNNING_TOKENS, SHOW_COST_IN_COMMENTS, PROBE_INTERVAL_CYCLES, MAX_UNKNOWN_PROBE_FAILURES, getSafeSubprocessEnv, SLASH_COMMAND_MODEL_MAP, SLASH_COMMAND_MODEL_MAP_FAST, getModelForCommand, isFastMode, resolveClaudeCodePath, clearClaudeCodePathCache, SLASH_COMMAND_EFFORT_MAP, SLASH_COMMAND_EFFORT_MAP_FAST, getEffortForCommand, COST_API_URL, COST_API_TOKEN } from './config';
export type { ReasoningEffort } from './config';

// Data types (from issueTypes.ts)
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
  PullRequestWebhookPayload,
  IssueCommentSummary,
  TargetRepoInfo,
} from '../types/issueTypes';
export { VALID_ISSUE_TYPES } from '../types/issueTypes';

// Data types (from agentTypes.ts)
export type {
  AgentResult,
  AgentPromptRequest,
  AgentPromptResponse,
  AgentTemplateRequest,
  ClaudeCodeResultMessage,
  AgentIdentifier,
  AgentExecutionStatus,
  AgentExecutionState,
  AgentState,
  TokenUsageSnapshot,
} from '../types/agentTypes';

// Data types (from workflowTypes.ts)
export type {
  WorkflowStage,
  PRReviewComment,
  PRDetails,
  PRListItem,
  PRReviewWorkflowStage,
  RecoveryState,
} from '../types/workflowTypes';

// Prefix maps and routing maps for consistent branch naming, commit messages, and orchestrator dispatch
export { commitPrefixMap, branchPrefixMap, branchPrefixAliases, adwCommandToIssueTypeMap, adwCommandToOrchestratorMap, issueTypeToOrchestratorMap } from '../types/issueRouting';

// Utilities
export {
  generateAdwId,
  slugify,
  log,
  setLogAdwId,
  getLogAdwId,
  resetLogAdwId,
  ensureLogsDirectory,
  parseTargetRepoArgs,
  execWithRetry,
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

// Cost types (re-exported from adws/cost for backward compatibility)
export type { ModelUsage, ModelUsageMap, CurrencyAmount, CostBreakdown } from '../cost';
export { emptyModelUsage, emptyModelUsageMap } from '../cost';

// Cost helpers (re-exported from adws/cost for backward compatibility)
export {
  CURRENCY_SYMBOLS,
  fetchExchangeRates,
  mergeModelUsageMaps,
  computeTotalCostUsd,
  buildCostBreakdown,
  formatCostBreakdownMarkdown,
  persistTokenCounts,
  computeEurRate,
} from '../cost';

// Project configuration
export type { ProjectConfig, CommandsConfig, ProvidersConfig, ScenariosConfig } from './projectConfig';
export { loadProjectConfig, getDefaultProjectConfig, getDefaultCommandsConfig, getDefaultProvidersConfig, getDefaultScenariosConfig, parseMarkdownSections, parseCommandsMd, parseProvidersMd, parseScenariosMd, parseUnitTestsEnabled } from './projectConfig';

// Issue classifier
export type { IssueClassificationResult } from './issueClassifier';
export { classifyIssueForTrigger, classifyGitHubIssue, extractAdwIdFromText } from './issueClassifier';

// Workflow mapping
export { getWorkflowScript } from './workflowMapping';

// Port allocator
export { allocateRandomPort, isPortAvailable } from './portAllocator';

// Orchestrator CLI utilities
export type { OrchestratorArgs } from './orchestratorCli';
export { extractCwdOption, printUsageAndExit as printOrchestratorUsage, parseOrchestratorArguments, buildRepoIdentifier } from './orchestratorCli';

// Token utilities (re-exported from adws/cost for backward compatibility)
export type { TokenTotals, ModelTokenEntry } from '../cost';
export { computeTotalTokens, computeDisplayTokens, computePrimaryModelTokens, isModelMatch } from '../cost';

// Target repo manager
export {
  getTargetRepoWorkspacePath,
  isRepoCloned,
  cloneTargetRepo,
  pullLatestDefaultBranch,
  ensureTargetRepoWorkspace,
} from './targetRepoManager';

// Cost module (PhaseCostRecord, comment formatters)
export type { PhaseCostRecord, CreatePhaseCostRecordsOptions } from '../cost';
export {
  PhaseCostStatus,
  createPhaseCostRecords,
  formatCostTable,
  formatDivergenceWarning,
  formatEstimateVsActual,
  formatCurrencyTotals,
  formatCostCommentSection,
} from '../cost';

// Phase runner utilities
export type { PhaseResult, PhaseFn } from './phaseRunner';
export { CostTracker, runPhase, runPhasesSequential, runPhasesParallel } from './phaseRunner';

// Pause queue
export type { PausedWorkflow } from './pauseQueue';
export { PAUSE_QUEUE_PATH, readPauseQueue, appendToPauseQueue, removeFromPauseQueue, updatePauseQueueEntry } from './pauseQueue';

// Workflow comment parsing (platform-agnostic)
export {
  STAGE_ORDER,
  ADW_SIGNATURE,
  ADW_SIGNATURE_PATTERN,
  formatModelName,
  formatRunningTokenFooter,
  isAdwComment,
  ACTIONABLE_COMMENT_PATTERN,
  isActionableComment,
  CLEAR_COMMENT_PATTERN,
  isClearComment,
  extractActionableContent,
  truncateText,
  parseWorkflowStageFromComment,
  extractAdwIdFromComment,
  extractBranchNameFromComment,
  extractPrUrlFromComment,
  extractPlanPathFromComment,
  detectRecoveryState,
} from './workflowCommentParsing';

