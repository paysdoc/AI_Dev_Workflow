/**
 * Agents module - Claude Code agent runners.
 * All agents use slash commands from .claude/commands/ for consistent prompt templates.
 */

// Claude Agent (base runners)
export {
  runClaudeAgentWithCommand,
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

// Test Discovery (E2E discovery and Playwright runner)
export {
  discoverE2ETestFiles,
  isValidE2ETestResult,
  runPlaywrightE2ETests,
  type E2ETestResult,
  type PlaywrightE2EResult,
} from './testDiscovery';

// Test Agent
export {
  runTestAgent,
  runResolveTestAgent,
  runResolveE2ETestAgent,
  type TestResult,
  type TestAgentResult,
} from './testAgent';

// Git Agent
export {
  runGenerateBranchNameAgent,
  runCommitAgent,
} from './gitAgent';

// BDD Scenario Runner
export {
  runScenariosByTag,
  type BddScenarioResult,
} from './bddScenarioRunner';

// Regression Scenario Proof
export {
  type ScenarioProofResult,
} from './regressionScenarioProof';

// Test Retry (shared test retry logic)
export {
  runUnitTestsWithRetry,
  runE2ETestsWithRetry,
  runBddScenariosWithRetry,
  type TestRetryResult,
  type TestRetryOptions,
  type BddScenarioRetryOptions,
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
} from './patchAgent';

// Review Retry (multi-agent review-patch retry loop)
export {
  runReviewWithRetry,
  type ReviewRetryResult,
  type ReviewRetryOptions,
  type MergedReviewResult,
} from './reviewRetry';

// PR Agent
export {
  runPullRequestAgent,
} from './prAgent';

// Document Agent
export {
  runDocumentAgent,
} from './documentAgent';

// KPI Agent
export {
  runKpiAgent,
} from './kpiAgent';

// Scenario Agent
export {
  runScenarioAgent,
} from './scenarioAgent';

// Validation Agent
export {
  runValidationAgent,
  findScenarioFiles,
  readScenarioContents,
  type ValidationResult,
  type MismatchItem,
} from './validationAgent';

// Resolution Agent
export {
  runResolutionAgent,
  type ResolutionResult,
  type ResolutionDecision,
} from './resolutionAgent';

// Dependency Extraction Agent
export {
  runDependencyExtractionAgent,
  parseDependencyArray,
} from './dependencyExtractionAgent';
