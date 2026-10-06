/**
 * `## Continue` waives the baseline only where ADR-0060 gives it that meaning:
 *
 * | State                                                                             | Action                                                            |
 * |-----------------------------------------------------------------------------------|-------------------------------------------------------------------|
 * | human_gated, parkReason baseline_red / base_server_down / pre_existing_regression | write phase_timeout, reset resumeAttempts to 0, record the waiver |
 * | any other park or stage                                                           | nothing; the caller keeps its existing behaviour                  |
 *
 * The re-arm is `## Retry`'s for human_gated, so the takeover resumes the same adwId in place and
 * the resumed run finds the waiver in its top-level state.
 */

import { log } from '../core/logger';
import { AgentStateManager } from '../core/agentState';
import { BaselineStatus } from '../core/baselineGate';
import { ParkReason } from '../forge/parkComment';
import { extractLatestAdwId } from './cronStageResolver';
import type { AgentState } from '../types/agentTypes';

export const WAIVABLE_PARK_REASONS: ReadonlySet<string> = new Set<string>([
  ParkReason.BaselineRed,
  ParkReason.BaseServerDown,
  ParkReason.PreExistingRegression,
]);

export type ContinueAction =
  | { readonly kind: 'waive_baseline'; readonly park: string }
  | { readonly kind: 'not_a_baseline_park' };

/** Total and pure: no I/O, no logging. */
export function decideContinueAction(state: Pick<AgentState, 'workflowStage' | 'parkReason'> | null): ContinueAction {
  if (state?.workflowStage !== 'human_gated') return { kind: 'not_a_baseline_park' };
  const park = state.parkReason;
  if (park === undefined || !WAIVABLE_PARK_REASONS.has(park)) return { kind: 'not_a_baseline_park' };
  return { kind: 'waive_baseline', park };
}

export interface ContinueHandlerDeps {
  readonly readTopLevelState: (adwId: string) => AgentState | null;
  readonly writeTopLevelState: (adwId: string, state: Partial<AgentState>) => void;
  readonly now: () => Date;
}

export function buildContinueHandlerDeps(): ContinueHandlerDeps {
  return {
    readTopLevelState: (id) => AgentStateManager.readTopLevelState(id),
    writeTopLevelState: (id, state) => AgentStateManager.writeTopLevelState(id, state),
    now: () => new Date(),
  };
}

function logNotABaselinePark(issueNumber: number, adwId: string, state: AgentState): void {
  if (state.workflowStage !== 'human_gated') return;
  log(`Continue #${issueNumber}: adwId=${adwId} is human_gated for ${state.parkReason ?? 'no recorded reason'}, which is not a base-branch park; no waiver recorded`, 'info');
}

/**
 * Returns true only when a waiver was recorded. A decline is silent unless the workflow is parked at
 * human_gated: the cron reads the same latest comment every cycle, and most `## Continue` comments start a fresh run.
 */
export function handleContinueDirective(
  issueNumber: number,
  comments: readonly { body: string }[],
  deps: ContinueHandlerDeps,
): boolean {
  const adwId = extractLatestAdwId([...comments]);
  if (!adwId) return false;

  const state = deps.readTopLevelState(adwId);
  if (!state) return false;

  const action = decideContinueAction(state);
  if (action.kind === 'not_a_baseline_park') {
    logNotABaselinePark(issueNumber, adwId, state);
    return false;
  }

  if (state.issueNumber !== issueNumber) {
    log(`Continue #${issueNumber}: top-level state for adwId=${adwId} belongs to issue #${state.issueNumber ?? 'none'} not #${issueNumber}; no waiver recorded`, 'warn');
    return false;
  }

  deps.writeTopLevelState(adwId, {
    workflowStage: 'phase_timeout',
    resumeAttempts: 0,
    baseline: { status: BaselineStatus.Waived, waivedPark: action.park, recordedAt: deps.now().toISOString() },
  });
  log(`Continue #${issueNumber}: waived the baseline for adwId=${adwId} (${action.park}), re-armed human_gated → phase_timeout, cleared resume counter`, 'success');
  return true;
}
