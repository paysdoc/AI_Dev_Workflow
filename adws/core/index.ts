export { OrchestratorId, MAX_AUTO_MERGE_ATTEMPTS } from './constants';
export type { OrchestratorIdType } from './constants';

export { CLAUDE_CODE_PATH, GITHUB_PAT, JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PAT, JIRA_PROJECT_KEY, GITLAB_TOKEN, GITLAB_INSTANCE_URL, LOGS_DIR, SPECS_DIR, AGENTS_STATE_DIR, MAX_TEST_RETRY_ATTEMPTS, MAX_REVIEW_RETRY_ATTEMPTS, MAX_VALIDATION_RETRY_ATTEMPTS, MAX_FAILURES, WORKTREES_DIR, TARGET_REPOS_DIR, REPO_ROOT, assertCwdIsRepoRoot, COST_REPORT_CURRENCIES, MAX_CONCURRENT_PER_REPO, GRACE_PERIOD_MS, HEARTBEAT_TICK_INTERVAL_MS, HEARTBEAT_STALE_THRESHOLD_MS, MAX_THINKING_TOKENS, TOKEN_LIMIT_THRESHOLD, MAX_CONTEXT_RESETS, MAX_PROGRESS_CHECKPOINTS, RUNNING_TOKENS, SHOW_COST_IN_COMMENTS, PROBE_INTERVAL_CYCLES, MAX_UNKNOWN_PROBE_FAILURES, JANITOR_INTERVAL_CYCLES, HUNG_DETECTOR_INTERVAL_CYCLES, PER_ISSUE_SCENARIO_SWEEP_INTERVAL_CYCLES, PROMOTION_SWEEP_INTERVAL_CYCLES, DOCS_INDEX_SWEEP_INTERVAL_CYCLES, getSafeSubprocessEnv, SLASH_COMMAND_MODEL_MAP, SLASH_COMMAND_MODEL_MAP_FAST, getModelForCommand, isFastMode, resolveClaudeCodePath, clearClaudeCodePathCache, SLASH_COMMAND_EFFORT_MAP, SLASH_COMMAND_EFFORT_MAP_FAST, getEffortForCommand, COST_API_URL, COST_API_TOKEN } from './config';
export type { ReasoningEffort } from './config';

export type {
  IssueClassSlashCommand,
  SlashCommand,
  PullRequestWebhookPayload,
  TargetRepoInfo,
} from '../types/issueTypes';
export { VALID_ISSUE_TYPES } from '../types/issueTypes';

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
  PhaseExecutionState,
  TokenUsageSnapshot,
} from '../types/agentTypes';
export { RateLimitError, AuthRequiredError, AgentTimeoutError } from '../types/agentTypes';

export type {
  WorkflowStage,
  PRReviewWorkflowStage,
  RecoveryState,
} from '../types/workflowTypes';

export { commitPrefixMap, branchPrefixMap, branchPrefixAliases, issueTypeToOrchestratorMap } from '../types/issueRouting';

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

export {
  AgentStateManager,
  initializeAgentState,
  writeAgentState,
  readAgentState,
  appendAgentLog,
  writeAgentRawOutput,
  readParentAgentState,
  findOrchestratorStatePath,
  isAgentProcessRunning,
  getProcessStartTime,
  isProcessLive,
} from './agentState';

export { shouldExecuteStage, getNextStage } from './orchestratorLib';

export type { ModelUsage, ModelUsageMap, CurrencyAmount, CostBreakdown } from '../cost';
export { emptyModelUsage, emptyModelUsageMap } from '../cost';

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

export type { ProjectConfig, CommandsConfig, ProvidersConfig, ScenariosConfig } from './projectConfig';
export { loadProjectConfig, getDefaultProjectConfig, getDefaultCommandsConfig, getDefaultProvidersConfig, getDefaultScenariosConfig, parseMarkdownSections, parseCommandsMd, parseProvidersMd, parseScenariosMd, parseUnitTestsEnabled } from './projectConfig';

export type { TestVerdictInput, TestVerdictResult, TestVerdictOutcome } from './testVerdict';
export { computeTestVerdict } from './testVerdict';

export type { DocSize, BloatFlag, RegrowthFlag, GuardFlags } from './docsGuards';
export { DOC_BLOAT_THRESHOLD_LINES, globsOverlap, checkBloat, checkRegrowth, runDocsGuards } from './docsGuards';

export type { CountBand, DocsIndexRepair, DocsIndexViolation, DocsIndexHealthInputs, DocsIndexAssessment } from './docsIndexHealth';
export { DEFAULT_COUNT_BAND, isFeatureDocPath, findRepairs, applyRepairs, findViolations, assessDocsIndexHealth, formatRepair, formatViolation } from './docsIndexHealth';

export type { BuildDocsIndexReportIssueInput, DocsIndexReportIssueSpec, DocsIndexReportMarker, DocsIndexReportIssueRef } from './docsIndexReportBody';
export { DOCS_INDEX_REPORT_MARKER, docsIndexViolationFingerprint, buildDocsIndexReportIssue, parseDocsIndexReportMarker, findOpenDocsIndexReport } from './docsIndexReportBody';

export type { ResolveEditVerdict } from './resolveFreezeGuard';
export { evaluateResolveEdit } from './resolveFreezeGuard';

export type { ResolveVerdictOutcome, ResolveVerdictSignals } from './resolveVerdict';
export { computeResolveVerdict } from './resolveVerdict';

export type { TestReport, TestCaseResult } from './testReportParser';
export { parseJUnitXml, readJUnitReport } from './testReportParser';

export { stepDefExtensionsFor, hasStepDefinitions, isGherkinFramework } from './stepDefDetection';

export type { StackCoherenceInput, StackCoherenceResult, StackCoherenceWarning, StackCoherenceWarningCode } from './stackCoherenceCheck';
export { stackCoherenceCheck } from './stackCoherenceCheck';

export type { IssueClassificationResult, ClassifiableIssue, ClassifyIssueForTriggerDeps } from './issueClassifier';
export { classifyIssueForTrigger, classifyGitHubIssue } from './issueClassifier';

export type { AdwLabelDefinition, AdwLabelReading } from './adwLabels';
export {
  ADW_NONE_LABEL,
  ADW_UPGRADE_LABEL,
  ADW_UNVERIFIED_LABEL,
  ADW_BLOCKED_LABEL,
  ADW_REGRESSION_PROMOTION_LABEL,
  hasRegressionPromotionLabel,
  ADW_CLASSIFICATION_LABELS,
  ADW_LABEL_DEFINITIONS,
  REGRESSION_PROMOTION_LABEL_DEFINITION,
  readAdwLabelNames,
  readAdwLabels,
  issueTypeToAdwLabel,
  shouldSkipScenarioAuthoring,
  scenarioAuthoringSkipReason,
  type ScenarioAuthoringSkipReason,
  resolveAdwLabelDefinition,
  hasWontFixLabelName,
} from './adwLabels';

export { isGitHubAppConfigured, getInstallationToken } from './githubAppAuth';

export { fetchIssueRecord } from './issueRecord';

export { readLocalRepoIdentity } from './localRepoIdentity';
export type { LocalRepoIdentityDeps } from './localRepoIdentity';

export { readUnaddressedComments, getLastAdwCommitTimestamp } from './unaddressedComments';
export type { UnaddressedCommentCandidate, UnaddressedCommentReads } from './unaddressedComments';

export { resolvePrReviewInvocation } from './prReviewInvocation';
export type { PrReviewInvocationDeps, PrReviewInvocation } from './prReviewInvocation';

export { getWorkflowScript } from './workflowMapping';

export { allocateRandomPort, isPortAvailable } from './portAllocator';

export type { OrchestratorArgs } from './orchestratorCli';
export { extractCwdOption, printUsageAndExit as printOrchestratorUsage, parseOrchestratorArguments, buildRepoIdentifier } from './orchestratorCli';

export type { TokenTotals, ModelTokenEntry } from '../cost';
export { computeTotalTokens, computeDisplayTokens, computePrimaryModelTokens, isModelMatch } from '../cost';

export {
  getTargetRepoWorkspacePath,
  isRepoCloned,
  cloneTargetRepo,
  ensureTargetRepoWorkspace,
  ensureWorkspaceTrusted,
} from './targetRepoManager';
export type { WorkspaceTrustDeps, WorkspaceTrustResult } from './workspaceTrust';

export { buildLaunchGitContext, buildLaunchBoundary } from './launchGitContext';
export type { LaunchGitContextDeps, LaunchBoundary } from './launchGitContext';

export { bindWorkspaceContext, validateGitRemote } from './workspaceBinding';

export { crossCheckRepoIdentity, sameRepoIdentity, RepoIdentityMismatchError } from './repoIdentityCrossCheck';

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

export type { HeartbeatHandle } from './heartbeat';
export { startHeartbeat, stopHeartbeat } from './heartbeat';

export { findHungOrchestrators, defaultHungDetectorDeps } from './hungOrchestratorDetector';
export type { HungOrchestrator, HungDetectorDeps } from './hungOrchestratorDetector';

export type { PhaseResult, PhaseFn } from './phaseRunner';
export { CostTracker, runPhase, runPhasesSequential, runPhasesParallel } from './phaseRunner';

export { AGENT_DEFAULT_TIMEOUT_MS, AGENT_PHASE_TIMEOUT_MAP, getAgentTimeoutForPhase } from './agentTimeouts';

export { killProcessGroup } from './processKill';

export type { PausedWorkflow } from './pauseQueue';
export { PAUSE_QUEUE_PATH, readPauseQueue, appendToPauseQueue, removeFromPauseQueue, updatePauseQueueEntry, resetsAtIsoFromEpochSeconds } from './pauseQueue';

export { deriveStageFromRemote, mapArtifactsToStage, MAX_RECONCILE_VERIFICATION_RETRIES, buildDefaultReconcileDeps } from './remoteReconcile';
export type { ReconcileDeps } from './remoteReconcile';

export { computeFrameworkHash, defaultDeps as hashComputerDefaultDeps, ADW_INIT_RELATIVE_PATH } from './hashComputer';
export type { HashComputerDeps } from './hashComputer';

export { claimUpgradeOrFindExisting, buildDefaultUpgradeClaimDeps, buildClaimBranchName, buildClaimResult, isPushRejectionError, extractGitErrorText } from './upgradeClaim';
export type { UpgradeClaimDeps, UpgradeClaimResult } from './upgradeClaim';

export {
  STAGE_ORDER,
  ADW_SIGNATURE,
  ADW_SIGNATURE_PATTERN,
  formatModelName,
  formatRunningTokenFooter,
  isAdwComment,
  ACTIONABLE_COMMENT_PATTERN,
  isActionableComment,
  CANCEL_COMMENT_PATTERN,
  isCancelComment,
  RETRY_COMMENT_PATTERN,
  isRetryComment,
  extractActionableContent,
  truncateText,
  parseWorkflowStageFromComment,
  extractAdwIdFromComment,
  extractBranchNameFromComment,
  extractPrUrlFromComment,
  extractPlanPathFromComment,
  detectRecoveryState,
} from './workflowCommentParsing';

export { ADW_VERSION_FILENAME, readAdwVersion, writeAdwVersion } from './adwVersion';

export { ADW_YML_RELATIVE_PATH, readAdwYmlConfig, parseAdwYml, writeAdwYmlTemplateIfAbsent, ADW_YML_TEMPLATE } from './adwYmlConfig';
export type { AdwYmlConfig } from './adwYmlConfig';

export { postSlack } from './slackNotifier';

export { isUpgradeFailureComment, countUpgradeFailureComments, UPGRADE_FAILURE_SIGNATURE } from './upgradeFailureCap';
export type { IssueCommentRecord } from './upgradeFailureCap';

export { buildGuardrailsSettings, serializeGuardrailsSettings, resolveHookLogDir, STARTER_SETTINGS_TEMPLATE_RELATIVE_PATH } from './guardrailsPayload';
export type { GuardrailsSettings, GuardrailsHookEntry } from './guardrailsPayload';
export { resolveGuardrailsDecision, resolveGuardrailsDecisionForSpawn, productionGuardrailsGateDeps, setGuardrailsGateDepsForTesting, resetGuardrailsAlertMemo } from './guardrailsGate';
export type { GuardrailsDecision, GuardrailsGateInput, GuardrailsGateDeps } from './guardrailsGate';
export { runGuardrailsProbe, getGuardrailsProbeVerdict, resetGuardrailsProbeMemo } from './guardrailsProbe';
export type { ProbeVerdict } from './guardrailsProbe';
