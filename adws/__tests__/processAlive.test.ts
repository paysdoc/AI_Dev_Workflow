import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentStateManager } from '../core/agentState';

const uniqueTestDir = `/tmp/test-process-alive-${Buffer.from(__dirname).toString('base64').replace(/[/+=]/g, '').slice(0, 16)}`;

vi.mock('../core/config', async () => {
  const dirHash = Buffer.from(__dirname).toString('base64').replace(/[/+=]/g, '').slice(0, 16);
  return {
    AGENTS_STATE_DIR: `/tmp/test-process-alive-${dirHash}`,
  };
});

describe('isProcessAlive', () => {
  it('returns true for the current process PID', () => {
    expect(AgentStateManager.isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for a known-dead PID', () => {
    expect(AgentStateManager.isProcessAlive(999999999)).toBe(false);
  });
});

describe('findOrchestratorStatePath', () => {
  beforeEach(() => {
    if (fs.existsSync(uniqueTestDir)) {
      fs.rmSync(uniqueTestDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(uniqueTestDir)) {
      fs.rmSync(uniqueTestDir, { recursive: true, force: true });
    }
  });

  it('returns the correct path when orchestrator state exists', () => {
    const adwId = 'adw-test-orch-abc';
    const statePath = AgentStateManager.initializeState(adwId, 'plan-build-orchestrator');
    AgentStateManager.writeState(statePath, {
      adwId,
      issueNumber: 1,
      agentName: 'plan-build-orchestrator',
      pid: process.pid,
      execution: AgentStateManager.createExecutionState('running'),
    });

    const result = AgentStateManager.findOrchestratorStatePath(adwId);

    expect(result).toBe(statePath);
  });

  it('returns null when ADW ID directory does not exist', () => {
    const result = AgentStateManager.findOrchestratorStatePath('adw-nonexistent-xyz');

    expect(result).toBeNull();
  });

  it('returns null when no orchestrator state is found', () => {
    const adwId = 'adw-test-no-orch';
    const statePath = AgentStateManager.initializeState(adwId, 'plan-agent');
    AgentStateManager.writeState(statePath, {
      adwId,
      issueNumber: 1,
      agentName: 'plan-agent',
      execution: AgentStateManager.createExecutionState('running'),
    });

    const result = AgentStateManager.findOrchestratorStatePath(adwId);

    expect(result).toBeNull();
  });
});

describe('isAgentProcessRunning', () => {
  beforeEach(() => {
    if (fs.existsSync(uniqueTestDir)) {
      fs.rmSync(uniqueTestDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(uniqueTestDir)) {
      fs.rmSync(uniqueTestDir, { recursive: true, force: true });
    }
  });

  it('returns true when state has a PID matching a running process', () => {
    const adwId = 'adw-test-running';
    const statePath = AgentStateManager.initializeState(adwId, 'plan-build-orchestrator');
    AgentStateManager.writeState(statePath, {
      adwId,
      issueNumber: 1,
      agentName: 'plan-build-orchestrator',
      pid: process.pid,
      execution: AgentStateManager.createExecutionState('running'),
    });

    expect(AgentStateManager.isAgentProcessRunning(adwId)).toBe(true);
  });

  it('returns false when state has a PID for a dead process', () => {
    const adwId = 'adw-test-dead';
    const statePath = AgentStateManager.initializeState(adwId, 'orchestrator');
    AgentStateManager.writeState(statePath, {
      adwId,
      issueNumber: 1,
      agentName: 'orchestrator',
      pid: 999999999,
      execution: AgentStateManager.createExecutionState('running'),
    });

    expect(AgentStateManager.isAgentProcessRunning(adwId)).toBe(false);
  });

  it('returns false when no state exists', () => {
    expect(AgentStateManager.isAgentProcessRunning('adw-nonexistent')).toBe(false);
  });

  it('returns false when state exists but has no PID', () => {
    const adwId = 'adw-test-no-pid';
    const statePath = AgentStateManager.initializeState(adwId, 'orchestrator');
    AgentStateManager.writeState(statePath, {
      adwId,
      issueNumber: 1,
      agentName: 'orchestrator',
      execution: AgentStateManager.createExecutionState('running'),
    });

    expect(AgentStateManager.isAgentProcessRunning(adwId)).toBe(false);
  });
});
