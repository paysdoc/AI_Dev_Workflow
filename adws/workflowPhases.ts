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
  copyTargetSkillsAndCommands,
  executePlanPhase,
  buildContinuationPrompt,
  MAX_CONTINUATION_OUTPUT_LENGTH,
  executePlanValidationPhase,
  executeBuildPhase,
  executeTestPhase,
  executePRPhase,
  executeDocumentPhase,
  executeKpiPhase,
  executeScenarioPhase,
  executeStepDefPhase,
  executeInstallPhase,
  executeReviewPhase,
  executeAutoMergePhase,
  completeWorkflow,
  handleWorkflowError,
  initializePRReviewWorkflow,
  executePRReviewPlanPhase,
  executePRReviewBuildPhase,
  executePRReviewTestPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
} from './phases';
