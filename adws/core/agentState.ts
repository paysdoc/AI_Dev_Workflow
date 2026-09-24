/**
 * AgentStateManager - File-based state management for ADW agents.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AGENTS_STATE_DIR } from './config';
import { AgentIdentifier, AgentState, PhaseExecutionState } from '../types/agentTypes';
import {
  createExecutionState as _createExecutionState,
  completeExecution as _completeExecution,
  findOrchestratorStatePath as _findOrchestratorStatePath,
  isAgentProcessRunning as _isAgentProcessRunning,
} from './stateHelpers';
import { getProcessStartTime, isProcessLive } from './processLiveness';

const STATE_FILE = 'state.json';

function atomicWriteJson(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}
const EXECUTION_LOG_FILE = 'execution.log';

function formatLogTimestamp(): string {
  return new Date().toISOString();
}

export class AgentStateManager {
  /**
   * Creates the directory structure: agents/{adwId}/{agentIdentifier}/
   * For nested agents: agents/{adwId}/{parentAgent}/{agentIdentifier}/
   */
  static initializeState(
    adwId: string,
    agentIdentifier: AgentIdentifier,
    parentAgentPath?: string
  ): string {
    let statePath: string;

    if (parentAgentPath) {
      statePath = path.join(parentAgentPath, agentIdentifier);
    } else {
      statePath = path.join(AGENTS_STATE_DIR, adwId, agentIdentifier);
    }

    if (!fs.existsSync(statePath)) {
      fs.mkdirSync(statePath, { recursive: true });
    }

    return statePath;
  }

  /**
   * Merges with existing state if present.
   */
  static writeState(statePath: string, state: Partial<AgentState>): void {
    const stateFile = path.join(statePath, STATE_FILE);
    let existingState: Partial<AgentState> = {};

    try {
      if (fs.existsSync(stateFile)) {
        const content = fs.readFileSync(stateFile, 'utf-8');
        existingState = JSON.parse(content);
      }
    } catch {
      existingState = {};
    }

    // new state takes precedence
    const mergedState = { ...existingState, ...state };

    fs.writeFileSync(stateFile, JSON.stringify(mergedState, null, 2), 'utf-8');
  }

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
   * First entry includes the prompt if provided.
   */
  static appendLog(statePath: string, message: string, prompt?: string): void {
    const logFile = path.join(statePath, EXECUTION_LOG_FILE);
    const timestamp = formatLogTimestamp();
    let logEntry = '';

    const isFirstEntry = !fs.existsSync(logFile) || fs.statSync(logFile).size === 0;

    if (isFirstEntry && prompt) {
      logEntry = `=== Agent Execution Log ===\n`;
      logEntry += `Started: ${timestamp}\n\n`;
      logEntry += `=== Prompt ===\n${prompt}\n\n`;
      logEntry += `=== Execution Log ===\n`;
    }

    logEntry += `[${timestamp}] ${message}\n`;

    fs.appendFileSync(logFile, logEntry, 'utf-8');
  }

  static writeRawOutput(
    statePath: string,
    filename: string,
    data: unknown,
    append: boolean = false
  ): void {
    const outputFile = path.join(statePath, filename);

    if (filename.endsWith('.jsonl')) {
      const line = JSON.stringify(data) + '\n';
      if (append) {
        fs.appendFileSync(outputFile, line, 'utf-8');
      } else {
        fs.writeFileSync(outputFile, line, 'utf-8');
      }
    } else {
      fs.writeFileSync(outputFile, JSON.stringify(data, null, 2), 'utf-8');
    }
  }

  static readParentState(statePath: string): AgentState | null {
    const parentPath = path.dirname(statePath);

    if (!parentPath.startsWith(AGENTS_STATE_DIR) || parentPath === AGENTS_STATE_DIR) {
      return null;
    }

    const parentState = this.readState(parentPath);

    if (parentState) {
      return parentState;
    }

    return this.readParentState(parentPath);
  }

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

  static stateExists(statePath: string): boolean {
    const stateFile = path.join(statePath, STATE_FILE);
    return fs.existsSync(stateFile);
  }

  /**
   * This file is distinct from per-agent state files.
   */
  static getTopLevelStatePath(adwId: string): string {
    return path.join(AGENTS_STATE_DIR, adwId, STATE_FILE);
  }

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
   * Shallow-merges top-level fields; deep-merges the `phases` map so individual phase
   * entries are updated without clobbering sibling phase entries.
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

    if (state.phases !== undefined) {
      const existingPhases = (existing.phases ?? {}) as Record<string, PhaseExecutionState>;
      const newPhases = state.phases as Record<string, PhaseExecutionState>;
      const mergedPhases: Record<string, PhaseExecutionState> = { ...existingPhases };
      for (const [name, entry] of Object.entries(newPhases)) {
        mergedPhases[name] = { ...(existingPhases[name] ?? {} as PhaseExecutionState), ...entry };
      }
      merged.phases = mergedPhases;
    }

    atomicWriteJson(filePath, merged);
  }

  static createExecutionState = _createExecutionState;
  static completeExecution = _completeExecution;
  static findOrchestratorStatePath = _findOrchestratorStatePath;
  static isAgentProcessRunning = _isAgentProcessRunning;
  static getProcessStartTime = getProcessStartTime;
  static isProcessLive = isProcessLive;
}

export const initializeAgentState = AgentStateManager.initializeState;
export const writeAgentState = AgentStateManager.writeState;
export const readAgentState = AgentStateManager.readState;
export const appendAgentLog = AgentStateManager.appendLog;
export const writeAgentRawOutput = AgentStateManager.writeRawOutput;
export const readParentAgentState = AgentStateManager.readParentState;
export { findOrchestratorStatePath, isAgentProcessRunning } from './stateHelpers';
export { getProcessStartTime, isProcessLive } from './processLiveness';
