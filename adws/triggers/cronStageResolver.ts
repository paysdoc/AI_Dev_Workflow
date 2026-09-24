/**
 * Extracted from trigger_cron.ts so the logic is testable without
 * triggering the cron's module-level side effects (setInterval, process guard).
 */

import { AgentStateManager } from '../core/agentState';
import { extractLatestAdwId } from '../core/workflowCommentParsing';

export { extractLatestAdwId } from '../core/workflowCommentParsing';
import { classifyStageString } from '../core/stageClassifier';
import type { AgentState } from '../types/agentTypes';

export interface StageResolution {
  /** workflowStage from the state file, or null if no adw-id / no state file / no stage field. */
  stage: string | null;
  /** adw-id extracted from issue comments, or null if no ADW comments found. */
  adwId: string | null;
  /** Most recent phase activity timestamp (ms), or null if state has no phases. */
  lastActivityMs: number | null;
}


/**
 * Considers both startedAt and completedAt for each phase.
 * Returns null if the state has no phases or no valid timestamps.
 */
export function getLastActivityFromState(state: AgentState): number | null {
  const phases = state.phases;
  if (!phases || Object.keys(phases).length === 0) return null;

  let latest = 0;
  for (const phase of Object.values(phases)) {
    if (phase.startedAt) {
      const t = Date.parse(phase.startedAt);
      if (!isNaN(t) && t > latest) latest = t;
    }
    if (phase.completedAt) {
      const t = Date.parse(phase.completedAt);
      if (!isNaN(t) && t > latest) latest = t;
    }
  }
  return latest > 0 ? latest : null;
}

/**
 * Compatibility predicate for devServerJanitor + webhookHandlers.
 *
 * Preserves the historical "in progress" set {starting, *_running, *_completed}
 * (but NOT 'resuming', NOT the terminal 'completed'). Backed by classifyStageString
 * so the endsWith family matching lives in one place.
 *
 * The set differs from the takeover 'active' class intentionally:
 *   - 'resuming' is active to takeover but excluded here (historical janitor/webhook semantics)
 *   - '*_completed' is resumable to takeover but included here (phaseRunner writes
 *     ${phase}_completed between phases; dropping it would let shouldCleanWorktree
 *     kill a live orchestrator)
 */
export function isActiveStage(stage: string): boolean {
  const cls = classifyStageString(stage);
  if (cls === 'active') return stage !== 'resuming';
  if (cls === 'resumable') return stage.endsWith('_completed');
  return false;
}

/** @param readState - Injectable state reader (defaults to AgentStateManager.readTopLevelState) */
export function resolveIssueWorkflowStage(
  comments: { body: string }[],
  readState: (adwId: string) => AgentState | null = AgentStateManager.readTopLevelState,
): StageResolution {
  const adwId = extractLatestAdwId(comments);
  if (adwId === null) {
    return { stage: null, adwId: null, lastActivityMs: null };
  }

  const state = readState(adwId);
  if (state === null) {
    return { stage: null, adwId, lastActivityMs: null };
  }

  const stage = state.workflowStage ?? null;
  const lastActivityMs = getLastActivityFromState(state);

  return { stage, adwId, lastActivityMs };
}
