import { log, AgentStateManager, shouldExecuteStage, type RecoveryState } from '../core';
import { getPlanFilePath } from '../agents';
import { ParkReason, type PlanReadingPhase } from '../forge/parkComment';
import { parkWorkflow } from './workflowPark';
import type { WorkflowConfig } from './workflowInit';

export type LostPlanGateConfig = Pick<
  WorkflowConfig,
  'adwId' | 'issueNumber' | 'orchestratorStatePath' | 'repoContext' | 'worktreePath' | 'recoveryState'
>;

// The recovery state is read once, at init, from the issue's comments, so it reflects earlier runs only and never this run's planner.
export function planCreatedByEarlierRun(recoveryState: RecoveryState): boolean {
  return recoveryState.canResume && !shouldExecuteStage('plan_created', recoveryState);
}

/**
 * Called only by a phase that has already found no plan. A run that has not planned yet, a fresh run among them, returns,
 * and the caller plans or fails as it always has. A run resumed after an earlier run created the plan parks the workflow
 * as `worktree_lost`, which does not return: the plan lived only in a worktree that is gone, and the planner never runs
 * again on its own.
 */
export function parkIfPlanLost(config: LostPlanGateConfig, phase: PlanReadingPhase): void {
  if (!planCreatedByEarlierRun(config.recoveryState)) return;

  // getPlanFilePath falls back to the legacy name when the worktree holds no plan, so the earlier run's own path is preferred.
  const planPath = config.recoveryState.planPath ?? getPlanFilePath(config.issueNumber, config.worktreePath);
  const message = `The ${phase} phase found no plan at ${planPath} in the worktree ${config.worktreePath}, although an earlier run created it`;
  log(message, 'warn');
  AgentStateManager.appendLog(config.orchestratorStatePath, message);

  parkWorkflow(config, { reason: ParkReason.WorktreeLost, phase, worktreePath: config.worktreePath, planPath });
}
