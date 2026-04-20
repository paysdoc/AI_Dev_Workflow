/**
 * hungOrchestratorDetector — pure-query module for detecting wedged orchestrators.
 *
 * Scans top-level state files under agents/<adwId>/state.json and returns those
 * whose workflowStage ends in "_running", whose pid+pidStartedAt tuple is live,
 * and whose lastSeenAt is older than the caller-supplied staleness threshold.
 *
 * No kills, no state writes, no logging — all recovery actions are the caller's
 * responsibility. This separation lets the contract test run with an injected
 * clock and fixture state files without any process or filesystem mutation.
 */

import * as fs from 'fs';
import { AgentStateManager } from './agentState';
import { isProcessLive } from './processLiveness';
import { AGENTS_STATE_DIR } from './environment';
import type { AgentState } from '../types/agentTypes';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HungOrchestrator {
  adwId: string;
  pid: number;
  pidStartedAt: string;
  lastSeenAt: string;
  workflowStage: string;
  issueNumber: number | null;
}

export interface HungDetectorDeps {
  listAdwIds: () => string[];
  readTopLevelState: (adwId: string) => AgentState | null;
  isProcessLive: (pid: number, pidStartedAt: string) => boolean;
}

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

function defaultListAdwIds(): string[] {
  try {
    return fs.readdirSync(AGENTS_STATE_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];
  }
}

export const defaultHungDetectorDeps: HungDetectorDeps = {
  listAdwIds: defaultListAdwIds,
  readTopLevelState: AgentStateManager.readTopLevelState.bind(AgentStateManager),
  isProcessLive: (pid: number, pidStartedAt: string) => isProcessLive(pid, pidStartedAt),
};

// ---------------------------------------------------------------------------
// Core query
// ---------------------------------------------------------------------------

/**
 * Returns orchestrators that are wedged: workflowStage ends in "_running",
 * PID is live per isProcessLive(pid, pidStartedAt), and lastSeenAt is strictly
 * older than staleThresholdMs relative to now.
 *
 * Defensively skips any entry missing pid, pidStartedAt, or lastSeenAt, or
 * whose lastSeenAt is unparseable. Never throws.
 */
export function findHungOrchestrators(
  now: number,
  staleThresholdMs: number,
  deps: HungDetectorDeps = defaultHungDetectorDeps,
): HungOrchestrator[] {
  let adwIds: string[];
  try {
    adwIds = deps.listAdwIds();
  } catch {
    return [];
  }

  const results: HungOrchestrator[] = [];

  for (const adwId of adwIds) {
    try {
      const state = deps.readTopLevelState(adwId);
      if (!state) continue;

      const { workflowStage, pid, pidStartedAt, lastSeenAt, issueNumber } = state;

      if (!workflowStage || !workflowStage.endsWith('_running')) continue;
      if (pid === undefined || pid === null) continue;
      if (!pidStartedAt) continue;
      if (!lastSeenAt) continue;

      const lastSeenMs = Date.parse(lastSeenAt);
      if (isNaN(lastSeenMs)) continue;

      const ageMs = now - lastSeenMs;
      if (ageMs <= staleThresholdMs) continue;

      let live: boolean;
      try {
        live = deps.isProcessLive(pid, pidStartedAt);
      } catch {
        continue;
      }
      if (!live) continue;

      results.push({
        adwId,
        pid,
        pidStartedAt,
        lastSeenAt,
        workflowStage,
        issueNumber: issueNumber ?? null,
      });
    } catch {
      // Skip any entry that causes an unexpected error
    }
  }

  return results;
}
