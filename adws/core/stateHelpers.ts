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
import { AgentExecutionState } from '../types/agentTypes';
import { isProcessLive } from './processLiveness';
import { orchestratorNamesForScript } from './orchestratorLib';

/**
 * @deprecated Use `isProcessLive` from `adws/core/processLiveness`. Kept for
 * out-of-scope call sites pending migration in subsequent issues.
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
 * Returns the candidate state path owned by the top-level state's
 * orchestratorScript, or null when there is no such field or no match.
 */
function preferByTopLevelScript(
  adwDir: string,
  candidates: ReadonlyArray<{ statePath: string; agentName: string }>,
): string | null {
  // readStateFile(adwDir) reads agents/{adwId}/state.json — the top-level state.
  const orchestratorScript = readStateFile(adwDir)?.orchestratorScript;
  if (typeof orchestratorScript !== 'string' || orchestratorScript.length === 0) {
    return null;
  }
  const expectedNames = new Set(orchestratorNamesForScript(orchestratorScript));
  if (expectedNames.size === 0) return null;

  const match = candidates.find((c) => expectedNames.has(c.agentName));
  return match?.statePath ?? null;
}

/**
 * Finds the orchestrator state path for a given ADW ID.
 * Scans `agents/{adwId}/` for a subdirectory whose state.json
 * contains an agent name ending in `-orchestrator`. When multiple
 * orchestrator directories exist (e.g. a failed init-orchestrator and
 * the real sdlc-orchestrator), prefers the one matching the top-level
 * state's orchestratorScript. (#529)
 *
 * @param adwId - The ADW session identifier
 * @returns The orchestrator state directory path, or null if not found
 */
export function findOrchestratorStatePath(adwId: string): string | null {
  const adwDir = path.join(AGENTS_STATE_DIR, adwId);
  if (!fs.existsSync(adwDir)) return null;

  try {
    const candidates = fs.readdirSync(adwDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const statePath = path.join(adwDir, entry.name);
        const agentName = String(readStateFile(statePath)?.agentName ?? '');
        return { statePath, agentName };
      })
      .filter((c) => c.agentName.endsWith('-orchestrator'));

    if (candidates.length === 0) return null;

    // Disambiguate a reused adwId (e.g. a failed init-orchestrator shadowing the
    // real run): prefer the dir owned by the script recorded in top-level state.
    // Fall back to the first candidate when there is no orchestratorScript or no
    // candidate matches it. (#529)
    const preferred = preferByTopLevelScript(adwDir, candidates);
    return preferred ?? candidates[0].statePath;
  } catch {
    return null;
  }
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
  if (!state?.pid || !state?.pidStartedAt) return false;

  return isProcessLive(state.pid as number, state.pidStartedAt as string);
}
