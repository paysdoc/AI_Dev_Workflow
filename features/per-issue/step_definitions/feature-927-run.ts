/**
 * Drives an orchestrator's exported entry point with the scripted phases, observing it from outside:
 * the stages it writes to the top-level state and the exit its error path would take. Both
 * observers are installed for the duration of the run only.
 */

import { executeChore } from '../../../adws/adwChore.tsx';
import { executePlanBuildReview } from '../../../adws/adwPlanBuildReview.tsx';
import { executePlanBuildTestReview } from '../../../adws/adwPlanBuildTestReview.tsx';
import { AgentStateManager } from '../../../adws/core/agentState.ts';
import type { WorkflowConfig } from '../../../adws/phases/workflowInit.ts';
import { buildFakePhases, type AllPhases } from './feature-927-phases.ts';
import { restoreRecorders, toOrchestratorName, world, type OrchestratorName } from './feature-927-world.ts';

const ENTRY_POINTS: Readonly<Record<OrchestratorName, (config: WorkflowConfig, phases: AllPhases) => Promise<void>>> = {
  adwChore: executeChore,
  adwPlanBuildReview: executePlanBuildReview,
  adwPlanBuildTestReview: executePlanBuildTestReview,
};

function recordStageHistory(adwId: string): () => void {
  const original = AgentStateManager.writeTopLevelState;
  AgentStateManager.writeTopLevelState = (id, state) => {
    if (id === adwId && state.workflowStage !== undefined) world.stageHistory.push(state.workflowStage);
    original.call(AgentStateManager, id, state);
  };
  return () => { AgentStateManager.writeTopLevelState = original; };
}

// Throwing stops the code after the exit, as the real exit would, without ending the test process.
function trapProcessExit(exitCodes: number[]): () => void {
  const original = process.exit;
  process.exit = ((code?: number | string | null) => {
    exitCodes.push(Number(code ?? 0));
    throw new Error(`process.exit(${code ?? 0}) was called`);
  }) as typeof process.exit;
  return () => { process.exit = original; };
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

export async function runOrchestrator(orchestratorText: string): Promise<void> {
  const orchestrator = toOrchestratorName(orchestratorText);
  const { workflow } = world;
  if (!workflow || workflow.orchestrator !== orchestrator) {
    throw new Error(`Expected an "${orchestrator}" workflow to have started before it runs`);
  }
  const { config } = workflow;
  const exitCodes: number[] = [];

  world.restorers.push(recordStageHistory(config.adwId), trapProcessExit(exitCodes));
  try {
    await ENTRY_POINTS[orchestrator](config, buildFakePhases());
    world.run = { orchestrator, resolved: true, failure: '', exitCodes };
  } catch (error) {
    world.run = { orchestrator, resolved: false, failure: describeFailure(error), exitCodes };
  } finally {
    restoreRecorders();
  }
}
