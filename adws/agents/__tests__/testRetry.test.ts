import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runUnitTestsWithRetry, runE2ETestsWithRetry, type TestRetryOptions } from '../testRetry';

vi.mock('../testAgent', () => ({
  runTestAgent: vi.fn(),
  runResolveTestAgent: vi.fn().mockResolvedValue({
    success: true,
    totalCostUsd: 0.1,
    modelUsage: {},
  }),
  runResolveE2ETestAgent: vi.fn().mockResolvedValue({
    success: true,
    totalCostUsd: 0.1,
    modelUsage: {},
  }),
  discoverE2ETestFiles: vi.fn().mockReturnValue([]),
  runPlaywrightE2ETests: vi.fn(),
  isValidE2ETestResult: vi.fn().mockReturnValue(true),
}));

// Mock agentState at the path retryOrchestrator imports it from
vi.mock('../../core/agentState', () => ({
  AgentStateManager: {
    readState: vi.fn().mockReturnValue({ adwId: 'adw-test' }),
    writeState: vi.fn(),
    appendLog: vi.fn(),
    initializeState: vi.fn().mockReturnValue('/mock/state'),
  },
}));

vi.mock('../../core/costReport', () => ({
  mergeModelUsageMaps: vi.fn().mockImplementation((a: Record<string, unknown>) => a),
  persistTokenCounts: vi.fn(),
}));

vi.mock('../../core/utils', () => ({
  log: vi.fn(),
}));

vi.mock('../../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core')>();
  return {
    ...actual,
    log: vi.fn(),
    persistTokenCounts: vi.fn(),
    mergeModelUsageMaps: vi.fn().mockReturnValue({}),
    emptyModelUsageMap: vi.fn().mockReturnValue({}),
    AgentStateManager: {
      readState: vi.fn().mockReturnValue({ adwId: 'adw-test' }),
      writeState: vi.fn(),
      appendLog: vi.fn(),
      initializeState: vi.fn().mockReturnValue('/mock/state'),
    },
  };
});

vi.mock('../../core/retryOrchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/retryOrchestrator')>();
  return {
    ...actual,
    initAgentState: vi.fn().mockReturnValue('/mock/state'),
    trackCost: vi.fn(),
  };
});

import {
  runTestAgent,
  runResolveTestAgent,
  runResolveE2ETestAgent,
  discoverE2ETestFiles,
  runPlaywrightE2ETests,
  isValidE2ETestResult,
} from '../testAgent';
import type { TestResult, TestAgentResult } from '../testAgent';

function createOptions(overrides: Partial<TestRetryOptions> = {}): TestRetryOptions {
  return {
    logsDir: '/tmp/logs',
    orchestratorStatePath: '/state',
    maxRetries: 3,
    ...overrides,
  };
}

function createPassingTestResult(): TestAgentResult {
  return {
    success: true,
    output: '[]',
    totalCostUsd: 0.1,
    testResults: [
      { test_name: 'linting', passed: true, execution_command: 'bun run lint', test_purpose: 'Lint' },
    ],
    allPassed: true,
    failedTests: [],
  };
}

function createFailingTestResult(failedTests: TestResult[] = []): TestAgentResult {
  const defaults: TestResult[] = failedTests.length > 0
    ? failedTests
    : [
        { test_name: 'build', passed: false, execution_command: 'bun run build', test_purpose: 'Build', error: 'Type error' },
      ];
  return {
    success: true,
    output: '[]',
    totalCostUsd: 0.1,
    testResults: [
      { test_name: 'linting', passed: true, execution_command: 'bun run lint', test_purpose: 'Lint' },
      ...defaults,
    ],
    allPassed: false,
    failedTests: defaults,
  };
}

describe('runUnitTestsWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success when tests pass on first attempt', async () => {
    vi.mocked(runTestAgent).mockResolvedValueOnce(createPassingTestResult());

    const result = await runUnitTestsWithRetry(createOptions());

    expect(result.passed).toBe(true);
    expect(result.totalRetries).toBe(0);
    expect(result.failedTests).toHaveLength(0);
  });

  it('retries when tests fail, then passes on second attempt', async () => {
    vi.mocked(runTestAgent)
      .mockResolvedValueOnce(createFailingTestResult())
      .mockResolvedValueOnce(createPassingTestResult());

    const result = await runUnitTestsWithRetry(createOptions());

    expect(result.passed).toBe(true);
    expect(result.totalRetries).toBe(1);
    expect(runResolveTestAgent).toHaveBeenCalled();
  });

  it('calls runResolveTestAgent for each failed test', async () => {
    const failedTests: TestResult[] = [
      { test_name: 'build', passed: false, execution_command: 'bun run build', test_purpose: 'Build', error: 'Error 1' },
      { test_name: 'types', passed: false, execution_command: 'bun run typecheck', test_purpose: 'Types', error: 'Error 2' },
    ];
    vi.mocked(runTestAgent)
      .mockResolvedValueOnce(createFailingTestResult(failedTests))
      .mockResolvedValueOnce(createPassingTestResult());

    await runUnitTestsWithRetry(createOptions());

    expect(runResolveTestAgent).toHaveBeenCalledTimes(2);
  });

  it('returns failure when max retries exceeded', async () => {
    vi.mocked(runTestAgent).mockResolvedValue(createFailingTestResult());

    const result = await runUnitTestsWithRetry(createOptions({ maxRetries: 2 }));

    expect(result.passed).toBe(false);
    expect(result.totalRetries).toBe(2);
    expect(result.failedTests).toHaveLength(1);
    expect(result.failedTests[0]).toBe('build');
  });

  it('calls onTestFailed callback when tests fail', async () => {
    const onTestFailed = vi.fn();
    vi.mocked(runTestAgent)
      .mockResolvedValueOnce(createFailingTestResult())
      .mockResolvedValueOnce(createPassingTestResult());

    await runUnitTestsWithRetry(createOptions({ onTestFailed }));

    expect(onTestFailed).toHaveBeenCalled();
  });

  it('passes cwd through to runTestAgent', async () => {
    vi.mocked(runTestAgent).mockResolvedValueOnce(createPassingTestResult());

    await runUnitTestsWithRetry(createOptions({ cwd: '/my/worktree' }));

    expect(runTestAgent).toHaveBeenCalledWith(
      '/tmp/logs',
      expect.any(String),
      '/my/worktree',
      undefined,
    );
  });

  it('passes issueBody through to runTestAgent', async () => {
    vi.mocked(runTestAgent).mockResolvedValueOnce(createPassingTestResult());

    await runUnitTestsWithRetry(createOptions({ issueBody: '<!-- adw:fast -->' }));

    expect(runTestAgent).toHaveBeenCalledWith(
      '/tmp/logs',
      expect.any(String),
      undefined,
      '<!-- adw:fast -->',
    );
  });
});

describe('runE2ETestsWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success immediately when no E2E test files exist', async () => {
    vi.mocked(discoverE2ETestFiles).mockReturnValueOnce([]);

    const result = await runE2ETestsWithRetry(createOptions());

    expect(result.passed).toBe(true);
    expect(result.totalRetries).toBe(0);
    expect(result.failedTests).toHaveLength(0);
    expect(runPlaywrightE2ETests).not.toHaveBeenCalled();
  });

  it('returns success when all Playwright tests pass on first run', async () => {
    vi.mocked(discoverE2ETestFiles).mockReturnValueOnce(['/e2e-tests/login.spec.ts']);
    vi.mocked(runPlaywrightE2ETests).mockResolvedValueOnce({
      allPassed: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      results: [{ testName: 'Login', status: 'passed', error: null }],
      failedResults: [],
    });

    const result = await runE2ETestsWithRetry(createOptions());

    expect(result.passed).toBe(true);
    expect(result.totalRetries).toBe(0);
  });

  it('retries failed E2E tests with resolution agent', async () => {
    vi.mocked(discoverE2ETestFiles).mockReturnValueOnce(['/e2e-tests/login.spec.ts']);

    // First run: test fails
    vi.mocked(runPlaywrightE2ETests).mockResolvedValueOnce({
      allPassed: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      results: [{ testName: 'Login', status: 'failed', error: 'Timeout', testPath: '/e2e-tests/login.spec.ts' }],
      failedResults: [{ testName: 'Login', status: 'failed', error: 'Timeout', testPath: '/e2e-tests/login.spec.ts' }],
    });

    // After resolution: all pass
    vi.mocked(runPlaywrightE2ETests).mockResolvedValueOnce({
      allPassed: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      results: [{ testName: 'Login', status: 'passed', error: null }],
      failedResults: [],
    });

    const result = await runE2ETestsWithRetry(createOptions());

    expect(result.passed).toBe(true);
    expect(runResolveE2ETestAgent).toHaveBeenCalled();
  });

  it('returns failure when E2E tests exceed max retries', async () => {
    vi.mocked(discoverE2ETestFiles).mockReturnValueOnce(['/e2e-tests/login.spec.ts']);

    const failedResult = {
      allPassed: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      results: [{ testName: 'Login', status: 'failed' as const, error: 'Timeout', testPath: '/e2e-tests/login.spec.ts' }],
      failedResults: [{ testName: 'Login', status: 'failed' as const, error: 'Timeout', testPath: '/e2e-tests/login.spec.ts' }],
    };

    // All attempts fail
    vi.mocked(runPlaywrightE2ETests).mockResolvedValue(failedResult);

    const result = await runE2ETestsWithRetry(createOptions({ maxRetries: 2 }));

    expect(result.passed).toBe(false);
    expect(result.failedTests).toContain('Login');
  });

  it('calls onTestFailed when E2E tests fail', async () => {
    const onTestFailed = vi.fn();
    vi.mocked(discoverE2ETestFiles).mockReturnValueOnce(['/e2e-tests/login.spec.ts']);

    const failedResult = {
      allPassed: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      results: [{ testName: 'Login', status: 'failed' as const, error: 'Timeout', testPath: '/e2e-tests/login.spec.ts' }],
      failedResults: [{ testName: 'Login', status: 'failed' as const, error: 'Timeout', testPath: '/e2e-tests/login.spec.ts' }],
    };

    vi.mocked(runPlaywrightE2ETests).mockResolvedValue(failedResult);

    await runE2ETestsWithRetry(createOptions({ maxRetries: 1, onTestFailed }));

    expect(onTestFailed).toHaveBeenCalled();
  });

  it('passes applicationUrl to runPlaywrightE2ETests', async () => {
    vi.mocked(discoverE2ETestFiles).mockReturnValueOnce(['/e2e-tests/login.spec.ts']);
    vi.mocked(runPlaywrightE2ETests).mockResolvedValueOnce({
      allPassed: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      results: [],
      failedResults: [],
    });

    await runE2ETestsWithRetry(createOptions({ applicationUrl: 'http://localhost:3000' }));

    expect(runPlaywrightE2ETests).toHaveBeenCalledWith(
      undefined,
      'http://localhost:3000',
    );
  });

  it('removes now-passing tests from failed set after resolution', async () => {
    vi.mocked(discoverE2ETestFiles).mockReturnValueOnce([
      '/e2e-tests/login.spec.ts',
      '/e2e-tests/signup.spec.ts',
    ]);

    // First run: both fail
    vi.mocked(runPlaywrightE2ETests).mockResolvedValueOnce({
      allPassed: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      results: [
        { testName: 'Login', status: 'failed', error: 'Error 1', testPath: '/e2e-tests/login.spec.ts' },
        { testName: 'Signup', status: 'failed', error: 'Error 2', testPath: '/e2e-tests/signup.spec.ts' },
      ],
      failedResults: [
        { testName: 'Login', status: 'failed', error: 'Error 1', testPath: '/e2e-tests/login.spec.ts' },
        { testName: 'Signup', status: 'failed', error: 'Error 2', testPath: '/e2e-tests/signup.spec.ts' },
      ],
    });

    // After resolution: login passes, signup still fails
    vi.mocked(runPlaywrightE2ETests).mockResolvedValueOnce({
      allPassed: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      results: [
        { testName: 'Login', status: 'passed', error: null, testPath: '/e2e-tests/login.spec.ts' },
        { testName: 'Signup', status: 'failed', error: 'Error 2', testPath: '/e2e-tests/signup.spec.ts' },
      ],
      failedResults: [
        { testName: 'Signup', status: 'failed', error: 'Error 2', testPath: '/e2e-tests/signup.spec.ts' },
      ],
    });

    // After second resolution: all pass
    vi.mocked(runPlaywrightE2ETests).mockResolvedValueOnce({
      allPassed: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      results: [
        { testName: 'Login', status: 'passed', error: null },
        { testName: 'Signup', status: 'passed', error: null },
      ],
      failedResults: [],
    });

    const result = await runE2ETestsWithRetry(createOptions());

    expect(result.passed).toBe(true);
    expect(result.failedTests).toHaveLength(0);
  });

  it('handles isValidE2ETestResult returning false by deriving name from path', async () => {
    vi.mocked(discoverE2ETestFiles).mockReturnValueOnce(['/e2e-tests/login.spec.ts']);
    vi.mocked(isValidE2ETestResult).mockReturnValueOnce(true).mockReturnValueOnce(false);

    // First run: test fails with missing testName
    vi.mocked(runPlaywrightE2ETests).mockResolvedValueOnce({
      allPassed: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      results: [{ testName: 'Login', status: 'failed', error: 'Error', testPath: '/e2e-tests/login.spec.ts' }],
      failedResults: [{ testName: 'Login', status: 'failed', error: 'Error', testPath: '/e2e-tests/login.spec.ts' }],
    });

    // After resolution: passes
    vi.mocked(runPlaywrightE2ETests).mockResolvedValueOnce({
      allPassed: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      results: [],
      failedResults: [],
    });

    const result = await runE2ETestsWithRetry(createOptions());

    expect(result.passed).toBe(true);
  });

  it('passes cwd to discoverE2ETestFiles', async () => {
    vi.mocked(discoverE2ETestFiles).mockReturnValueOnce([]);

    await runE2ETestsWithRetry(createOptions({ cwd: '/my/worktree' }));

    expect(discoverE2ETestFiles).toHaveBeenCalledWith('/my/worktree');
  });
});
