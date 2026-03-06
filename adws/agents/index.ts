/**
 * Agents module - Claude Code agent runners.
 * All agents use slash commands from .claude/commands/ for consistent prompt templates.
 */

// Claude Agent (base runners)
export {
  runClaudeAgent,
  runClaudeAgentWithCommand,
  computeTotalTokens,
  computePrimaryModelTokens,
  isModelMatch,
  type AgentResult,
  type ProgressInfo,
  type ProgressCallback,
} from './claudeAgent';

// Plan Agent
export {
  getPlanFilePath,
  planFileExists,
  readPlanFile,
  correctPlanFileNaming,
  runPrReviewPlanAgent,
  runPlanAgent,
} from './planAgent';

// Build Agent
export {
  runPrReviewBuildAgent,
  runBuildAgent,
} from './buildAgent';

// Test Agent
export {
  runTestAgent,
  runResolveTestAgent,
  runResolveE2ETestAgent,
  discoverE2ETestFiles,
  runPlaywrightE2ETests,
  type TestResult,
  type E2ETestResult,
  type TestAgentResult,
  type PlaywrightE2EResult,
} from './testAgent';

// Git Agent
export {
  runGenerateBranchNameAgent,
  runCommitAgent,
} from './gitAgent';

// Test Retry (shared test retry logic)
export {
  runUnitTestsWithRetry,
  runE2ETestsWithRetry,
  type TestRetryResult,
  type TestRetryOptions,
} from './testRetry';

// Review Agent
export {
  runReviewAgent,
  type ReviewIssue,
  type ReviewResult,
  type ReviewAgentResult,
} from './reviewAgent';

// Patch Agent
export {
  runPatchAgent,
  formatPatchArgs,
} from './patchAgent';

// Review Retry (multi-agent review-patch retry loop)
export {
  runReviewWithRetry,
  mergeReviewResults,
  REVIEW_AGENT_COUNT,
  type ReviewRetryResult,
  type ReviewRetryOptions,
  type MergedReviewResult,
} from './reviewRetry';

// PR Agent
export {
  runPullRequestAgent,
  formatPullRequestArgs,
  extractPrUrlFromOutput,
} from './prAgent';

// Document Agent
export {
  runDocumentAgent,
  formatDocumentArgs,
  extractDocPathFromOutput,
} from './documentAgent';

