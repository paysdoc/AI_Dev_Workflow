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

// Command Agent (shared helper for thin wrapper agents)
export {
  runCommandAgent,
  type CommandAgentConfig,
  type CommandAgentOptions,
  type CommandAgentResult,
  type ExtractionResult,
  OutputValidationError,
} from './commandAgent';

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
  runResolveScenarioAgent,
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

// Test Retry (shared test retry logic)
export {
  runUnitTestsWithRetry,
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

// Step Definition Agent
export {
  runStepDefAgent,
  type StepDefAgentResult,
  type RemovedScenario,
} from './stepDefAgent';

// Install Agent
export {
  runInstallAgent,
} from './installAgent';

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

// Alignment Agent (single-pass alignment)
export {
  runAlignmentAgent,
  parseAlignmentResult,
  type AlignmentResult,
} from './alignmentAgent';

// Dependency Extraction Agent
export {
  runDependencyExtractionAgent,
  parseDependencyArray,
} from './dependencyExtractionAgent';

// Diff Evaluator Agent
export {
  runDiffEvaluatorAgent,
  type DiffEvaluatorVerdict,
} from './diffEvaluatorAgent';
