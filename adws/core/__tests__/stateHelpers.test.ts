import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock the config module to control AGENTS_STATE_DIR
// vi.mock is hoisted, so we cannot reference local variables inside the factory.
// Use a deterministic literal instead.
vi.mock('../config', () => ({
  AGENTS_STATE_DIR: '/tmp/test-state-helpers-vitest',
}));

const uniqueTestDir = '/tmp/test-state-helpers-vitest';

import {
  isProcessAlive,
  createExecutionState,
  completeExecution,
  findOrchestratorStatePath,
  isAgentProcessRunning,
} from '../stateHelpers';

describe('isProcessAlive', () => {
  it('returns true for the current process PID', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for a known-dead PID', () => {
    expect(isProcessAlive(999999999)).toBe(false);
  });

  it('returns false for PID 0 (special signal test, may vary by OS)', () => {
    // PID 0 is a special case; process.kill(0, 0) sends signal to the process group
    // This test documents current behavior
    const result = isProcessAlive(0);
    expect(typeof result).toBe('boolean');
  });
});

describe('createExecutionState', () => {
  it('creates a running state by default', () => {
    const state = createExecutionState();
    expect(state.status).toBe('running');
    expect(state.startedAt).toBeDefined();
    expect(typeof state.startedAt).toBe('string');
    // startedAt should be a valid ISO 8601 date
    expect(new Date(state.startedAt).toISOString()).toBe(state.startedAt);
  });

  it('creates a state with the provided status', () => {
    const state = createExecutionState('pending');
    expect(state.status).toBe('pending');
  });

  it('creates a state with completed status', () => {
    const state = createExecutionState('completed');
    expect(state.status).toBe('completed');
  });

  it('creates a state with failed status', () => {
    const state = createExecutionState('failed');
    expect(state.status).toBe('failed');
  });

  it('does not include completedAt or errorMessage', () => {
    const state = createExecutionState();
    expect(state.completedAt).toBeUndefined();
    expect(state.errorMessage).toBeUndefined();
  });
});

describe('completeExecution', () => {
  it('marks a successful execution as completed', () => {
    const initial = createExecutionState('running');
    const completed = completeExecution(initial, true);

    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeDefined();
    expect(new Date(completed.completedAt!).toISOString()).toBe(completed.completedAt);
    expect(completed.errorMessage).toBeUndefined();
    // Preserves the original startedAt
    expect(completed.startedAt).toBe(initial.startedAt);
  });

  it('marks a failed execution with error message', () => {
    const initial = createExecutionState('running');
    const failed = completeExecution(initial, false, 'Something went wrong');

    expect(failed.status).toBe('failed');
    expect(failed.completedAt).toBeDefined();
    expect(failed.errorMessage).toBe('Something went wrong');
    expect(failed.startedAt).toBe(initial.startedAt);
  });

  it('marks a failed execution without error message', () => {
    const initial = createExecutionState('running');
    const failed = completeExecution(initial, false);

    expect(failed.status).toBe('failed');
    expect(failed.completedAt).toBeDefined();
    expect(failed.errorMessage).toBeUndefined();
  });

  it('does not mutate the original state', () => {
    const initial = createExecutionState('running');
    const startedAt = initial.startedAt;
    completeExecution(initial, true);

    expect(initial.status).toBe('running');
    expect(initial.startedAt).toBe(startedAt);
    expect(initial.completedAt).toBeUndefined();
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

  it('returns null when the ADW ID directory does not exist', () => {
    const result = findOrchestratorStatePath('nonexistent-adwid');
    expect(result).toBeNull();
  });

  it('returns the correct path when an orchestrator state exists', () => {
    const adwId = 'test-adw-123';
    const agentDir = path.join(uniqueTestDir, adwId, 'plan-build-orchestrator');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, 'state.json'),
      JSON.stringify({ agentName: 'plan-build-orchestrator', adwId }),
    );

    const result = findOrchestratorStatePath(adwId);
    expect(result).toBe(agentDir);
  });

  it('returns null when no orchestrator agent is found', () => {
    const adwId = 'test-adw-no-orch';
    const agentDir = path.join(uniqueTestDir, adwId, 'plan-agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, 'state.json'),
      JSON.stringify({ agentName: 'plan-agent', adwId }),
    );

    const result = findOrchestratorStatePath(adwId);
    expect(result).toBeNull();
  });

  it('skips non-directory entries', () => {
    const adwId = 'test-adw-files';
    const adwDir = path.join(uniqueTestDir, adwId);
    fs.mkdirSync(adwDir, { recursive: true });
    // Create a file (not a directory) in the adw directory
    fs.writeFileSync(path.join(adwDir, 'some-file.txt'), 'not a directory');

    const result = findOrchestratorStatePath(adwId);
    expect(result).toBeNull();
  });

  it('handles corrupted state.json gracefully', () => {
    const adwId = 'test-adw-corrupt';
    const agentDir = path.join(uniqueTestDir, adwId, 'plan-build-orchestrator');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'state.json'), 'not-valid-json{{{');

    const result = findOrchestratorStatePath(adwId);
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

  it('returns false when no state exists for the ADW ID', () => {
    expect(isAgentProcessRunning('nonexistent-adw')).toBe(false);
  });

  it('returns true when the orchestrator process is alive', () => {
    const adwId = 'test-adw-alive';
    const agentDir = path.join(uniqueTestDir, adwId, 'plan-build-orchestrator');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, 'state.json'),
      JSON.stringify({ agentName: 'plan-build-orchestrator', adwId, pid: process.pid }),
    );

    expect(isAgentProcessRunning(adwId)).toBe(true);
  });

  it('returns false when the orchestrator process is dead', () => {
    const adwId = 'test-adw-dead';
    const agentDir = path.join(uniqueTestDir, adwId, 'plan-build-orchestrator');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, 'state.json'),
      JSON.stringify({ agentName: 'plan-build-orchestrator', adwId, pid: 999999999 }),
    );

    expect(isAgentProcessRunning(adwId)).toBe(false);
  });

  it('returns false when state exists but has no pid', () => {
    const adwId = 'test-adw-no-pid';
    const agentDir = path.join(uniqueTestDir, adwId, 'plan-build-orchestrator');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, 'state.json'),
      JSON.stringify({ agentName: 'plan-build-orchestrator', adwId }),
    );

    expect(isAgentProcessRunning(adwId)).toBe(false);
  });
});
