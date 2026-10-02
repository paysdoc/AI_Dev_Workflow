import { AgentStateManager } from '../core/agentState';
import type { AgentIdentifier } from '../types/agentTypes';

/**
 * A detached orchestrator has no stderr of its own (the trigger discards it or interleaves it into
 * its own log), so the orchestrator's execution log is the only place a startup failure stays with
 * its run. Never throws: the caller rethrows the original error.
 */
export function recordStartupFailure(adwId: string, orchestratorName: AgentIdentifier, error: unknown): void {
  try {
    const statePath = AgentStateManager.initializeState(adwId, orchestratorName);
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    AgentStateManager.appendLog(statePath, `${orchestratorName} startup failed: ${detail}`);
  } catch {
    // A failed write must never replace the startup error the caller is about to rethrow.
  }
}
