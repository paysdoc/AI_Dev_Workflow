/**
 * AgentStateManager - File-based state management for ADW agents.
 *
 * Provides methods to:
 * - Initialize state directories for agents
 * - Write and read structured state (state.json)
 * - Append to execution logs (execution.log)
 * - Write raw output files (JSON/JSONL)
 * - Read parent agent state for shared context
 */

import * as fs from 'fs';
import * as path from 'path';
import { AGENTS_STATE_DIR } from './config';
import { AgentIdentifier, AgentState, PhaseExecutionState } from '../types/agentTypes';
import {
  isProcessAlive as _isProcessAlive,
  createExecutionState as _createExecutionState,
  completeExecution as _completeExecution,
  findOrchestratorStatePath as _findOrchestratorStatePath,
  isAgentProcessRunning as _isAgentProcessRunning,
} from './stateHelpers';

/**
 * State file names used by the state manager.
 */
const STATE_FILE = 'state.json';
const EXECUTION_LOG_FILE = 'execution.log';

/**
 * Formats a timestamp for log entries.
 */
function formatLogTimestamp(): string {
  return new Date().toISOString();
}

/**
 * AgentStateManager handles all file-based state operations for ADW agents.
 */
export class AgentStateManager {
  /**
   * Initializes the state directory for an agent.
   * Creates the directory structure: agents/{adwId}/{agentIdentifier}/
   * For nested agents: agents/{adwId}/{parentAgent}/{agentIdentifier}/
   *
   * @param adwId - The ADW session identifier
   * @param agentIdentifier - The agent's identifier
   * @param parentAgentPath - Optional parent agent's state path for nested agents
   * @returns The full path to the agent's state directory
   */
  static initializeState(
    adwId: string,
    agentIdentifier: AgentIdentifier,
    parentAgentPath?: string
  ): string {
    let statePath: string;

    if (parentAgentPath) {
      // Nested agent: create directory under parent
      statePath = path.join(parentAgentPath, agentIdentifier);
    } else {
      // Top-level agent: create under agents/{adwId}/
      statePath = path.join(AGENTS_STATE_DIR, adwId, agentIdentifier);
    }

    // Create directory if it doesn't exist
    if (!fs.existsSync(statePath)) {
      fs.mkdirSync(statePath, { recursive: true });
    }

    return statePath;
  }

  /**
   * Writes agent state to state.json.
   * Merges with existing state if present.
   *
   * @param statePath - The agent's state directory path
   * @param state - The state object to write
   */
  static writeState(statePath: string, state: Partial<AgentState>): void {
    const stateFile = path.join(statePath, STATE_FILE);
    let existingState: Partial<AgentState> = {};

    // Read existing state if present
    try {
      if (fs.existsSync(stateFile)) {
        const content = fs.readFileSync(stateFile, 'utf-8');
        existingState = JSON.parse(content);
      }
    } catch {
      // If reading/parsing fails, start with empty state
      existingState = {};
    }

    // Merge states - new state takes precedence
    const mergedState = { ...existingState, ...state };

    // Write merged state
    fs.writeFileSync(stateFile, JSON.stringify(mergedState, null, 2), 'utf-8');
  }

  /**
   * Reads agent state from state.json.
   *
   * @param statePath - The agent's state directory path
   * @returns The parsed state object, or null if not found
   */
  static readState(statePath: string): AgentState | null {
    const stateFile = path.join(statePath, STATE_FILE);

    try {
      if (!fs.existsSync(stateFile)) {
        return null;
      }
      const content = fs.readFileSync(stateFile, 'utf-8');
      return JSON.parse(content) as AgentState;
    } catch {
      return null;
    }
  }

  /**
   * Appends a message to the execution log.
   * First entry includes the prompt if provided.
   *
   * @param statePath - The agent's state directory path
   * @param message - The log message to append
   * @param prompt - Optional prompt to include (for first entry)
   */
  static appendLog(statePath: string, message: string, prompt?: string): void {
    const logFile = path.join(statePath, EXECUTION_LOG_FILE);
    const timestamp = formatLogTimestamp();
    let logEntry = '';

    // Check if this is the first entry
    const isFirstEntry = !fs.existsSync(logFile) || fs.statSync(logFile).size === 0;

    if (isFirstEntry && prompt) {
      // Include prompt in first entry
      logEntry = `=== Agent Execution Log ===\n`;
      logEntry += `Started: ${timestamp}\n\n`;
      logEntry += `=== Prompt ===\n${prompt}\n\n`;
      logEntry += `=== Execution Log ===\n`;
    }

    logEntry += `[${timestamp}] ${message}\n`;

    fs.appendFileSync(logFile, logEntry, 'utf-8');
  }

  /**
   * Writes raw output data to a file.
   * Supports JSON and JSONL formats.
   *
   * @param statePath - The agent's state directory path
   * @param filename - The output filename (e.g., 'output.jsonl')
   * @param data - The data to write (will be JSON-serialized)
   * @param append - Whether to append (for JSONL) or overwrite
   */
  static writeRawOutput(
    statePath: string,
    filename: string,
    data: unknown,
    append: boolean = false
  ): void {
    const outputFile = path.join(statePath, filename);

    if (filename.endsWith('.jsonl')) {
      // JSONL format: one JSON object per line
      const line = JSON.stringify(data) + '\n';
      if (append) {
        fs.appendFileSync(outputFile, line, 'utf-8');
      } else {
        fs.writeFileSync(outputFile, line, 'utf-8');
      }
    } else {
      // Regular JSON format
      fs.writeFileSync(outputFile, JSON.stringify(data, null, 2), 'utf-8');
    }
  }

  /**
   * Reads parent agent state by traversing up the directory tree.
   *
   * @param statePath - The current agent's state directory path
   * @returns The parent agent's state, or null if not found
   */
  static readParentState(statePath: string): AgentState | null {
    // Get parent directory
    const parentPath = path.dirname(statePath);

    // Check if we've reached the agents directory (no more parents)
    if (!parentPath.startsWith(AGENTS_STATE_DIR) || parentPath === AGENTS_STATE_DIR) {
      return null;
    }

    // Try to read state from parent
    const parentState = this.readState(parentPath);

    if (parentState) {
      return parentState;
    }

    // If no state in immediate parent, try grandparent
    return this.readParentState(parentPath);
  }

  /**
   * Gets the state directory path without creating it.
   * Useful for reading state.
   *
   * @param adwId - The ADW session identifier
   * @param agentIdentifier - The agent's identifier
   * @param parentAgentPath - Optional parent agent's state path for nested agents
   * @returns The full path to the agent's state directory
   */
  static getStatePath(
    adwId: string,
    agentIdentifier: AgentIdentifier,
    parentAgentPath?: string
  ): string {
    if (parentAgentPath) {
      return path.join(parentAgentPath, agentIdentifier);
    }
    return path.join(AGENTS_STATE_DIR, adwId, agentIdentifier);
  }

  /**
   * Checks if state exists for an agent.
   *
   * @param statePath - The agent's state directory path
   * @returns True if state.json exists
   */
  static stateExists(statePath: string): boolean {
    const stateFile = path.join(statePath, STATE_FILE);
    return fs.existsSync(stateFile);
  }

  /**
   * Returns the path to the top-level workflow state file.
   * This file is distinct from per-agent state files.
   *
   * @param adwId - The ADW session identifier
   * @returns Path to agents/{adwId}/state.json
   */
  static getTopLevelStatePath(adwId: string): string {
    return path.join(AGENTS_STATE_DIR, adwId, STATE_FILE);
  }

  /**
   * Reads the top-level workflow state file.
   *
   * @param adwId - The ADW session identifier
   * @returns The parsed state, or null if not found or unreadable
   */
  static readTopLevelState(adwId: string): AgentState | null {
    const filePath = AgentStateManager.getTopLevelStatePath(adwId);
    try {
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as AgentState;
    } catch {
      return null;
    }
  }

  /**
   * Writes (merges) state into the top-level workflow state file at agents/{adwId}/state.json.
   * Shallow-merges top-level fields; deep-merges the `phases` map so individual phase
   * entries are updated without clobbering sibling phase entries.
   *
   * @param adwId - The ADW session identifier
   * @param state - Partial state to merge in
   */
  static writeTopLevelState(adwId: string, state: Partial<AgentState>): void {
    const filePath = AgentStateManager.getTopLevelStatePath(adwId);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let existing: Partial<AgentState> = {};
    try {
      if (fs.existsSync(filePath)) {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch {
      existing = {};
    }

    const merged: Partial<AgentState> = { ...existing, ...state };

    // Deep-merge phases: preserve existing phase entries, update individual entries
    if (state.phases !== undefined) {
      const existingPhases = (existing.phases ?? {}) as Record<string, PhaseExecutionState>;
      const newPhases = state.phases as Record<string, PhaseExecutionState>;
      const mergedPhases: Record<string, PhaseExecutionState> = { ...existingPhases };
      for (const [name, entry] of Object.entries(newPhases)) {
        mergedPhases[name] = { ...(existingPhases[name] ?? {} as PhaseExecutionState), ...entry };
      }
      merged.phases = mergedPhases;
    }

    fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
  }

  // Delegate to standalone functions from stateHelpers.ts
  static isProcessAlive = _isProcessAlive;
  static createExecutionState = _createExecutionState;
  static completeExecution = _completeExecution;
  static findOrchestratorStatePath = _findOrchestratorStatePath;
  static isAgentProcessRunning = _isAgentProcessRunning;
}

// Export utility functions for convenience
export const initializeAgentState = AgentStateManager.initializeState;
export const writeAgentState = AgentStateManager.writeState;
export const readAgentState = AgentStateManager.readState;
export const appendAgentLog = AgentStateManager.appendLog;
export const writeAgentRawOutput = AgentStateManager.writeRawOutput;
export const readParentAgentState = AgentStateManager.readParentState;
export { isProcessAlive, findOrchestratorStatePath, isAgentProcessRunning } from './stateHelpers';
