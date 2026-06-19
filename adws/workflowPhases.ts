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

export {
  type WorkflowConfig,
  type PRReviewWorkflowConfig,
  initializeWorkflow,
  executePlanPhase,
  buildContinuationPrompt,
  MAX_CONTINUATION_OUTPUT_LENGTH,
  executePlanValidationPhase,
  executeAlignmentPhase,
  executeBuildPhase,
  executeUnitTestPhase,
  executePRPhase,
  executeDocumentPhase,
  executeScenarioPhase,
  executeStepDefPhase,
  executeInstallPhase,
  executeReviewPhase,
  executeReviewPatchCycle,
  type ReviewIssue,
  executeAutoMergePhase,
  executeDiffEvaluationPhase,
  type DiffEvaluationPhaseResult,
  executeScenarioTestPhase,
  executeScenarioFixPhase,
  runScenarioTestFixLoop,
  ScenarioHermeticityError,
  GoalFidelityError,
  completeWorkflow,
  handleWorkflowError,
  handleRateLimitPause,
  initializePRReviewWorkflow,
  executePRReviewPlanPhase,
  executePRReviewBuildPhase,
  executePRReviewCommitPushPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
} from './phases';
export { executeDepauditSetup, type DepauditSetupResult, type DepauditSetupDeps } from './phases/depauditSetup';
export { executeProofPublishPhase } from './phases/proofPublishPhase';
