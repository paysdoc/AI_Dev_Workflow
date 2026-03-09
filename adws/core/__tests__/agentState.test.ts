import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { AgentStateManager } from '../agentState';
import { AgentState } from '../../types/dataTypes';

// Generate a unique test directory to avoid conflicts when running in parallel across worktrees
// Use __dirname hash to ensure each worktree/location gets a unique directory
const uniqueTestDir = `/tmp/test-agents-${Buffer.from(__dirname).toString('base64').replace(/[/+=]/g, '').slice(0, 16)}`;

// Mock the config module to use a temp directory
vi.mock('../config', async () => {
  // Re-compute the unique path inside the mock to ensure consistency
  const dirHash = Buffer.from(__dirname).toString('base64').replace(/[/+=]/g, '').slice(0, 16);
  return {
    AGENTS_STATE_DIR: `/tmp/test-agents-${dirHash}`,
  };
});

describe('AgentStateManager', () => {
  const testAdwId = 'adw-test-12345-abc';
  const _testStatePath = `${uniqueTestDir}/adw-test-12345-abc/orchestrator`;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up test directory before each test
    if (fs.existsSync(uniqueTestDir)) {
      fs.rmSync(uniqueTestDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test directory after each test
    if (fs.existsSync(uniqueTestDir)) {
      fs.rmSync(uniqueTestDir, { recursive: true, force: true });
    }
  });

  describe('initializeState', () => {
    it('creates correct directory structure for top-level agent', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');

      expect(statePath).toBe(`${uniqueTestDir}/adw-test-12345-abc/orchestrator`);
      expect(fs.existsSync(statePath)).toBe(true);
    });

    it('creates nested directory structure for child agent', () => {
      // First create parent
      const parentPath = AgentStateManager.initializeState(testAdwId, 'orchestrator');
      // Then create child under parent
      const childPath = AgentStateManager.initializeState(testAdwId, 'classifier', parentPath);

      expect(childPath).toBe(`${uniqueTestDir}/adw-test-12345-abc/orchestrator/classifier`);
      expect(fs.existsSync(childPath)).toBe(true);
    });

    it('returns existing directory without error if already exists', () => {
      const firstPath = AgentStateManager.initializeState(testAdwId, 'orchestrator');
      const secondPath = AgentStateManager.initializeState(testAdwId, 'orchestrator');

      expect(firstPath).toBe(secondPath);
      expect(fs.existsSync(firstPath)).toBe(true);
    });

    it('creates deeply nested agent directories', () => {
      const parentPath = AgentStateManager.initializeState(testAdwId, 'orchestrator');
      const childPath = AgentStateManager.initializeState(testAdwId, 'plan-agent', parentPath);

      expect(childPath).toBe(`${uniqueTestDir}/adw-test-12345-abc/orchestrator/plan-agent`);
      expect(fs.existsSync(childPath)).toBe(true);
    });
  });

  describe('writeState and readState', () => {
    it('writes and reads state correctly', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');
      const state: Partial<AgentState> = {
        adwId: testAdwId,
        issueNumber: 42,
        branchName: 'feature/test-branch',
        agentName: 'orchestrator',
        execution: {
          status: 'running',
          startedAt: '2026-02-02T12:00:00.000Z',
        },
      };

      AgentStateManager.writeState(statePath, state);
      const readState = AgentStateManager.readState(statePath);

      expect(readState).toMatchObject(state);
    });

    it('merges with existing state', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');

      // Write initial state
      AgentStateManager.writeState(statePath, {
        adwId: testAdwId,
        issueNumber: 42,
      });

      // Write additional state
      AgentStateManager.writeState(statePath, {
        branchName: 'feature/new-branch',
        planFile: 'specs/issue-42-plan.md',
      });

      const readState = AgentStateManager.readState(statePath);

      expect(readState?.adwId).toBe(testAdwId);
      expect(readState?.issueNumber).toBe(42);
      expect(readState?.branchName).toBe('feature/new-branch');
      expect(readState?.planFile).toBe('specs/issue-42-plan.md');
    });

    it('returns null when state file does not exist', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');
      const readState = AgentStateManager.readState(statePath);

      expect(readState).toBeNull();
    });

    it('returns null when directory does not exist', () => {
      const readState = AgentStateManager.readState('/tmp/nonexistent/path');

      expect(readState).toBeNull();
    });

    it('overwrites existing values with new values', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');

      AgentStateManager.writeState(statePath, {
        branchName: 'old-branch',
      });

      AgentStateManager.writeState(statePath, {
        branchName: 'new-branch',
      });

      const readState = AgentStateManager.readState(statePath);

      expect(readState?.branchName).toBe('new-branch');
    });
  });

  describe('appendLog', () => {
    it('creates log file with prompt on first entry', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');
      const prompt = 'This is the test prompt';

      AgentStateManager.appendLog(statePath, 'First log message', prompt);

      const logPath = path.join(statePath, 'execution.log');
      expect(fs.existsSync(logPath)).toBe(true);

      const content = fs.readFileSync(logPath, 'utf-8');
      expect(content).toContain('=== Agent Execution Log ===');
      expect(content).toContain('=== Prompt ===');
      expect(content).toContain(prompt);
      expect(content).toContain('First log message');
    });

    it('appends subsequent messages without prompt header', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');

      AgentStateManager.appendLog(statePath, 'First message', 'Initial prompt');
      AgentStateManager.appendLog(statePath, 'Second message');
      AgentStateManager.appendLog(statePath, 'Third message');

      const logPath = path.join(statePath, 'execution.log');
      const content = fs.readFileSync(logPath, 'utf-8');

      expect(content).toContain('First message');
      expect(content).toContain('Second message');
      expect(content).toContain('Third message');
      // Prompt header should only appear once
      expect((content.match(/=== Prompt ===/g) || []).length).toBe(1);
    });

    it('includes timestamps in log entries', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');

      AgentStateManager.appendLog(statePath, 'Test message');

      const logPath = path.join(statePath, 'execution.log');
      const content = fs.readFileSync(logPath, 'utf-8');

      // Should contain ISO timestamp format
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('writeRawOutput', () => {
    it('writes JSON file correctly', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');
      const data = { key: 'value', nested: { num: 42 } };

      AgentStateManager.writeRawOutput(statePath, 'output.json', data);

      const outputPath = path.join(statePath, 'output.json');
      expect(fs.existsSync(outputPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      expect(content).toEqual(data);
    });

    it('writes JSONL file with single line', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');
      const data = { type: 'message', content: 'hello' };

      AgentStateManager.writeRawOutput(statePath, 'output.jsonl', data);

      const outputPath = path.join(statePath, 'output.jsonl');
      const content = fs.readFileSync(outputPath, 'utf-8');

      expect(content).toBe(JSON.stringify(data) + '\n');
    });

    it('appends to JSONL file when append=true', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');
      const data1 = { id: 1, msg: 'first' };
      const data2 = { id: 2, msg: 'second' };

      AgentStateManager.writeRawOutput(statePath, 'output.jsonl', data1);
      AgentStateManager.writeRawOutput(statePath, 'output.jsonl', data2, true);

      const outputPath = path.join(statePath, 'output.jsonl');
      const lines = fs.readFileSync(outputPath, 'utf-8').trim().split('\n');

      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual(data1);
      expect(JSON.parse(lines[1])).toEqual(data2);
    });

    it('overwrites JSONL file when append=false', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');
      const data1 = { id: 1, msg: 'first' };
      const data2 = { id: 2, msg: 'second' };

      AgentStateManager.writeRawOutput(statePath, 'output.jsonl', data1);
      AgentStateManager.writeRawOutput(statePath, 'output.jsonl', data2, false);

      const outputPath = path.join(statePath, 'output.jsonl');
      const lines = fs.readFileSync(outputPath, 'utf-8').trim().split('\n');

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual(data2);
    });
  });

  describe('readParentState', () => {
    it('reads parent state from parent directory', () => {
      const parentPath = AgentStateManager.initializeState(testAdwId, 'orchestrator');
      const childPath = AgentStateManager.initializeState(testAdwId, 'classifier', parentPath);

      // Write parent state
      AgentStateManager.writeState(parentPath, {
        adwId: testAdwId,
        issueNumber: 42,
        agentName: 'orchestrator',
        execution: {
          status: 'running',
          startedAt: '2026-02-02T12:00:00.000Z',
        },
      });

      const parentState = AgentStateManager.readParentState(childPath);

      expect(parentState).not.toBeNull();
      expect(parentState?.agentName).toBe('orchestrator');
      expect(parentState?.issueNumber).toBe(42);
    });

    it('returns null when no parent state exists', () => {
      const parentPath = AgentStateManager.initializeState(testAdwId, 'orchestrator');
      const childPath = AgentStateManager.initializeState(testAdwId, 'classifier', parentPath);

      // Don't write any parent state
      const parentState = AgentStateManager.readParentState(childPath);

      expect(parentState).toBeNull();
    });

    it('returns null when at agents root directory', () => {
      const parentState = AgentStateManager.readParentState(uniqueTestDir);

      expect(parentState).toBeNull();
    });
  });

  describe('createExecutionState', () => {
    it('creates execution state with running status by default', () => {
      const execution = AgentStateManager.createExecutionState();

      expect(execution.status).toBe('running');
      expect(execution.startedAt).toBeDefined();
      expect(execution.completedAt).toBeUndefined();
    });

    it('creates execution state with specified status', () => {
      const execution = AgentStateManager.createExecutionState('pending');

      expect(execution.status).toBe('pending');
    });

    it('has valid ISO timestamp', () => {
      const execution = AgentStateManager.createExecutionState();
      const date = new Date(execution.startedAt);

      expect(date.toISOString()).toBe(execution.startedAt);
    });
  });

  describe('completeExecution', () => {
    it('marks execution as completed on success', () => {
      const initial = AgentStateManager.createExecutionState();
      const completed = AgentStateManager.completeExecution(initial, true);

      expect(completed.status).toBe('completed');
      expect(completed.completedAt).toBeDefined();
      expect(completed.errorMessage).toBeUndefined();
    });

    it('marks execution as failed on failure', () => {
      const initial = AgentStateManager.createExecutionState();
      const completed = AgentStateManager.completeExecution(initial, false, 'Test error message');

      expect(completed.status).toBe('failed');
      expect(completed.completedAt).toBeDefined();
      expect(completed.errorMessage).toBe('Test error message');
    });

    it('preserves startedAt timestamp', () => {
      const initial = AgentStateManager.createExecutionState();
      const completed = AgentStateManager.completeExecution(initial, true);

      expect(completed.startedAt).toBe(initial.startedAt);
    });
  });

  describe('getStatePath', () => {
    it('returns correct path for top-level agent', () => {
      const statePath = AgentStateManager.getStatePath(testAdwId, 'orchestrator');

      expect(statePath).toBe(`${uniqueTestDir}/adw-test-12345-abc/orchestrator`);
    });

    it('returns correct path for nested agent', () => {
      const parentPath = `${uniqueTestDir}/adw-test-12345-abc/orchestrator`;
      const statePath = AgentStateManager.getStatePath(testAdwId, 'classifier', parentPath);

      expect(statePath).toBe(`${uniqueTestDir}/adw-test-12345-abc/orchestrator/classifier`);
    });
  });

  describe('stateExists', () => {
    it('returns true when state.json exists', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');
      AgentStateManager.writeState(statePath, { adwId: testAdwId });

      expect(AgentStateManager.stateExists(statePath)).toBe(true);
    });

    it('returns false when state.json does not exist', () => {
      const statePath = AgentStateManager.initializeState(testAdwId, 'orchestrator');

      expect(AgentStateManager.stateExists(statePath)).toBe(false);
    });

    it('returns false when directory does not exist', () => {
      expect(AgentStateManager.stateExists('/tmp/nonexistent/path')).toBe(false);
    });
  });
});
