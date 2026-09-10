/**
 * Shared orchestrator utility functions.
 *
 * Extracted from adwPlan.tsx and adwBuild.tsx to eliminate duplication.
 * Used by all orchestrators for stage execution, change detection, and recovery.
 */

import { WorkflowStage, RecoveryState } from '../types/workflowTypes';
import { STAGE_ORDER } from './workflowCommentParsing';
export { deriveOrchestratorScript, orchestratorNamesForScript } from './orchestratorNames';

/**
 * Determines if a stage should be executed based on recovery state.
 * Returns true if this is a fresh run or the stage hasn't been completed yet.
 */
export function shouldExecuteStage(stage: WorkflowStage, recoveryState: RecoveryState): boolean {
  if (!recoveryState.canResume || !recoveryState.lastCompletedStage) {
    return true;
  }

  const stageIndex = STAGE_ORDER.indexOf(stage);
  const lastCompletedIndex = STAGE_ORDER.indexOf(recoveryState.lastCompletedStage);

  return stageIndex > lastCompletedIndex;
}

/**
 * Gets the next stage to resume from based on the last completed stage.
 * Returns 'starting' if the stage is not found or is the last stage.
 */
export function getNextStage(lastCompletedStage: WorkflowStage): WorkflowStage {
  const index = STAGE_ORDER.indexOf(lastCompletedStage);
  if (index === -1 || index >= STAGE_ORDER.length - 1) {
    return 'starting';
  }
  return STAGE_ORDER[index + 1];
}

