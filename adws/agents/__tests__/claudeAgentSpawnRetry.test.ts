import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock the child_process module
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

// Mock the config module with controllable resolveClaudeCodePath
const mockResolveClaudeCodePath = vi.fn<() => string>(() => '/usr/local/bin/claude');
const mockClearClaudeCodePathCache = vi.fn();

vi.mock('../../core/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/config')>();
  return {
    ...actual,
    CLAUDE_CODE_PATH: '/usr/local/bin/claude',
    AGENTS_STATE_DIR: '/tmp/test-agents',
    resolveClaudeCodePath: () => mockResolveClaudeCodePath(),
    clearClaudeCodePathCache: () => mockClearClaudeCodePathCache(),
  };
});

// Import after mocks are set up
import { spawn } from 'child_process';
import { runClaudeAgent, runClaudeAgentWithCommand } from '../claudeAgent';

// Generate a unique test directory
const uniqueTestDir = `/tmp/test-retry-${Buffer.from(__dirname).toString('base64').replace(/[/+=]/g, '').slice(0, 16)}`;

describe('claudeAgent ENOENT spawn retry', () => {
  const testLogsDir = `${uniqueTestDir}/test-logs`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveClaudeCodePath.mockReturnValue('/usr/local/bin/claude');
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
    it('does not retry when spawn succeeds on first attempt', async () => {
      const mockSpawn = createMockSpawn({ result: 'Success' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const result = await runClaudeAgent('test prompt', 'Test Agent', `${testLogsDir}/test.jsonl`);

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(mockClearClaudeCodePathCache).not.toHaveBeenCalled();
    });

    it('retries on ENOENT and succeeds on second attempt', async () => {
      let callCount = 0;
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createMockSpawnWithError('ENOENT')();
        }
        return createMockSpawn({ result: 'Success' })();
      });

      mockResolveClaudeCodePath
        .mockReturnValueOnce('/usr/local/bin/claude')
        .mockReturnValueOnce('/Users/martin/.local/bin/claude');

      const result = await runClaudeAgent('test prompt', 'Test Agent', `${testLogsDir}/test.jsonl`);

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(mockClearClaudeCodePathCache).toHaveBeenCalledTimes(1);
    }, 10000);

    it('returns failure when both attempts emit ENOENT', async () => {
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        createMockSpawnWithError('ENOENT')
      );

      const result = await runClaudeAgent('test prompt', 'Test Agent', `${testLogsDir}/test.jsonl`);

      expect(result.success).toBe(false);
      expect(result.output).toContain('ENOENT');
      expect(spawn).toHaveBeenCalledTimes(2);
    }, 10000);

    it('does not retry on non-ENOENT errors (e.g., EACCES)', async () => {
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        createMockSpawnWithError('EACCES')
      );

      const result = await runClaudeAgent('test prompt', 'Test Agent', `${testLogsDir}/test.jsonl`);

      expect(result.success).toBe(false);
      expect(result.output).toContain('EACCES');
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(mockClearClaudeCodePathCache).not.toHaveBeenCalled();
    });
  });

  describe('runClaudeAgentWithCommand', () => {
    it('does not retry when spawn succeeds on first attempt', async () => {
      const mockSpawn = createMockSpawn({ result: 'Success' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const result = await runClaudeAgentWithCommand('/test', 'args', 'Test Agent', `${testLogsDir}/test.jsonl`);

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(mockClearClaudeCodePathCache).not.toHaveBeenCalled();
    });

    it('retries on ENOENT and succeeds on second attempt', async () => {
      let callCount = 0;
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return createMockSpawnWithError('ENOENT')();
        }
        return createMockSpawn({ result: 'Success' })();
      });

      const result = await runClaudeAgentWithCommand('/test', 'args', 'Test Agent', `${testLogsDir}/test.jsonl`);

      expect(result.success).toBe(true);
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(mockClearClaudeCodePathCache).toHaveBeenCalledTimes(1);
    }, 10000);

    it('does not retry on non-ENOENT errors', async () => {
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        createMockSpawnWithError('EACCES')
      );

      const result = await runClaudeAgentWithCommand('/test', 'args', 'Test Agent', `${testLogsDir}/test.jsonl`);

      expect(result.success).toBe(false);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(mockClearClaudeCodePathCache).not.toHaveBeenCalled();
    });
  });

  describe('spawn arguments', () => {
    describe('runClaudeAgent', () => {
      it('includes --effort flag when effort is provided', async () => {
        const mockSpawn = createMockSpawn({ result: 'Success' });
        (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

        await runClaudeAgent('test prompt', 'Test Agent', `${testLogsDir}/test.jsonl`, 'sonnet', 'high');

        const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
        const effortIndex = args.indexOf('--effort');
        expect(effortIndex).toBeGreaterThan(-1);
        expect(args[effortIndex + 1]).toBe('high');
      });

      it('omits --effort flag when effort is undefined', async () => {
        const mockSpawn = createMockSpawn({ result: 'Success' });
        (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

        await runClaudeAgent('test prompt', 'Test Agent', `${testLogsDir}/test.jsonl`, 'sonnet');

        const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
        expect(args).not.toContain('--effort');
      });

      it('includes correct model in args', async () => {
        const mockSpawn = createMockSpawn({ result: 'Success' });
        (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

        await runClaudeAgent('test prompt', 'Test Agent', `${testLogsDir}/test.jsonl`, 'opus');

        const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
        const modelIndex = args.indexOf('--model');
        expect(modelIndex).toBeGreaterThan(-1);
        expect(args[modelIndex + 1]).toBe('opus');
      });
    });

    describe('runClaudeAgentWithCommand', () => {
      it('includes --effort flag when effort is provided', async () => {
        const mockSpawn = createMockSpawn({ result: 'Success' });
        (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

        await runClaudeAgentWithCommand('/implement', 'args', 'Test Agent', `${testLogsDir}/test.jsonl`, 'sonnet', 'max');

        const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
        const effortIndex = args.indexOf('--effort');
        expect(effortIndex).toBeGreaterThan(-1);
        expect(args[effortIndex + 1]).toBe('max');
      });

      it('omits --effort flag when effort is undefined', async () => {
        const mockSpawn = createMockSpawn({ result: 'Success' });
        (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

        await runClaudeAgentWithCommand('/implement', 'args', 'Test Agent', `${testLogsDir}/test.jsonl`, 'sonnet');

        const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
        expect(args).not.toContain('--effort');
      });

      it('includes the prompt as last argument', async () => {
        const mockSpawn = createMockSpawn({ result: 'Success' });
        (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

        await runClaudeAgentWithCommand('/implement', 'test arg', 'Test Agent', `${testLogsDir}/test.jsonl`);

        const args = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
        expect(args[args.length - 1]).toBe("/implement 'test arg'");
      });
    });
  });
});

/**
 * Creates a mock spawn that returns a successful process.
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

/**
 * Creates a mock spawn that emits an error event with the given error code.
 */
function createMockSpawnWithError(errorCode: string) {
  return () => {
    const mockStdout = {
      on: vi.fn(),
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
      on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
        if (event === 'error') {
          const error = new Error(`spawn /usr/local/bin/claude ${errorCode}`) as NodeJS.ErrnoException;
          error.code = errorCode;
          setTimeout(() => callback(error), 5);
        }
      }),
    };

    return mockProcess;
  };
}
