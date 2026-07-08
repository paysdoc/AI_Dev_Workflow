/**
 * Composable workflow phase functions for orchestrators.
 *
 * Provides high-level phase functions that compose lower-level operations
 * from core/, github/, agents/, and triggers/ modules. Each orchestrator
 * composes these phases in its main() function.
 *
 * Located at adws/ level (not in core/) because it imports from
 * agents/, github/, triggers/, and core/.
 */

export { ensureGitignoreEntry, ensureGitignoreEntries, copyClaudeAssetsToWorktree } from './worktreeSetup';
export { type WorkflowConfig, initializeWorkflow } from './workflowInit';
export { completeWorkflow, handleWorkflowError, handleWorkflowDiscarded, handleRateLimitPause } from './workflowCompletion';
export { executeReviewPhase, executeReviewPatchCycle, type ReviewIssue } from './reviewPhase';
export { executePlanPhase, buildContinuationPrompt, buildResumeInPlacePrompt, shouldResumeBuildInPlace, MAX_CONTINUATION_OUTPUT_LENGTH } from './planPhase';
export { executeBuildPhase } from './buildPhase';
export { executeUnitTestPhase } from './unitTestPhase';
export { executePRPhase } from './prPhase';
export { executeDocumentPhase } from './documentPhase';
export { executePlanValidationPhase } from './planValidationPhase';
export { executeAlignmentPhase } from './alignmentPhase';
export {
  type PRReviewWorkflowConfig,
  initializePRReviewWorkflow,
  executePRReviewPlanPhase,
  executePRReviewBuildPhase,
  executePRReviewCommitPushPhase,
} from './prReviewPhase';
export {
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
} from './prReviewCompletion';
export { executeScenarioPhase } from './scenarioPhase';
export { executeStepDefPhase } from './stepDefPhase';
export { executeInstallPhase, extractInstallContext } from './installPhase';
export { executeAutoMergePhase } from './autoMergePhase';
export { executeDiffEvaluationPhase, type DiffEvaluationPhaseResult } from './diffEvaluationPhase';
export { executeScenarioTestPhase } from './scenarioTestPhase';
export { executeScenarioFixPhase } from './scenarioFixPhase';
export { captureGherkinSnapshot, collectChangedFeaturePaths, restoreGherkinSnapshot } from './gherkinFreeze';
export {
  runScenarioTestFixLoop,
  ScenarioHermeticityError,
  GoalFidelityError,
  type ScenarioTestFixLoopResult,
} from './scenarioTestFixLoop';
export {
  shouldRunScenarioProof,
  runScenarioProof,
  type TagProofResult,
  type ScenarioProofResult,
} from './scenarioProof';
export { executeDepauditSetup, type DepauditSetupResult, type DepauditSetupDeps } from './depauditSetup';
export { acquireOrchestratorLock, releaseOrchestratorLock, runWithOrchestratorLifecycle, runWithRawOrchestratorLifecycle } from './orchestratorLock';
export { reportStackCoherence } from './stackCoherenceReporter';
export { executeProofPublishPhase } from './proofPublishPhase';
export { executePromotionRotAdvisory } from './promotionRotAdvisory';
