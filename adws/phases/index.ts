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

export { ensureGitignoreEntry, ensureGitignoreEntries, copyClaudeCommandsToWorktree } from './worktreeSetup';
export { type WorkflowConfig, initializeWorkflow } from './workflowInit';
export { completeWorkflow, executeReviewPhase, handleWorkflowError } from './workflowCompletion';
export { executePlanPhase, buildContinuationPrompt, MAX_CONTINUATION_OUTPUT_LENGTH } from './planPhase';
export { executeBuildPhase } from './buildPhase';
export { executeTestPhase } from './testPhase';
export { executePRPhase } from './prPhase';
export { executeDocumentPhase } from './documentPhase';
export { executeKpiPhase } from './kpiPhase';
export { executePlanValidationPhase } from './planValidationPhase';
export {
  type PRReviewWorkflowConfig,
  initializePRReviewWorkflow,
  executePRReviewPlanPhase,
  executePRReviewBuildPhase,
} from './prReviewPhase';
export {
  executePRReviewTestPhase,
  completePRReviewWorkflow,
  handlePRReviewWorkflowError,
} from './prReviewCompletion';
export { executeScenarioPhase } from './scenarioPhase';
export { executeStepDefPhase } from './stepDefPhase';
export { executeInstallPhase, extractInstallContext } from './installPhase';
export { executeAutoMergePhase } from './autoMergePhase';
