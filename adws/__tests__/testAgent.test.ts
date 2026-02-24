import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock the child_process module
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock the config module
vi.mock('../core/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/config')>();
  return {
    ...actual,
    CLAUDE_CODE_PATH: '/usr/local/bin/claude',
    AGENTS_STATE_DIR: '/tmp/test-agents',
  };
});

// Import after mocks are set up
import { spawn } from 'child_process';
import {
  discoverE2ETestFiles,
  runTestAgent,
  runPlaywrightE2ETests,
  runResolveTestAgent,
  runResolveE2ETestAgent,
  isValidE2ETestResult,
  TestResult,
  E2ETestResult,
} from '../agents/testAgent';

// Generate a unique test directory to avoid conflicts when running in parallel across worktrees
const uniqueTestDir = `/tmp/test-e2e-${Buffer.from(__dirname).toString('base64').replace(/[/+=]/g, '').slice(0, 16)}`;

describe('testAgent', () => {
  const testLogsDir = `${uniqueTestDir}/test-logs`;
  // Use a unique temp directory for e2e tests instead of the real .claude/commands/e2e-examples
  const testBaseDir = `${uniqueTestDir}/mock-project`;
  const e2eTestsDir = path.join(testBaseDir, 'e2e-tests');

  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up test directories before each test
    if (fs.existsSync(uniqueTestDir)) {
      fs.rmSync(uniqueTestDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testLogsDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directories after each test
    if (fs.existsSync(uniqueTestDir)) {
      fs.rmSync(uniqueTestDir, { recursive: true, force: true });
    }
  });

  describe('discoverE2ETestFiles', () => {
    it('returns empty array when e2e-tests directory does not exist', () => {
      const result = discoverE2ETestFiles(testBaseDir);
      expect(result).toEqual([]);
    });

    it('returns empty array when e2e-tests directory is empty', () => {
      fs.mkdirSync(e2eTestsDir, { recursive: true });
      const result = discoverE2ETestFiles(testBaseDir);
      expect(result).toEqual([]);
    });

    it('returns only spec.ts files from e2e-tests directory', () => {
      fs.mkdirSync(e2eTestsDir, { recursive: true });
      fs.writeFileSync(path.join(e2eTestsDir, 'login.spec.ts'), 'test');
      fs.writeFileSync(path.join(e2eTestsDir, 'signup.spec.ts'), 'test');
      fs.writeFileSync(path.join(e2eTestsDir, 'README.txt'), 'Not a test file');
      fs.writeFileSync(path.join(e2eTestsDir, 'test_old.md'), '# Old test');

      const result = discoverE2ETestFiles(testBaseDir);

      expect(result).toHaveLength(2);
      expect(result).toContain(path.join(e2eTestsDir, 'login.spec.ts'));
      expect(result).toContain(path.join(e2eTestsDir, 'signup.spec.ts'));
    });

    it('returns files in sorted order', () => {
      fs.mkdirSync(e2eTestsDir, { recursive: true });
      fs.writeFileSync(path.join(e2eTestsDir, 'z-test.spec.ts'), 'test');
      fs.writeFileSync(path.join(e2eTestsDir, 'a-test.spec.ts'), 'test');
      fs.writeFileSync(path.join(e2eTestsDir, 'm-test.spec.ts'), 'test');

      const result = discoverE2ETestFiles(testBaseDir);

      expect(result[0]).toContain('a-test.spec.ts');
      expect(result[1]).toContain('m-test.spec.ts');
      expect(result[2]).toContain('z-test.spec.ts');
    });
  });

  describe('runTestAgent', () => {
    it('uses sonnet model for test execution', async () => {
      const mockSpawn = createMockSpawn({
        result: JSON.stringify([
          { test_name: 'linting', passed: true, execution_command: 'npm run lint', test_purpose: 'Check linting' }
        ])
      });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      await runTestAgent(testLogsDir);

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        expect.arrayContaining(['--model', 'sonnet']),
        expect.any(Object)
      );
    });

    it('parses test results from JSON output', async () => {
      const testResults: TestResult[] = [
        { test_name: 'linting', passed: true, execution_command: 'npm run lint', test_purpose: 'Check linting' },
        { test_name: 'build', passed: false, execution_command: 'npm run build', test_purpose: 'Build app', error: 'Build failed' },
      ];
      const mockSpawn = createMockSpawn({ result: JSON.stringify(testResults) });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const result = await runTestAgent(testLogsDir);

      expect(result.testResults).toHaveLength(2);
      expect(result.allPassed).toBe(false);
      expect(result.failedTests).toHaveLength(1);
      expect(result.failedTests[0].test_name).toBe('build');
    });

    it('handles all tests passing', async () => {
      const testResults: TestResult[] = [
        { test_name: 'linting', passed: true, execution_command: 'npm run lint', test_purpose: 'Check linting' },
        { test_name: 'build', passed: true, execution_command: 'npm run build', test_purpose: 'Build app' },
      ];
      const mockSpawn = createMockSpawn({ result: JSON.stringify(testResults) });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const result = await runTestAgent(testLogsDir);

      expect(result.allPassed).toBe(true);
      expect(result.failedTests).toHaveLength(0);
    });
  });

  describe('runPlaywrightE2ETests', () => {
    it('spawns npx playwright test subprocess', async () => {
      const mockSpawn = createPlaywrightMockSpawn({ exitCode: 0, stdout: 'Running tests...' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      // Create empty results file
      fs.mkdirSync(testBaseDir, { recursive: true });
      fs.writeFileSync(
        path.join(testBaseDir, 'e2e-results.json'),
        JSON.stringify({ suites: [] })
      );

      const result = await runPlaywrightE2ETests(testBaseDir);

      expect(spawn).toHaveBeenCalledWith(
        'npx',
        ['playwright', 'test'],
        expect.objectContaining({ cwd: testBaseDir })
      );
      expect(result.exitCode).toBe(0);
    });

    it('parses Playwright JSON output for passing tests', async () => {
      const mockSpawn = createPlaywrightMockSpawn({ exitCode: 0, stdout: 'All passed' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const playwrightReport = {
        suites: [
          {
            title: 'Characters Overview',
            file: 'characters-overview.spec.ts',
            specs: [
              { title: 'displays header', ok: true, tests: [{ title: 'displays header', ok: true, results: [{ status: 'passed' }] }] },
            ],
            suites: [],
          },
        ],
      };

      fs.mkdirSync(testBaseDir, { recursive: true });
      fs.writeFileSync(
        path.join(testBaseDir, 'e2e-results.json'),
        JSON.stringify(playwrightReport)
      );

      const result = await runPlaywrightE2ETests(testBaseDir);

      expect(result.allPassed).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe('passed');
      expect(result.failedResults).toHaveLength(0);
    });

    it('parses Playwright JSON output for failing tests', async () => {
      const mockSpawn = createPlaywrightMockSpawn({ exitCode: 1, stdout: 'Failed' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const playwrightReport = {
        suites: [
          {
            title: 'Characters Overview',
            file: 'characters-overview.spec.ts',
            specs: [
              {
                title: 'displays header',
                ok: false,
                tests: [{
                  title: 'displays header',
                  ok: false,
                  results: [{ status: 'failed', error: { message: 'Timeout waiting for element' } }],
                }],
              },
            ],
            suites: [],
          },
        ],
      };

      fs.mkdirSync(testBaseDir, { recursive: true });
      fs.writeFileSync(
        path.join(testBaseDir, 'e2e-results.json'),
        JSON.stringify(playwrightReport)
      );

      const result = await runPlaywrightE2ETests(testBaseDir);

      expect(result.allPassed).toBe(false);
      expect(result.failedResults).toHaveLength(1);
      expect(result.failedResults[0].testName).toBe('Characters Overview');
      expect(result.failedResults[0].error).toContain('Timeout waiting for element');
    });

    it('handles missing results file gracefully', async () => {
      const mockSpawn = createPlaywrightMockSpawn({ exitCode: 1, stdout: 'Error' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      fs.mkdirSync(testBaseDir, { recursive: true });

      const result = await runPlaywrightE2ETests(testBaseDir);

      expect(result.allPassed).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('sets E2E_BASE_URL in subprocess env when applicationUrl is provided', async () => {
      const mockSpawn = createPlaywrightMockSpawn({ exitCode: 0, stdout: 'Running tests...' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      fs.mkdirSync(testBaseDir, { recursive: true });
      fs.writeFileSync(
        path.join(testBaseDir, 'e2e-results.json'),
        JSON.stringify({ suites: [] })
      );

      await runPlaywrightE2ETests(testBaseDir, 'http://localhost:34567');

      expect(spawn).toHaveBeenCalledWith(
        'npx',
        ['playwright', 'test'],
        expect.objectContaining({
          cwd: testBaseDir,
          env: expect.objectContaining({ E2E_BASE_URL: 'http://localhost:34567' }),
        })
      );
    });

    it('does not override E2E_BASE_URL when applicationUrl is not provided', async () => {
      const mockSpawn = createPlaywrightMockSpawn({ exitCode: 0, stdout: 'Running tests...' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      fs.mkdirSync(testBaseDir, { recursive: true });
      fs.writeFileSync(
        path.join(testBaseDir, 'e2e-results.json'),
        JSON.stringify({ suites: [] })
      );

      await runPlaywrightE2ETests(testBaseDir);

      const spawnCall = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const spawnOptions = spawnCall[2] as { env: NodeJS.ProcessEnv };
      expect(spawnOptions.env).toBe(process.env);
    });

  });

  describe('runResolveTestAgent', () => {
    it('uses opus model for failure resolution', async () => {
      const mockSpawn = createMockSpawn({ result: 'Fixed the issue' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const failedTest: TestResult = {
        test_name: 'build',
        passed: false,
        execution_command: 'npm run build',
        test_purpose: 'Build app',
        error: 'Type error',
      };

      await runResolveTestAgent(failedTest, testLogsDir);

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        expect.arrayContaining(['--model', 'opus']),
        expect.any(Object)
      );
    });

    it('passes failed test as JSON argument', async () => {
      const mockSpawn = createMockSpawn({ result: 'Fixed the issue' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const failedTest: TestResult = {
        test_name: 'build',
        passed: false,
        execution_command: 'npm run build',
        test_purpose: 'Build app',
        error: 'Type error',
      };

      await runResolveTestAgent(failedTest, testLogsDir);

      // Verify the command was called with the test JSON in the prompt
      const calls = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1];
      const args = lastCall[1] as string[];
      const prompt = args[args.length - 1];
      expect(prompt).toContain('/resolve_failed_test');
      expect(prompt).toContain('build');
    });
  });

  describe('runResolveE2ETestAgent', () => {
    it('uses opus model for E2E failure resolution', async () => {
      const mockSpawn = createMockSpawn({ result: 'Fixed the E2E issue' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const failedE2ETest: E2ETestResult = {
        testName: 'Login Test',
        status: 'failed',
        error: 'Element not found',
        testPath: '/path/to/login.spec.ts',
      };

      await runResolveE2ETestAgent(failedE2ETest, testLogsDir);

      expect(spawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        expect.arrayContaining(['--model', 'opus']),
        expect.any(Object)
      );
    });

    it('passes failed E2E test as JSON argument', async () => {
      const mockSpawn = createMockSpawn({ result: 'Fixed the E2E issue' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const failedE2ETest: E2ETestResult = {
        testName: 'Login Test',
        status: 'failed',
        error: 'Element not found',
        testPath: '/path/to/login.spec.ts',
      };

      await runResolveE2ETestAgent(failedE2ETest, testLogsDir);

      // Verify the command was called with the E2E test JSON in the prompt
      const calls = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1];
      const args = lastCall[1] as string[];
      const prompt = args[args.length - 1];
      expect(prompt).toContain('/resolve_failed_e2e_test');
      expect(prompt).toContain('Login Test');
    });

    it('handles undefined testName without throwing', async () => {
      const mockSpawn = createMockSpawn({ result: 'Attempted to fix the E2E issue' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      // Create a test result with undefined testName (simulating API error parsing)
      const failedE2ETest = {
        testName: undefined,
        status: 'failed',
        error: 'API returned error instead of JSON',
        testPath: '/path/to/login.spec.ts',
      } as unknown as E2ETestResult;

      // Should not throw TypeError
      const result = await runResolveE2ETestAgent(failedE2ETest, testLogsDir);

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('uses fallback filename when testName is undefined', async () => {
      const mockSpawn = createMockSpawn({ result: 'Attempted to fix the E2E issue' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const failedE2ETest = {
        testName: undefined,
        status: 'failed',
        error: 'API returned error',
      } as unknown as E2ETestResult;

      await runResolveE2ETestAgent(failedE2ETest, testLogsDir);

      // Verify spawn was called (meaning no crash occurred)
      expect(spawn).toHaveBeenCalled();
    });

    it('still passes original undefined testName in JSON payload', async () => {
      const mockSpawn = createMockSpawn({ result: 'Attempted to fix the E2E issue' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const failedE2ETest = {
        testName: undefined,
        status: 'failed',
        error: 'API returned error',
      } as unknown as E2ETestResult;

      await runResolveE2ETestAgent(failedE2ETest, testLogsDir);

      // Verify the command was called and the JSON payload preserves undefined
      const calls = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1];
      const args = lastCall[1] as string[];
      const prompt = args[args.length - 1];
      expect(prompt).toContain('/resolve_failed_e2e_test');
      // The undefined should be serialized in JSON (undefined becomes omitted or null)
      expect(prompt).toContain('API returned error');
    });

    it('includes applicationUrl in failure JSON when provided', async () => {
      const mockSpawn = createMockSpawn({ result: 'Fixed the E2E issue' });
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(mockSpawn);

      const failedE2ETest: E2ETestResult = {
        testName: 'Login Test',
        status: 'failed',
        error: 'Element not found',
        testPath: '/path/to/login.spec.ts',
      };

      await runResolveE2ETestAgent(failedE2ETest, testLogsDir, undefined, undefined, 'http://localhost:45678');

      const calls = (spawn as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = calls[calls.length - 1];
      const args = lastCall[1] as string[];
      const prompt = args[args.length - 1];
      expect(prompt).toContain('http://localhost:45678');
    });
  });

  describe('isValidE2ETestResult', () => {
    it('returns true for valid E2ETestResult with testName', () => {
      const result: E2ETestResult = {
        testName: 'Login Test',
        status: 'passed',
        error: null,
      };
      expect(isValidE2ETestResult(result)).toBe(true);
    });

    it('returns false for null result', () => {
      expect(isValidE2ETestResult(null)).toBe(false);
    });

    it('returns false when testName is undefined', () => {
      const result = {
        testName: undefined,
        status: 'failed',
        error: 'Some error',
      } as unknown as E2ETestResult;
      expect(isValidE2ETestResult(result)).toBe(false);
    });

    it('returns false when testName is empty string', () => {
      const result: E2ETestResult = {
        testName: '',
        status: 'failed',
        error: 'Some error',
      };
      expect(isValidE2ETestResult(result)).toBe(false);
    });

    it('returns false when testName is not a string', () => {
      const result = {
        testName: 123,
        status: 'failed',
        error: 'Some error',
      } as unknown as E2ETestResult;
      expect(isValidE2ETestResult(result)).toBe(false);
    });

    it('returns false when only snake_case test_name is present (no testName)', () => {
      const result = {
        test_name: 'Login Test',
        status: 'passed',
        error: null,
      } as unknown as E2ETestResult;
      expect(isValidE2ETestResult(result)).toBe(false);
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

    // Create mock event emitter-like object
    const mockStdout = {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data') {
          // Simulate JSONL output format
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
 * Creates a mock implementation of child_process.spawn that simulates
 * the Playwright test runner subprocess.
 */
function createPlaywrightMockSpawn(options: { exitCode?: number; stdout?: string; stderr?: string }) {
  return () => {
    const { exitCode = 0, stdout = '', stderr = '' } = options;

    const mockStdout = {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data' && stdout) {
          setTimeout(() => callback(Buffer.from(stdout)), 10);
        }
      }),
    };

    const mockStderr = {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === 'data' && stderr) {
          setTimeout(() => callback(Buffer.from(stderr)), 10);
        }
      }),
    };

    const mockProcess = {
      stdout: mockStdout,
      stderr: mockStderr,
      on: vi.fn((event: string, callback: (code: number) => void) => {
        if (event === 'close') {
          setTimeout(() => callback(exitCode), 20);
        }
      }),
    };

    return mockProcess;
  };
}
