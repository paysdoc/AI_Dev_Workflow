import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock the child_process module
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock the config module
vi.mock('../../core/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/config')>();
  return {
    ...actual,
    CLAUDE_CODE_PATH: '/usr/local/bin/claude',
    AGENTS_STATE_DIR: '/tmp/test-agents',
    resolveClaudeCodePath: () => '/usr/local/bin/claude',
    clearClaudeCodePathCache: () => {},
  };
});

// Import after mocks are set up
import { spawn } from 'child_process';
import { runClaudeAgent, runClaudeAgentWithCommand } from '../claudeAgent';
import { runTestAgent, runResolveTestAgent, runResolveE2ETestAgent } from '../testAgent';
import { TestResult, E2ETestResult } from '../testAgent';

// Generate a unique test directory
const uniqueTestDir = `/tmp/test-cwd-${Buffer.from(__dirname).toString('base64').replace(/[/+=]/g, '').slice(0, 16)}`;

describe('cwd propagation', () => {
  const testLogsDir = `${uniqueTestDir}/test-logs`;
  const customCwd = '/custom/working/directory';

  beforeEach(() => {
    vi.clearAllMocks();
    if (fs.existsSync(uniqueTestDir)) {
      fs.rmSync(uniqueTestDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testLogsDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(uniqueTestDir)) {
      fs.rmSync(uniqueTestDir, { recursive: true, force: true });
    }
  });

  describe('runClaudeAgent', () => {
    it('uses process.cwd() when cwd is not provided', async () => {
      const mockSpawn = createMockSpawn({ result: 'Success' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      await runClaudeAgent('test prompt', 'Test Agent', `${testLogsDir}/test.jsonl`);

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        expect.any(Array),
        expect.objectContaining({
          cwd: process.cwd(),
        })
      );
    });

    it('uses provided cwd when specified', async () => {
      const mockSpawn = createMockSpawn({ result: 'Success' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      await runClaudeAgent('test prompt', 'Test Agent', `${testLogsDir}/test.jsonl`, 'sonnet', undefined, undefined, undefined, customCwd);

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        expect.any(Array),
        expect.objectContaining({
          cwd: customCwd,
        })
      );
    });
  });

  describe('runClaudeAgentWithCommand', () => {
    it('uses process.cwd() when cwd is not provided', async () => {
      const mockSpawn = createMockSpawn({ result: 'Success' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      await runClaudeAgentWithCommand('/test', 'args', 'Test Agent', `${testLogsDir}/test.jsonl`);

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        expect.any(Array),
        expect.objectContaining({
          cwd: process.cwd(),
        })
      );
    });

    it('uses provided cwd when specified', async () => {
      const mockSpawn = createMockSpawn({ result: 'Success' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      await runClaudeAgentWithCommand('/test', 'args', 'Test Agent', `${testLogsDir}/test.jsonl`, 'sonnet', undefined, undefined, undefined, customCwd);

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        expect.any(Array),
        expect.objectContaining({
          cwd: customCwd,
        })
      );
    });

    it('individually quotes each element when args is a string array', async () => {
      const mockSpawn = createMockSpawn({ result: 'Success' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      await runClaudeAgentWithCommand('/command', ['arg1', 'arg2', 'arg3'], 'Test Agent', `${testLogsDir}/test.jsonl`);

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const cliArgs = spawnCall[1] as string[];
      const prompt = cliArgs[cliArgs.length - 1];
      expect(prompt).toBe("/command 'arg1' 'arg2' 'arg3'");
    });

    it('escapes single quotes within array elements', async () => {
      const mockSpawn = createMockSpawn({ result: 'Success' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      await runClaudeAgentWithCommand('/command', ["it's a test", 'normal'], 'Test Agent', `${testLogsDir}/test.jsonl`);

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const cliArgs = spawnCall[1] as string[];
      const prompt = cliArgs[cliArgs.length - 1];
      expect(prompt).toBe("/command 'it'\\''s a test' 'normal'");
    });

    it('produces correct prompt format with a single string arg', async () => {
      const mockSpawn = createMockSpawn({ result: 'Success' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      await runClaudeAgentWithCommand('/test', 'my argument', 'Test Agent', `${testLogsDir}/test.jsonl`);

      const spawnCall = vi.mocked(spawn).mock.calls[0];
      const cliArgs = spawnCall[1] as string[];
      const prompt = cliArgs[cliArgs.length - 1];
      expect(prompt).toBe("/test 'my argument'");
    });
  });

  describe('runTestAgent', () => {
    it('passes cwd to spawn when provided', async () => {
      const testResults: TestResult[] = [
        { test_name: 'linting', passed: true, execution_command: 'bun run lint', test_purpose: 'Check linting' },
      ];
      const mockSpawn = createMockSpawn({ result: JSON.stringify(testResults) });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      await runTestAgent(testLogsDir, undefined, customCwd);

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        expect.any(Array),
        expect.objectContaining({
          cwd: customCwd,
        })
      );
    });
  });

  describe('runResolveTestAgent', () => {
    it('passes cwd to spawn when provided', async () => {
      const mockSpawn = createMockSpawn({ result: 'Fixed' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const failedTest: TestResult = {
        test_name: 'build',
        passed: false,
        execution_command: 'bun run build',
        test_purpose: 'Build app',
        error: 'Type error',
      };

      await runResolveTestAgent(failedTest, testLogsDir, undefined, customCwd);

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        expect.any(Array),
        expect.objectContaining({
          cwd: customCwd,
        })
      );
    });
  });

  describe('runResolveE2ETestAgent', () => {
    it('passes cwd to spawn when provided', async () => {
      const mockSpawn = createMockSpawn({ result: 'Fixed' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const failedE2ETest: E2ETestResult = {
        testName: 'Login Test',
        status: 'failed',
        error: 'Element not found',
      };

      await runResolveE2ETestAgent(failedE2ETest, testLogsDir, undefined, customCwd);

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        expect.any(Array),
        expect.objectContaining({
          cwd: customCwd,
        })
      );
    });
  });
});

/**
 * Creates a mock implementation of child_process.spawn that simulates
 * the Claude CLI output format.
 */
function createMockSpawn(options: { result: string; exitCode?: number }) {
  return () => {
    const { result, exitCode = 0 } = options;

    const mockStdout = {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data') {
          const jsonlOutput = JSON.stringify({
            type: 'result',
            subtype: 'success',
            isError: false,
            durationMs: 1000,
            durationApiMs: 900,
            numTurns: 1,
            result,
            sessionId: 'test-session-id',
            totalCostUsd: 0.01,
          });
          setTimeout(() => callback(Buffer.from(jsonlOutput + '\n')), 10);
        }
      }),
    };

    const mockStderr = {
      on: vi.fn(),
    };

    const mockProcess = {
      stdout: mockStdout,
      stderr: mockStderr,
      stdin: {
        write: vi.fn(),
        end: vi.fn(),
      },
      on: vi.fn((event: string, callback: (code: number) => void) => {
        if (event === 'close') {
          setTimeout(() => callback(exitCode), 20);
        }
      }),
    };

    return mockProcess;
  };
}
