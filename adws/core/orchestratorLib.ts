/**
 * Shared orchestrator utility functions.
 *
 * Extracted from adwPlan.tsx and adwBuild.tsx to eliminate duplication.
 * Used by all orchestrators for stage execution, change detection, and recovery.
 */

import { execSync } from 'child_process';
import { WorkflowStage, RecoveryState } from '../types/dataTypes';
import { STAGE_ORDER } from '../github/workflowCommentsBase';

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
 * Checks if there are uncommitted changes in the working directory.
 *
 * @param cwd - Optional working directory to check (defaults to process.cwd())
 */
export function hasUncommittedChanges(cwd?: string): boolean {
  try {
    const options: { encoding: BufferEncoding; cwd?: string } = { encoding: 'utf-8' };
    if (cwd) {
      options.cwd = cwd;
    }
    const status = execSync('git status --porcelain', options);
    return status.trim().length > 0;
  } catch {
    return false;
  }
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
