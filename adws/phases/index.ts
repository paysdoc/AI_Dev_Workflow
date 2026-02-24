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

export { type WorkflowConfig, initializeWorkflow, completeWorkflow, executeReviewPhase, handleWorkflowError } from './workflowLifecycle';
export { executePlanPhase, buildContinuationPrompt, MAX_CONTINUATION_OUTPUT_LENGTH } from './planPhase';
export { executeBuildPhase } from './buildPhase';
export { executeTestPhase } from './testPhase';
export { executePRPhase } from './prPhase';
export { executeDocumentPhase } from './documentPhase';
export {
  type PRReviewWorkflowConfig,
  initializePRReviewWorkflow,
  executePRReviewPlanPhase,
  executePRReviewBuildPhase,
  executePRReviewTestPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
} from './prReviewPhase';
