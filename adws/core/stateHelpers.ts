/**
 * State Helper Functions
 *
 * Standalone functions extracted from AgentStateManager:
 * - findOrchestratorStatePath
 * - isAgentProcessRunning
 * - isProcessAlive
 * - createExecutionState
 * - completeExecution
 */

import * as fs from 'fs';
import * as path from 'path';
import { AGENTS_STATE_DIR } from './config';
import { AgentExecutionState } from '../types/dataTypes';

/**
 * Checks if a process with the given PID is alive.
 * Uses `process.kill(pid, 0)` which checks existence without sending a signal.
 *
 * @param pid - The process ID to check
 * @returns True if the process is alive
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates an initial execution state.
 *
 * @param status - The initial status (defaults to 'running')
 * @returns A new AgentExecutionState object
 */
export function createExecutionState(status: AgentExecutionState['status'] = 'running'): AgentExecutionState {
  return {
    status,
    startedAt: new Date().toISOString(),
  };
}

/**
 * Updates execution state to mark completion.
 *
 * @param execution - The existing execution state
 * @param success - Whether the execution was successful
 * @param errorMessage - Optional error message if failed
 * @returns Updated execution state
 */
export function completeExecution(
  execution: AgentExecutionState,
  success: boolean,
  errorMessage?: string
): AgentExecutionState {
  return {
    ...execution,
    status: success ? 'completed' : 'failed',
    completedAt: new Date().toISOString(),
    errorMessage: success ? undefined : errorMessage,
  };
}

/**
 * Reads agent state from a state.json file at the given path.
 * This is a minimal read used internally by findOrchestratorStatePath
 * and isAgentProcessRunning to avoid circular dependencies.
 */
function readStateFile(statePath: string): Record<string, unknown> | null {
  const stateFile = path.join(statePath, 'state.json');

  try {
    if (!fs.existsSync(stateFile)) {
      return null;
    }
    const content = fs.readFileSync(stateFile, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Finds the orchestrator state path for a given ADW ID.
 * Scans `agents/{adwId}/` for a subdirectory whose state.json
 * contains an agent name ending in `-orchestrator`.
 *
 * @param adwId - The ADW session identifier
 * @returns The orchestrator state directory path, or null if not found
 */
export function findOrchestratorStatePath(adwId: string): string | null {
  const adwDir = path.join(AGENTS_STATE_DIR, adwId);

  if (!fs.existsSync(adwDir)) return null;

  try {
    const entries = fs.readdirSync(adwDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const statePath = path.join(adwDir, entry.name);
      const state = readStateFile(statePath);

      if (state?.agentName && String(state.agentName).endsWith('-orchestrator')) {
        return statePath;
      }
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Checks if the agent process for a given ADW ID is still running.
 * Locates the orchestrator state, reads the PID, and checks OS liveness.
 *
 * @param adwId - The ADW session identifier
 * @returns True if the agent process is alive, false otherwise
 */
export function isAgentProcessRunning(adwId: string): boolean {
  const statePath = findOrchestratorStatePath(adwId);
  if (!statePath) return false;

  const state = readStateFile(statePath);
  if (!state?.pid) return false;

  return isProcessAlive(state.pid as number);
}
