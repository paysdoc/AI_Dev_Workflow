/**
 * Cron stage resolution from the top-level state file.
 *
 * Extracted from trigger_cron.ts so the logic is testable without
 * triggering the cron's module-level side effects (setInterval, process guard).
 *
 * Replaces comment-header parsing with direct state file reads:
 * - adw-id is extracted from issue comments via regex
 * - workflowStage is read from agents/<adwId>/state.json
 * - Issues with no adw-id or no state file are treated as fresh candidates
 */

import { extractAdwIdFromComment } from '../core/workflowCommentParsing';
import { AgentStateManager } from '../core/agentState';
import { classifyStageString } from '../core/stageClassifier';
import type { AgentState } from '../types/agentTypes';

/** Resolved workflow stage for a single issue. */
export interface StageResolution {
  /** workflowStage from the state file, or null if no adw-id / no state file / no stage field. */
  stage: string | null;
  /** adw-id extracted from issue comments, or null if no ADW comments found. */
  adwId: string | null;
  /** Most recent phase activity timestamp (ms), or null if state has no phases. */
  lastActivityMs: number | null;
}

/**
 * Scans issue comments newest-to-oldest and returns the first adw-id found.
 * Returns null if no ADW comment with an adw-id exists.
 */
export function extractLatestAdwId(comments: { body: string }[]): string | null {
  for (let i = comments.length - 1; i >= 0; i--) {
    const id = extractAdwIdFromComment(comments[i].body);
    if (id !== null) return id;
  }
  return null;
}

/**
 * Computes the most recent activity timestamp (ms) across all phases in a state file.
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

/**
 * Resolves the workflow stage for an issue by reading from the top-level state file.
 *
 * 1. Extracts the adw-id from comments (newest-to-oldest)
 * 2. Reads workflowStage and phases from agents/<adwId>/state.json
 * 3. Returns a StageResolution with stage, adwId, and lastActivityMs
 *
 * @param comments  - Issue comment objects with a body string
 * @param readState - Injectable state reader (defaults to AgentStateManager.readTopLevelState)
 */
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
